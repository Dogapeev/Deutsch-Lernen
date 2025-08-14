# Файл: tts-server/server.py
# ВЕРСИЯ 1.4.4: Финальное исправление ошибки '429' с помощью глобальной блокировки потоков (threading.Lock)

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
import threading # <-- 1. ИМПОРТИРУЕМ threading
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
        
        # --- 2. ЗАМЕНЯЕМ asyncio.Semaphore НА threading.Lock ---
        # Этот замок будет работать для всего приложения, а не только для одного event loop.
        self.gtts_lock = threading.Lock()
        
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
        if self._initialized: return
        logger.info("🚀 Выполняю отложенную инициализацию...")
        self.scan_vocabularies(auto_process=True)
        if self.config.get('auto_watch_enabled', True): self.start_file_watcher()
        self._initialized = True
        logger.info("✅ Отложенная инициализация завершена")

    def load_config(self):
        default_config = {
            "auto_watch_enabled": True, "auto_process_on_change": True,
            "auto_process_on_startup": True, "retry_failed": True,
            "cleanup_on_startup": False, "auto_cleanup_enabled": True,
            "cleanup_interval_hours": 24, "min_access_count_protect": 2,
            "max_cache_files": 1000, "max_cache_size_mb": 500,
            "check_interval_seconds": 300, "supported_extensions": [".json"],
            "exclude_patterns": [".*", "~*", "*~", "*.bak", "*.tmp"]
        }
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    loaded_config = json.load(f)
                    default_config.update(loaded_config)
                logger.info("🔧 Конфигурация загружена из файла")
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
        except Exception as e: logger.error(f"Ошибка загрузки манифеста: {e}", exc_info=not PRODUCTION)

    def save_manifest(self):
        try:
            data = {'protected_hashes': list(self.protected_hashes), 'vocabularies': self.vocabulary_registry, 'last_updated': datetime.now().isoformat()}
            with open(CACHE_MANIFEST, 'w', encoding='utf-8') as f: json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e: logger.error(f"Ошибка сохранения манифеста: {e}", exc_info=not PRODUCTION)

    def scan_vocabularies(self, auto_process=None):
        logger.info("🔍 Сканирование словарей...")
        if auto_process is None: auto_process = self.config.get('auto_process_on_startup', True)
        if not self.vocabularies_dir.exists():
            logger.error(f"❌ Директория словарей не найдена: {self.vocabularies_dir}"); return []
            
        vocab_files = [p for ext in self.config['supported_extensions'] for p in self.vocabularies_dir.glob(f"*{ext}")]
        logger.info(f"📁 Найдено файлов для анализа: {len(vocab_files)}")
        new_or_changed = []
        
        for vocab_file in vocab_files:
            if any(vocab_file.match(p) for p in self.config['exclude_patterns']):
                logger.info(f"⏭️ Пропускаем файл по правилу исключения: {vocab_file.name}"); continue
            try:
                current_mtime = vocab_file.stat().st_mtime
                vocab_name = vocab_file.stem
                if (vocab_name not in self.vocabulary_registry or self.vocabulary_registry[vocab_name].get('last_modified', 0) < current_mtime):
                    with open(vocab_file, 'r', encoding='utf-8') as f: vocab_data = json.load(f)
                    if isinstance(vocab_data, dict) and 'words' in vocab_data: word_count = len(vocab_data['words'])
                    elif isinstance(vocab_data, list): word_count = len(vocab_data)
                    else: logger.error(f"❌ Неверный формат словаря: {vocab_file.name}"); continue
                    self.vocabulary_registry[vocab_name] = {'file_path': str(vocab_file), 'word_count': word_count, 'last_modified': current_mtime, 'status': 'detected'}
                    new_or_changed.append(vocab_name)
                    logger.info(f"✅ Словарь {vocab_name} добавлен/обновлен ({word_count} слов)")
            except Exception as e: logger.error(f"❌ Ошибка обработки словаря {vocab_file.name}: {e}", exc_info=not PRODUCTION)
        
        if new_or_changed:
            self.save_manifest()
            if auto_process:
                if not self.background_thread.is_alive(): self.background_thread.start()
                for vocab_name in new_or_changed:
                    asyncio.run_coroutine_threadsafe(self.add_to_processing_queue(vocab_name), self.loop)
                logger.info(f"🔄 Добавлено в очередь на автогенерацию: {new_or_changed}")
        return new_or_changed

    async def add_to_processing_queue(self, vocab_name):
        await self.processing_queue.put({'action': 'pregenerate', 'vocab_name': vocab_name})

    def run_background_processor(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self.background_processor())

    async def background_processor(self):
        logger.info("🔄 Фоновый процессор запущен")
        while True:
            try:
                task = await self.processing_queue.get()
                if isinstance(task, asyncio.CancelledError): break
                if task.get('action') == 'pregenerate':
                    vocab_name = task['vocab_name']
                    logger.info(f"🎵 Начинаем автогенерацию для: {vocab_name}")
                    result = await self.pregenerate_vocabulary_audio(vocab_name)
                    logger.info(f"✅ Автогенерация для {vocab_name} завершена: {result}")
                    self.vocabulary_registry.setdefault(vocab_name, {})['status'] = 'ready'
                    self.save_manifest()
                self.processing_queue.task_done()
            except asyncio.CancelledError: logger.info("Фоновый процессор останавливается."); break
            except Exception as e: logger.error(f"Критическая ошибка в фоновом процессоре: {e}", exc_info=not PRODUCTION); await asyncio.sleep(10)

    def start_file_watcher(self):
        if self.file_observer and self.file_observer.is_alive(): return
        class VocabularyFileHandler(FileSystemEventHandler):
            def __init__(self, system_ref): self.system = system_ref; self.timer = None
            def on_any_event(self, event):
                if not event.is_directory and any(event.src_path.endswith(ext) for ext in self.system.config['supported_extensions']):
                    if self.timer: self.timer.cancel()
                    self.timer = threading.Timer(2.0, self.system.scan_vocabularies, args=[True]); self.timer.start()
        self.file_observer = Observer()
        self.file_observer.schedule(VocabularyFileHandler(self), str(self.vocabularies_dir), recursive=True)
        self.file_observer.start(); logger.info(f"👁️ Запущено слежение за папкой: {self.vocabularies_dir}")
        
    def stop_file_watcher(self):
        if self.file_observer and self.file_observer.is_alive(): 
            self.file_observer.stop(); self.file_observer.join(); logger.info("👁️ Слежение за файлами остановлено")

    async def pregenerate_vocabulary_audio(self, vocab_name: str):
        if vocab_name not in self.vocabulary_registry: raise ValueError(f"Словарь {vocab_name} не найден")
        with open(self.vocabulary_registry[vocab_name]['file_path'], 'r', encoding='utf-8') as f: vocab_data = json.load(f)
        words_list = vocab_data.get('words', vocab_data)
        hash_to_text_map = {self._get_text_hash(lang, entry.get(field)): (lang, entry.get(field))
                            for entry in words_list for field, lang in [('german', 'de'), ('russian', 'ru'), ('sentence', 'de'), ('sentence_ru', 'ru')] if entry.get(field)}
        missing_hashes = {h for h in hash_to_text_map if not (self.audio_dir / f"{h}.mp3").exists()}
        if not missing_hashes: return {'status': 'all_files_exist', 'count': len(hash_to_text_map)}
        logger.info(f"🎵 {vocab_name}: требуется {len(missing_hashes)} аудиофайлов")
        tasks = [self._generate_audio_file(h, *hash_to_text_map[h]) for h in missing_hashes]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        success_count = sum(1 for r in results if r is not None and not isinstance(r, Exception))
        return {'generated': success_count, 'failed': len(results) - success_count}

    def _get_text_hash(self, lang: str, text: str) -> str:
        return hashlib.md5(f"{lang}:{text}".encode('utf-8')).hexdigest()

    async def _generate_audio_file(self, hash_value: str, lang: str, text: str):
        filepath = self.audio_dir / f"{hash_value}.mp3"
        if filepath.exists(): return hash_value
        for attempt in range(3):
            try:
                await asyncio.get_event_loop().run_in_executor(None, self._blocking_gtts_save, text, lang, str(filepath))
                logger.info(f"✅ Сгенерирован файл: {filepath.name}")
                return hash_value
            except Exception as e:
                logger.warning(f"Попытка {attempt + 1} генерации {filepath.name} провалилась: {e}")
                if attempt < 2: await asyncio.sleep(2 ** attempt)
                else: raise

    # --- 3. ФУНКЦИЯ СОХРАНЕНИЯ ТЕПЕРЬ ЗАЩИЩЕНА БЛОКИРОВКОЙ ---
    def _blocking_gtts_save(self, text, lang, path):
        # Эта блокировка гарантирует, что только один поток (из любого места) может выполнять этот код
        with self.gtts_lock:
            tts = gTTS(text=text, lang=lang, slow=False)
            tts.save(path)

    # --- 4. СОЗДАЕМ СИНХРОННУЮ ВЕРСИЮ ГЕНЕРАТОРА ДЛЯ FLASK ---
    def generate_audio_sync(self, hash_value: str, lang: str, text: str):
        filepath = self.audio_dir / f"{hash_value}.mp3"
        if filepath.exists(): return
        for attempt in range(3):
            try:
                self._blocking_gtts_save(text, lang, str(filepath))
                logger.info(f"✅ Сгенерирован файл (синхронно): {filepath.name}")
                return
            except Exception as e:
                logger.warning(f"Синхронная попытка {attempt + 1} генерации {filepath.name} провалилась: {e}")
                if attempt < 2: time.sleep(2 ** attempt)
                else: raise

auto_system = AutoVocabularySystem()

@app.route('/synthesize', methods=['GET'])
@limiter.limit("30 per minute")
def synthesize_speech():
    auto_system.ensure_initialized()
    text, lang = request.args.get('text', '').strip(), request.args.get('lang', '').lower()
    if not (1 < len(text) <= 500 and lang in SUPPORTED_LANGUAGES): return jsonify({"error": "Invalid input"}), 400
    
    hash_val = auto_system._get_text_hash(lang, text)
    filename = f"{hash_val}.mp3"
    filepath = auto_system.audio_dir / filename
    
    if not filepath.exists():
        try:
            # --- 5. ВЫЗЫВАЕМ СИНХРОННУЮ ВЕРСИЮ ---
            auto_system.generate_audio_sync(hash_val, lang, text)
            logger.info(f"🎤 Динамическая генерация: {filename}")
        except Exception as e:
            logger.error(f"Ошибка динамической генерации: {e}", exc_info=not PRODUCTION)
            return jsonify({"error": "Failed to generate audio"}), 500
            
    return jsonify({"url": f"/audio/{filename}"})

@app.route('/audio/<filename>')
def serve_audio(filename):
    return send_from_directory(str(auto_system.audio_dir), filename)

@app.route('/api/vocabularies/list')
def get_vocabularies_list():
    auto_system.ensure_initialized()
    return jsonify([{"name": name, "word_count": data.get('word_count', 0)} for name, data in auto_system.vocabulary_registry.items()])

@app.route('/api/vocabulary/<vocab_name>')
def get_vocabulary(vocab_name):
    auto_system.ensure_initialized()
    if vocab_name not in auto_system.vocabulary_registry: return jsonify({"error": "Not found"}), 404
    return send_from_directory(str(auto_system.vocabularies_dir), f"{vocab_name}.json")

@app.route('/status')
def system_status():
    return jsonify({"version": "1.4.4-threading-lock-fix", "initialized": auto_system._initialized})

def graceful_shutdown():
    logger.info("🛑 Инициирована корректная остановка сервера...")
    auto_system.stop_file_watcher()
    if auto_system.background_thread.is_alive():
        if not auto_system.loop.is_closed():
            asyncio.run_coroutine_threadsafe(auto_system.processing_queue.put(asyncio.CancelledError()), auto_system.loop)
        auto_system.background_thread.join(timeout=3)
    logger.info("✅ Сервер остановлен.")

atexit.register(graceful_shutdown)
signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))
signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))

if __name__ == '__main__':
    logger.info("🤖 Автоматическая система TTS запускается...")
    auto_system.ensure_initialized()
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)