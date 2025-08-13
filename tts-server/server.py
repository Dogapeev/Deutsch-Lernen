import os
import json
import hashlib
import asyncio
import time
from pathlib import Path
from typing import Dict, List, Set
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from gtts import gTTS
import logging
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import threading
from datetime import datetime
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import signal
import sys

# --- Инициализация ---
app = Flask(__name__)
CORS(app)
limiter = Limiter(get_remote_address, app=app, default_limits=["200 per day", "50 per hour"])

# --- Константы ---
PRODUCTION = os.getenv('PRODUCTION', 'false').lower() == 'true'
AUDIO_DIR = "audio_cache"
VOCABULARIES_DIR = "vocabularies"
CACHE_MANIFEST = "cache_manifest.json"
CONFIG_FILE = "auto_config.json"
ACCESS_STATS_FILE = "access_stats.json"
SUPPORTED_LANGUAGES = {'de', 'ru', 'en', 'fr', 'es'}

# Настройка логирования
log_level = logging.WARNING if PRODUCTION else logging.INFO
logging.basicConfig(level=log_level, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
start_time = time.time()

class AutoVocabularySystem:
    def __init__(self):
        self.audio_dir = Path(AUDIO_DIR)
        self.vocabularies_dir = Path(VOCABULARIES_DIR)
        self.config = self.load_config()
        self.protected_hashes = set()
        self.vocabulary_registry = {}
        self.file_observer = None
        self.processing_queue = asyncio.Queue()
        self.last_cleanup_time = time.time()
        self.gtts_semaphore = asyncio.Semaphore(3)

        os.makedirs(AUDIO_DIR, exist_ok=True)
        os.makedirs(VOCABULARIES_DIR, exist_ok=True)
        self.load_manifest()
        
        self.loop = asyncio.new_event_loop()
        self.background_thread = threading.Thread(target=self.run_background_processor, daemon=True)
        self.background_thread.start()
        
        if self.config.get('auto_watch_enabled', True):
            self.start_file_watcher()

    def load_config(self):
        default_config = {
            "auto_watch_enabled": True, "auto_process_on_change": True,
            "auto_process_on_startup": True, "retry_failed": True,
            "cleanup_on_startup": False, "auto_cleanup_enabled": True,
            "cleanup_interval_hours": 24, "min_access_count_protect": 2,
            "max_cache_files": 1000, "max_cache_size_mb": 500,
            "check_interval_seconds": 300, "supported_extensions": [".json"],
            "exclude_patterns": [".*", "_*"]
        }
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    default_config.update(json.load(f))
                logger.info("🔧 Конфигурация загружена")
            else:
                with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                    json.dump(default_config, f, indent=2, ensure_ascii=False)
                logger.info("🔧 Создана конфигурация по умолчанию")
        except Exception as e:
            logger.error(f"Ошибка загрузки конфигурации: {e}", exc_info=not PRODUCTION)
        return default_config

    def load_manifest(self):
        try:
            if os.path.exists(CACHE_MANIFEST):
                with open(CACHE_MANIFEST, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.protected_hashes = set(data.get('protected_hashes', []))
                    self.vocabulary_registry = data.get('vocabularies', {})
        except Exception as e:
            logger.error(f"Ошибка загрузки манифеста: {e}", exc_info=not PRODUCTION)

    def save_manifest(self):
        try:
            data = {'protected_hashes': list(self.protected_hashes), 'vocabularies': self.vocabulary_registry, 'last_updated': datetime.now().isoformat()}
            with open(CACHE_MANIFEST, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Ошибка сохранения манифеста: {e}", exc_info=not PRODUCTION)

    def scan_vocabularies(self, auto_process=None):
        logger.info("🔍 Сканирование словарей...")
        if auto_process is None: auto_process = self.config.get('auto_process_on_startup', True)
        
        # Заменяем glob на простое перечисление файлов, чтобы включить файлы с точкой в имени
        vocab_files = [p for p in self.vocabularies_dir.iterdir() if p.is_file() and any(p.name.endswith(ext) for ext in self.config['supported_extensions'])]

        new_or_changed = []
        for vocab_file in vocab_files:
            # Используем p.name для получения имени файла, а не p.stem
            vocab_name = vocab_file.name
            if any(vocab_name.startswith(p.strip('*._')) for p in self.config['exclude_patterns']): continue
            try:
                current_mtime = vocab_file.stat().st_mtime
                if vocab_name not in self.vocabulary_registry or self.vocabulary_registry[vocab_name].get('last_modified', 0) < current_mtime:
                    with open(vocab_file, 'r', encoding='utf-8') as f: vocab_data = json.load(f)
                    self.vocabulary_registry[vocab_name] = {'file_path': str(vocab_file), 'word_count': len(vocab_data), 'last_modified': current_mtime, 'status': 'detected', 'detection_time': datetime.now().isoformat()}
                    new_or_changed.append(vocab_name)
                    logger.info(f"📖 Обнаружен/обновлен словарь: {vocab_name} ({len(vocab_data)} слов)")
            except Exception as e:
                logger.error(f"Ошибка обработки словаря {vocab_file}: {e}", exc_info=not PRODUCTION)
        
        if new_or_changed: self.save_manifest()

        if auto_process and new_or_changed:
            for vocab_name in new_or_changed:
                if hasattr(self, 'loop') and self.loop.is_running():
                    asyncio.run_coroutine_threadsafe(self.add_to_processing_queue(vocab_name), self.loop)
            logger.info(f"🔄 Добавлено в очередь обработки: {new_or_changed}")

    async def add_to_processing_queue(self, vocab_name):
        await self.processing_queue.put({'action': 'pregenerate', 'vocab_name': vocab_name})

    def is_file_protected(self, filename: str) -> bool:
        return filename.replace('.mp3', '') in self.protected_hashes

    def smart_cleanup(self, force: bool = False):
        audio_files = list(self.audio_dir.glob("*.mp3"))
        total_size_mb = sum(f.stat().st_size for f in audio_files) / (1024 * 1024) if audio_files else 0
        max_files, max_size_mb = self.config.get('max_cache_files', 1000), self.config.get('max_cache_size_mb', 500)
        
        if not (force or len(audio_files) > max_files or total_size_mb > max_size_mb):
            return {"message": "Очистка не требуется", "total_files": len(audio_files)}
        
        logger.info(f"🧹 Начинаем умную очистку: {len(audio_files)} файлов, {total_size_mb:.1f} МБ")
        access_stats = self.load_access_stats()
        
        all_protected_hashes = self.protected_hashes
        orphan_files = [f for f in audio_files if f.stem not in all_protected_hashes]
        deleted_orphans = 0
        for f in orphan_files:
            try:
                f.unlink()
                deleted_orphans += 1
                if f.name in access_stats: del access_stats[f.name]
            except Exception as e: 
                logger.error(f"Ошибка удаления {f}: {e}")
        
        self.save_access_stats(access_stats)
        self.last_cleanup_time = time.time()
        logger.info(f"🧹 Очистка завершена. Удалено 'orphan' файлов: {deleted_orphans}")
        return {
            "message": "Умная очистка завершена", 
            "deleted_files": {"orphans": deleted_orphans}
        }

    def load_access_stats(self):
        if not os.path.exists(ACCESS_STATS_FILE): return {}
        try:
            with open(ACCESS_STATS_FILE, 'r', encoding='utf-8') as f: return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"Ошибка загрузки статистики: {e}", exc_info=not PRODUCTION)
        return {}

    def save_access_stats(self, stats):
        try:
            with open(ACCESS_STATS_FILE, 'w', encoding='utf-8') as f: json.dump(stats, f, indent=2)
        except IOError as e:
            logger.error(f"Ошибка сохранения статистики: {e}", exc_info=not PRODUCTION)

    def record_file_access(self, filename):
        stats = self.load_access_stats()
        now = time.time()
        file_stats = stats.get(filename, {'access_count': 0, 'created': now})
        file_stats['access_count'] += 1
        file_stats['last_access'] = now
        stats[filename] = file_stats
        self.save_access_stats(stats)
    
    def run_background_processor(self):
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_until_complete(self.background_processor())
        finally:
            self.loop.close()

    async def background_processor(self):
        logger.info("🔄 Фоновый процессор запущен")
        while True:
            try:
                task = await asyncio.wait_for(self.processing_queue.get(), timeout=self.config['check_interval_seconds'])
                if isinstance(task, asyncio.CancelledError): break
                if task['action'] == 'pregenerate':
                    vocab_name = task['vocab_name']
                    logger.info(f"🎵 Начинаем автогенерацию для: {vocab_name}")
                    try:
                        result = await self.pregenerate_vocabulary_audio(vocab_name)
                        logger.info(f"✅ Автогенерация для {vocab_name} завершена: {result}")
                        if vocab_name in self.vocabulary_registry:
                            self.vocabulary_registry[vocab_name]['status'] = 'ready'
                            self.vocabulary_registry[vocab_name]['last_processed'] = datetime.now().isoformat()
                            self.save_manifest()
                    except Exception as e:
                        logger.error(f"❌ Ошибка автогенерации для {vocab_name}: {e}", exc_info=not PRODUCTION)
                        if vocab_name in self.vocabulary_registry:
                            self.vocabulary_registry[vocab_name]['status'] = 'failed'; self.vocabulary_registry[vocab_name]['last_error'] = str(e)
                self.processing_queue.task_done()
            except asyncio.TimeoutError:
                if self.config.get('auto_cleanup_enabled', True):
                    cleanup_interval = self.config.get('cleanup_interval_hours', 24) * 3600
                    if time.time() - self.last_cleanup_time > cleanup_interval:
                        self.smart_cleanup()
            except asyncio.CancelledError:
                logger.info("Фоновый процессор останавливается.")
                break
            except Exception as e:
                logger.error(f"Критическая ошибка в фоновом процессоре: {e}", exc_info=not PRODUCTION)
                await asyncio.sleep(10)

    def start_file_watcher(self):
        class VocabularyFileHandler(FileSystemEventHandler):
            def __init__(self, system_ref): 
                self.system = system_ref
                self.timer = None
            
            def on_any_event(self, event):
                if not event.is_directory and any(event.src_path.endswith(ext) for ext in self.system.config['supported_extensions']):
                    if self.timer: self.timer.cancel()
                    logger.info(f"📁 Обнаружено событие файла: {event.src_path}. Ожидание 2 сек...")
                    self.timer = threading.Timer(2.0, self.system.scan_vocabularies, args=[True])
                    self.timer.start()

        self.file_observer = Observer()
        self.file_observer.schedule(VocabularyFileHandler(self), str(self.vocabularies_dir), recursive=True)
        self.file_observer.start()
        logger.info(f"👁️ Запущено слежение за папкой: {self.vocabularies_dir}")
        
    def stop_file_watcher(self):
        if self.file_observer and self.file_observer.is_alive(): 
            self.file_observer.stop()
            self.file_observer.join()
            logger.info("👁️ Слежение за файлами остановлено")

    async def pregenerate_vocabulary_audio(self, vocab_name: str):
        if vocab_name not in self.vocabulary_registry: 
            raise ValueError(f"Словарь {vocab_name} не найден")
        
        with open(self.vocabulary_registry[vocab_name]['file_path'], 'r', encoding='utf-8') as f: 
            vocab_data = json.load(f)
        
        required_hashes = self.get_vocabulary_hashes(vocab_data)
        missing_files = {h for h in required_hashes if not (self.audio_dir / f"{h}.mp3").exists()}
        
        if not missing_files: 
            return {'status': 'all_files_exist', 'count': len(required_hashes)}
        
        logger.info(f"🎵 {vocab_name}: требуется {len(missing_files)} аудиофайлов")
        hash_to_text_map = {self._get_text_hash(lang, entry[field]): (lang, entry[field])
                            for entry in vocab_data
                            for field, lang in [('german', 'de'), ('russian', 'ru'), ('sentence', 'de'), ('sentence_ru', 'ru')]
                            if entry.get(field)}

        tasks = [self._generate_audio_file(h, *hash_to_text_map[h]) for h in missing_files if h in hash_to_text_map]
        results = await asyncio.gather(*[asyncio.wait_for(task, timeout=45) for task in tasks], return_exceptions=True)
        
        success_hashes = {h for h, r in zip(missing_files, results) if not isinstance(r, Exception)}
        if success_hashes:
            self.protected_hashes.update(success_hashes)
            self.save_manifest()
            
        return {'generated': len(success_hashes), 'failed': len(results) - len(success_hashes)}

    def get_vocabulary_hashes(self, vocab_data: List[Dict]) -> Set[str]:
        return {self._get_text_hash(l, e[f]) for e in vocab_data 
                for f,l in [('german','de'),('russian','ru'),('sentence','de'),('sentence_ru','ru')] 
                if e.get(f)}

    def _get_text_hash(self, lang: str, text: str) -> str:
        return hashlib.md5(f"{lang}:{text}".encode('utf-8')).hexdigest()

    async def _generate_audio_file(self, hash_value: str, lang: str, text: str):
        filepath = self.audio_dir / f"{hash_value}.mp3"
        if filepath.exists(): return

        async with self.gtts_semaphore:
            for attempt in range(3):
                try:
                    await asyncio.get_event_loop().run_in_executor(None, self._blocking_gtts_save, text, lang, str(filepath))
                    logger.info(f"✅ Сгенерирован файл: {filepath.name}")
                    return
                except Exception as e:
                    logger.warning(f"Попытка {attempt + 1} генерации {filepath.name} провалилась: {e}")
                    if attempt < 2: await asyncio.sleep(2 ** attempt)
                    else: raise

    def _blocking_gtts_save(self, text, lang, path):
        tts = gTTS(text=text, lang=lang, slow=False)
        tts.save(path)

# --- Инициализация системы ---
auto_system = AutoVocabularySystem()

# --- API Endpoints ---
@app.route('/synthesize', methods=['GET'])
@limiter.limit("30 per minute")
def synthesize_speech():
    text, lang = request.args.get('text', '').strip(), request.args.get('lang', '').lower()
    if not (1 <= len(text) <= 500): 
        return jsonify({"error": "Invalid text length (1-500)"}), 400
    if lang not in SUPPORTED_LANGUAGES: 
        return jsonify({"error": f"Unsupported language: {lang}"}), 400
    
    hash_val = auto_system._get_text_hash(lang, text)
    filename = f"{hash_val}.mp3"
    filepath = auto_system.audio_dir / filename
    
    if not filepath.exists():
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(auto_system._generate_audio_file(hash_val, lang, text))
            logger.info(f"🎤 Динамическая генерация: {filename}")
        except Exception as e:
            logger.error(f"Ошибка динамической генерации: {e}", exc_info=not PRODUCTION)
            return jsonify({"error": f"Failed to generate audio: {e}"}), 500
    
    return jsonify({"url": f"/audio/{filename}"})

@app.route('/audio/<filename>')
@limiter.limit("120 per minute")
def serve_audio(filename):
    if not Path(auto_system.audio_dir, filename).exists():
        return jsonify({"error": "File not found"}), 404
    auto_system.record_file_access(filename)
    return send_from_directory(str(auto_system.audio_dir), filename)

# --- НОВЫЕ ЭНДПОИНТЫ ДЛЯ РАБОТЫ СО СЛОВАРЯМИ ---

@app.route('/vocabularies/list', methods=['GET'])
def get_vocabularies_list():
    """
    Возвращает список обнаруженных словарей с их метаданными.
    """
    return jsonify(auto_system.vocabulary_registry)

@app.route('/vocabularies/get/<vocab_name>', methods=['GET'])
def get_vocabulary_file(vocab_name):
    """
    Отдает содержимое файла словаря по его имени.
    """
    if vocab_name in auto_system.vocabulary_registry:
        logger.info(f"📖 Запрошен словарь: {vocab_name}")
        return send_from_directory(VOCABULARIES_DIR, vocab_name)
    else:
        logger.warning(f"⚠️ Попытка доступа к несуществующему словарю: {vocab_name}")
        return jsonify({"error": "Vocabulary not found"}), 404

# --- СИСТЕМНЫЕ ЭНДПОИНТЫ ---

@app.route('/health')
def health_check():
    return jsonify({
        "status": "healthy", 
        "timestamp": datetime.now().isoformat(), 
        "gtts_semaphore_available": auto_system.gtts_semaphore._value, 
        "queue_size": auto_system.processing_queue.qsize()
    })

@app.route('/status')
def system_status():
    return jsonify({
        "system": "AutoVocabularySystem",
        "version": "1.2.0", # Версия с новыми эндпоинтами
        "status": "running",
        "production_mode": PRODUCTION,
        "background_processor_active": auto_system.background_thread.is_alive(),
        "file_watcher_active": auto_system.file_observer.is_alive() if auto_system.file_observer else False,
        "config": {k: v for k, v in auto_system.config.items() if 'pattern' not in k}
    })

@app.route('/cache/stats')
def cache_stats():
    audio_files = list(auto_system.audio_dir.glob("*.mp3"))
    protected_count = sum(1 for f in audio_files if auto_system.is_file_protected(f.name))
    return jsonify({
        "total_files": len(audio_files), 
        "protected_files": protected_count, 
        "orphan_files": len(audio_files) - protected_count, 
        "total_size_mb": round(sum(f.stat().st_size for f in audio_files) / (1024 * 1024), 2) if audio_files else 0
    })

# --- Graceful Shutdown ---
def graceful_shutdown():
    logger.info("🛑 Инициирована корректная остановка сервера...")
    auto_system.stop_file_watcher()
    if hasattr(auto_system, 'loop') and auto_system.loop.is_running():
        future = asyncio.run_coroutine_threadsafe(auto_system.processing_queue.put(asyncio.CancelledError()), auto_system.loop)
        try:
            future.result(timeout=2)
        except asyncio.TimeoutError:
            logger.warning("Не удалось чисто остановить очередь задач.")
        auto_system.loop.call_soon_threadsafe(auto_system.loop.stop)
    
    if auto_system.background_thread.is_alive():
        auto_system.background_thread.join(timeout=3)
    logger.info("✅ Сервер остановлен.")
    
def signal_handler(sig, frame):
    graceful_shutdown()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# --- Запуск приложения ---
if __name__ == '__main__':
    logger.info("🤖 Автоматическая система TTS запускается...")
    
    if auto_system.config.get('cleanup_on_startup', False):
        auto_system.smart_cleanup(force=True)
    
    auto_system.scan_vocabularies()
    
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)