# Файл: tts-server/server.py
# ВЕРСИЯ 1.4.3: Исправлена ошибка '429 Too Many Requests' и добавлен параметр gtts_concurrency

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
import atexit

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
        # --- ИЗМЕНЕНИЕ 1: Инициализация семафора из конфига ---
        # Устанавливаем количество одновременных запросов к TTS API. 1 - самый безопасный вариант.
        self.gtts_semaphore = asyncio.Semaphore(self.config.get('gtts_concurrency', 1))
        self._initialized = False

        os.makedirs(AUDIO_DIR, exist_ok=True)
        os.makedirs(VOCABULARIES_DIR, exist_ok=True)
        self.load_manifest()
        
        try:
            self.loop = asyncio.get_event_loop()
        except RuntimeError:
            self.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.loop)
        
        self.background_thread = threading.Thread(target=self.run_background_processor, daemon=True)

    def ensure_initialized(self):
        if self._initialized:
            return
            
        logger.info("🚀 Выполняю отложенную инициализацию...")
        self.scan_vocabularies(auto_process=True)
        if self.config.get('auto_watch_enabled', True):
            self.start_file_watcher()
        self._initialized = True
        logger.info("✅ Отложенная инициализация завершена")

    def load_config(self):
        # --- ИЗМЕНЕНИЕ 2: Добавлен параметр в конфиг по умолчанию ---
        default_config = {
            "auto_watch_enabled": True, "auto_process_on_change": True,
            "auto_process_on_startup": True, "retry_failed": True,
            "cleanup_on_startup": False, "auto_cleanup_enabled": True,
            "cleanup_interval_hours": 24, "min_access_count_protect": 2,
            "max_cache_files": 1000, "max_cache_size_mb": 500,
            "check_interval_seconds": 300, "supported_extensions": [".json"],
            "exclude_patterns": [".*", "~*", "*~", "*.bak", "*.tmp"],
            "gtts_concurrency": 1 # Количество одновременных запросов к TTS (1 - рекомендуется)
        }
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    loaded_config = json.load(f)
                    loaded_config.pop('_comments', None)
                    default_config.update(loaded_config)
                logger.info("🔧 Конфигурация загружена из файла")
            else:
                config_with_comments = {**default_config, "_comments": {}}
                with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                    json.dump(config_with_comments, f, indent=2, ensure_ascii=False)
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
        if auto_process is None: 
            auto_process = self.config.get('auto_process_on_startup', True)
        
        vocab_files = []
        if not self.vocabularies_dir.exists():
            logger.error(f"❌ Директория словарей не найдена: {self.vocabularies_dir}")
            return []
            
        for ext in self.config['supported_extensions']:
            vocab_files.extend(self.vocabularies_dir.glob(f"*{ext}"))
        
        logger.info(f"📁 Найдено файлов для анализа: {len(vocab_files)}")
        new_or_changed = []
        
        for vocab_file in vocab_files:
            vocab_name = vocab_file.stem
            
            should_exclude = False
            for pattern in self.config['exclude_patterns']:
                if (pattern.startswith('*') and vocab_file.name.endswith(pattern[1:])) or \
                   (pattern.endswith('*') and vocab_file.name.startswith(pattern[:-1])) or \
                   (pattern == vocab_file.name):
                    should_exclude = True
                    break
            
            if should_exclude:
                logger.info(f"⏭️ Пропускаем файл по правилу исключения '{pattern}': {vocab_file.name}")
                continue
                
            try:
                current_mtime = vocab_file.stat().st_mtime
                needs_update = (vocab_name not in self.vocabulary_registry or self.vocabulary_registry[vocab_name].get('last_modified', 0) < current_mtime)
                
                if needs_update:
                    with open(vocab_file, 'r', encoding='utf-8') as f:
                        vocab_data = json.load(f)

                    word_count = 0
                    if isinstance(vocab_data, dict) and 'words' in vocab_data and isinstance(vocab_data['words'], list):
                        word_count = len(vocab_data['words'])
                        logger.info(f"📖 Обнаружен словарь нового формата '{vocab_name}' ({word_count} слов).")
                    elif isinstance(vocab_data, list):
                        word_count = len(vocab_data)
                        logger.warning(f"⚠️ Обнаружен словарь старого формата '{vocab_name}' ({word_count} слов). Рекомендуется обновить.")
                    else:
                        logger.error(f"❌ Неверный формат словаря в файле {vocab_file.name}. Пропускаем.")
                        continue

                    logger.info(f"📖 Обнаружен новый/измененный словарь. Загрузка: {vocab_name}")
                        
                    self.vocabulary_registry[vocab_name] = {
                        'file_path': str(vocab_file),
                        'word_count': word_count,
                        'last_modified': current_mtime,
                        'status': 'detected',
                        'detection_time': datetime.now().isoformat()
                    }
                    
                    new_or_changed.append(vocab_name)
                    logger.info(f"✅ Словарь {vocab_name} успешно добавлен/обновлен ({word_count} слов)")
            except json.JSONDecodeError as e:
                logger.error(f"❌ Ошибка декодирования JSON в файле {vocab_file.name}: {e}")
            except Exception as e:
                logger.error(f"❌ Неизвестная ошибка обработки словаря {vocab_file.name}: {e}", exc_info=not PRODUCTION)
        
        if new_or_changed:
            self.save_manifest()
            logger.info(f"💾 Реестр обновлен. Новых/измененных словарей: {len(new_or_changed)}")
        
        if auto_process and new_or_changed:
            if not self.background_thread.is_alive():
                self.background_thread.start()
            for vocab_name in new_or_changed:
                if hasattr(self, 'loop') and not self.loop.is_closed():
                    asyncio.run_coroutine_threadsafe(self.add_to_processing_queue(vocab_name), self.loop)
            logger.info(f"🔄 Добавлено в очередь на автогенерацию аудио: {new_or_changed}")
        
        logger.info(f"📊 Итого словарей в реестре: {len(self.vocabulary_registry)}")
        return new_or_changed

    async def add_to_processing_queue(self, vocab_name):
        await self.processing_queue.put({'action': 'pregenerate', 'vocab_name': vocab_name})

    def run_background_processor(self):
        try:
            if not self.loop.is_running():
                asyncio.set_event_loop(self.loop)
            self.loop.run_until_complete(self.background_processor())
        except Exception as e:
            logger.error(f"Ошибка в фоновом процессоре: {e}")
        finally:
            if not self.loop.is_closed(): self.loop.close()

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
                            self.vocabulary_registry[vocab_name]['status'] = 'failed'
                            self.vocabulary_registry[vocab_name]['last_error'] = str(e)
                self.processing_queue.task_done()
            except asyncio.TimeoutError:
                if self.config.get('auto_cleanup_enabled', True):
                    cleanup_interval = self.config.get('cleanup_interval_hours', 24) * 3600
                    if time.time() - self.last_cleanup_time > cleanup_interval: self.smart_cleanup()
            except asyncio.CancelledError:
                logger.info("Фоновый процессор останавливается.")
                break
            except Exception as e:
                logger.error(f"Критическая ошибка в фоновом процессоре: {e}", exc_info=not PRODUCTION)
                await asyncio.sleep(10)

    def start_file_watcher(self):
        if self.file_observer and self.file_observer.is_alive(): return
        class VocabularyFileHandler(FileSystemEventHandler):
            def __init__(self, system_ref): 
                self.system = system_ref; self.timer = None
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
            self.file_observer.stop(); self.file_observer.join()
            logger.info("👁️ Слежение за файлами остановлено")

    def smart_cleanup(self, force: bool = False): pass

    async def pregenerate_vocabulary_audio(self, vocab_name: str):
        if vocab_name not in self.vocabulary_registry: raise ValueError(f"Словарь {vocab_name} не найден")
        
        with open(self.vocabulary_registry[vocab_name]['file_path'], 'r', encoding='utf-8') as f: 
            vocab_data = json.load(f)
        
        required_hashes = self.get_vocabulary_hashes(vocab_data)
        missing_files = {h for h in required_hashes if not (self.audio_dir / f"{h}.mp3").exists()}
        
        if not missing_files: return {'status': 'all_files_exist', 'count': len(required_hashes)}
        
        logger.info(f"🎵 {vocab_name}: требуется {len(missing_files)} аудиофайлов")
        
        words_list = vocab_data['words'] if isinstance(vocab_data, dict) and 'words' in vocab_data else vocab_data
        
        hash_to_text_map = {self._get_text_hash(lang, entry[field]): (lang, entry[field])
                            for entry in words_list
                            for field, lang in [('german', 'de'), ('russian', 'ru'), ('sentence', 'de'), ('sentence_ru', 'ru')]
                            if entry.get(field)}

        tasks = [self._generate_audio_file(h, *hash_to_text_map[h]) for h in missing_files if h in hash_to_text_map]
        results = await asyncio.gather(*[asyncio.wait_for(task, timeout=45) for task in tasks], return_exceptions=True)
        
        success_hashes = {h for h, r in zip(missing_files, results) if not isinstance(r, Exception)}
        if success_hashes:
            self.protected_hashes.update(success_hashes)
            self.save_manifest()
            
        return {'generated': len(success_hashes), 'failed': len(results) - len(success_hashes)}

    def get_vocabulary_hashes(self, vocab_data) -> Set[str]:
        words_list = vocab_data['words'] if isinstance(vocab_data, dict) and 'words' in vocab_data else vocab_data
        return {self._get_text_hash(l, e[f]) for e in words_list
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

auto_system = AutoVocabularySystem()

@app.route('/synthesize', methods=['GET'])
@limiter.limit("30 per minute")
def synthesize_speech():
    auto_system.ensure_initialized()
    text, lang = request.args.get('text', '').strip(), request.args.get('lang', '').lower()
    if not (1 <= len(text) <= 500): return jsonify({"error": "Invalid text length (1-500)"}), 400
    if lang not in SUPPORTED_LANGUAGES: return jsonify({"error": f"Unsupported language: {lang}"}), 400
    
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
    if not Path(auto_system.audio_dir, filename).exists(): return jsonify({"error": "File not found"}), 404
    return send_from_directory(str(auto_system.audio_dir), filename)

@app.route('/api/vocabularies/list')
def get_vocabularies_list():
    auto_system.ensure_initialized()
    vocab_list = [{"name": name, "word_count": data.get('word_count', 0), "last_modified": data.get('last_modified', 0), "url": f"/api/vocabulary/{name}"} for name, data in auto_system.vocabulary_registry.items()]
    if not vocab_list: logger.warning("Запрошен список словарей, но ни одного не найдено в реестре.")
    return jsonify(vocab_list)

@app.route('/api/vocabulary/<vocab_name>')
def get_vocabulary(vocab_name):
    auto_system.ensure_initialized()
    if vocab_name not in auto_system.vocabulary_registry:
        logger.error(f"Попытка доступа к незарегистрированному словарю: {vocab_name}")
        return jsonify({"error": f"Vocabulary '{vocab_name}' not found."}), 404
    vocab_filename = f"{vocab_name}.json"
    logger.info(f"Отправляем файл словаря: {vocab_filename} из {auto_system.vocabularies_dir}")
    return send_from_directory(str(auto_system.vocabularies_dir), vocab_filename)

@app.route('/health')
def health_check(): return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()})

@app.route('/status')
def system_status():
    return jsonify({"system": "AutoVocabularySystem", "version": "1.4.3-rate-limit-fix", "status": "running", "production_mode": PRODUCTION, "initialized": auto_system._initialized, "background_processor_active": auto_system.background_thread.is_alive(), "file_watcher_active": auto_system.file_observer.is_alive() if auto_system.file_observer else False})

@app.route('/debug/quick')
def quick_debug():
    auto_system.ensure_initialized()
    json_files_count = 0
    if auto_system.vocabularies_dir.exists(): json_files_count = len(list(auto_system.vocabularies_dir.glob("*.json")))
    return jsonify({"vocabularies_dir_exists": auto_system.vocabularies_dir.exists(), "json_files_in_dir_count": json_files_count, "current_registry_count": len(auto_system.vocabulary_registry), "current_registry_keys": list(auto_system.vocabulary_registry.keys()), "exclude_patterns_in_use": auto_system.config['exclude_patterns'], "initialized": auto_system._initialized})

def graceful_shutdown():
    logger.info("🛑 Инициирована корректная остановка сервера...")
    auto_system.stop_file_watcher()
    if auto_system.background_thread.is_alive():
        if hasattr(auto_system, 'loop') and not auto_system.loop.is_closed():
            try:
                future = asyncio.run_coroutine_threadsafe(auto_system.processing_queue.put(asyncio.CancelledError()), auto_system.loop)
                future.result(timeout=2)
            except: pass
        auto_system.background_thread.join(timeout=3)
    logger.info("✅ Сервер остановлен.")

def signal_handler(sig, frame):
    graceful_shutdown()
    sys.exit(0)

atexit.register(graceful_shutdown)
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

if __name__ == '__main__':
    logger.info("🤖 Автоматическая система TTS запускается...")
    auto_system.ensure_initialized()
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)