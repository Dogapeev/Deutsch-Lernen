# Файл: tts-server/server.py
# ВЕРСИЯ 1.5.2 (DEFINITIVE FINAL): Исправлена ошибка TypeError при обработке старых форматов словарей.

import os
import json
import hashlib
import time
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from gtts import gTTS
import logging
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import threading
import queue
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
SUPPORTED_LANGUAGES = {'de', 'ru', 'en', 'fr', 'es'}

# Настройка логирования
log_level = logging.INFO
logging.basicConfig(level=log_level, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class AutoVocabularySystem:
    def __init__(self):
        self.audio_dir = Path(AUDIO_DIR)
        self.vocabularies_dir = Path(VOCABULARIES_DIR)
        self.config = self.load_config()
        self.processing_queue = queue.Queue()
        self.gtts_lock = threading.Lock()
        self._initialized = False
        self.file_observer = None

        os.makedirs(AUDIO_DIR, exist_ok=True)
        os.makedirs(VOCABULARIES_DIR, exist_ok=True)
        self.vocabulary_registry = self.load_manifest()
        self.background_thread = threading.Thread(target=self.background_processor, daemon=True)

    def ensure_initialized(self):
        if self._initialized: return
        logger.info("🚀 [INIT] Выполняю отложенную инициализацию...")
        if not self.background_thread.is_alive():
            self.background_thread.start()
        self.scan_vocabularies(auto_process=True)
        if self.config.get('auto_watch_enabled', True): self.start_file_watcher()
        self._initialized = True
        logger.info("✅ [INIT] Отложенная инициализация завершена.")

    def load_config(self):
        default_config = {"auto_watch_enabled": True, "auto_process_on_startup": True}
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    default_config.update(json.load(f))
            except Exception as e: logger.error(f"Ошибка загрузки конфигурации: {e}")
        return default_config
    
    def load_manifest(self):
        if os.path.exists(CACHE_MANIFEST):
            try:
                with open(CACHE_MANIFEST, 'r', encoding='utf-8') as f:
                    return json.load(f).get('vocabularies', {})
            except Exception as e: logger.error(f"Ошибка загрузки манифеста: {e}")
        return {}

    def save_manifest(self):
        try:
            with open(CACHE_MANIFEST, 'w', encoding='utf-8') as f:
                json.dump({'vocabularies': self.vocabulary_registry}, f, indent=2, ensure_ascii=False)
        except Exception as e: logger.error(f"Ошибка сохранения манифеста: {e}")

    def scan_vocabularies(self, auto_process=None):
        logger.info("🔍 [SCAN] Сканирование словарей...")
        if auto_process is None: auto_process = self.config.get('auto_process_on_startup', True)
        
        new_or_changed = []
        for vocab_file in self.vocabularies_dir.glob("*.json"):
            try:
                vocab_name = vocab_file.stem
                current_mtime = vocab_file.stat().st_mtime
                if (vocab_name not in self.vocabulary_registry or self.vocabulary_registry[vocab_name].get('last_modified', 0) < current_mtime):
                    with open(vocab_file, 'r', encoding='utf-8') as f:
                        vocab_data = json.load(f)
                    
                    # --- ИСПРАВЛЕНИЕ: "Железобетонная" проверка формата ---
                    word_count = 0
                    if isinstance(vocab_data, dict) and 'words' in vocab_data:
                        word_count = len(vocab_data['words']) # Новый формат
                    elif isinstance(vocab_data, list):
                        word_count = len(vocab_data) # Старый формат
                    else:
                        logger.error(f"❌ [SCAN] Неверный формат словаря в файле {vocab_file.name}. Пропускаем.")
                        continue # Пропустить этот файл

                    self.vocabulary_registry[vocab_name] = {'word_count': word_count, 'last_modified': current_mtime, 'status': 'detected'}
                    new_or_changed.append(vocab_name)
            except Exception as e:
                logger.error(f"❌ [SCAN] Ошибка обработки словаря {vocab_file.name}: {e}", exc_info=True)
        
        if new_or_changed:
            self.save_manifest()
            if auto_process:
                for vocab_name in new_or_changed:
                    self.processing_queue.put({'action': 'pregenerate', 'vocab_name': vocab_name})
                logger.info(f"🔄 [QUEUE] Добавлено в очередь на автогенерацию: {new_or_changed}")
        return new_or_changed

    def background_processor(self):
        logger.info("🔄 [BG_THREAD] Фоновый процессор запущен")
        while True:
            try:
                task = self.processing_queue.get()
                if task is None:
                    logger.info("[BG_THREAD] Получен сигнал на остановку."); break
                
                if task.get('action') == 'pregenerate':
                    vocab_name = task['vocab_name']
                    logger.info(f"🎵 [GEN] Начинаем автогенерацию для: {vocab_name}")
                    self.pregenerate_vocabulary_audio(vocab_name)
                    self.vocabulary_registry.setdefault(vocab_name, {})['status'] = 'ready'
                    self.save_manifest()
                    logger.info(f"✅ [GEN] Автогенерация для {vocab_name} завершена.")
                self.processing_queue.task_done()
            except Exception as e: logger.error(f"Критическая ошибка в фоновом процессоре: {e}", exc_info=not PRODUCTION)

    def start_file_watcher(self):
        if self.file_observer and self.file_observer.is_alive(): return
        class VocabularyFileHandler(FileSystemEventHandler):
            def __init__(self, system_ref): self.system, self.timer = system_ref, None
            def on_any_event(self, event):
                if not event.is_directory and event.src_path.endswith(".json"):
                    if self.timer: self.timer.cancel()
                    self.timer = threading.Timer(2.0, self.system.scan_vocabularies, args=[True]); self.timer.start()
        
        self.file_observer = Observer()
        self.file_observer.schedule(VocabularyFileHandler(self), str(self.vocabularies_dir), recursive=True)
        self.file_observer.start()
        logger.info(f"👁️ [WATCHER] Запущено слежение за папкой: {self.vocabularies_dir}")
        
    def stop_file_watcher(self):
        if self.file_observer and self.file_observer.is_alive():
            self.file_observer.stop(); self.file_observer.join(); logger.info("👁️ [WATCHER] Слежение остановлено")

    def pregenerate_vocabulary_audio(self, vocab_name: str):
        with open(Path(self.vocabularies_dir, f"{vocab_name}.json"), 'r', encoding='utf-8') as f:
            vocab_data = json.load(f)
        
        # --- ИСПРАВЛЕНИЕ: Безопасное извлечение списка слов ---
        words_list = vocab_data['words'] if isinstance(vocab_data, dict) and 'words' in vocab_data else vocab_data
        
        for entry in words_list:
            for field, lang in [('german', 'de'), ('russian', 'ru'), ('sentence', 'de'), ('sentence_ru', 'ru')]:
                if text := entry.get(field): self.generate_audio_sync(lang, text)

    def _get_text_hash(self, lang: str, text: str) -> str:
        return hashlib.md5(f"{lang}:{text}".encode('utf-8')).hexdigest()

    def _blocking_gtts_save(self, text, lang, path):
        with self.gtts_lock:
            tts = gTTS(text=text, lang=lang, slow=False)
            tts.save(path)

    def generate_audio_sync(self, lang: str, text: str):
        hash_val = self._get_text_hash(lang, text)
        filepath = self.audio_dir / f"{hash_val}.mp3"
        if filepath.exists(): return
        for attempt in range(1, 4):
            try:
                self._blocking_gtts_save(text, lang, str(filepath))
                logger.info(f"🔊 [TTS] Сгенерирован файл: {filepath.name}")
                return
            except Exception as e:
                logger.warning(f"⚠️ [TTS] Попытка {attempt} генерации {filepath.name} провалилась: {e}")
                if attempt < 3: time.sleep(attempt * 2)
                else: logger.error(f"❌ [TTS] Не удалось сгенерировать {filepath.name} после 3 попыток.")

auto_system = AutoVocabularySystem()

@app.route('/synthesize', methods=['GET'])
@limiter.limit("30 per minute")
def synthesize_speech():
    auto_system.ensure_initialized()
    text = request.args.get('text', '').strip()
    lang = request.args.get('lang', '').lower()
    if not (1 < len(text) <= 500 and lang in SUPPORTED_LANGUAGES):
        return jsonify({"error": "Invalid input"}), 400
    try:
        auto_system.generate_audio_sync(lang, text)
        hash_val = auto_system._get_text_hash(lang, text)
        return jsonify({"url": f"/audio/{hash_val}.mp3"})
    except Exception as e:
        logger.error(f"Ошибка динамической генерации: {e}")
        return jsonify({"error": "Failed to generate audio"}), 500

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
    return send_from_directory(str(auto_system.vocabularies_dir), f"{vocab_name}.json")

@app.route('/status')
def system_status():
    return jsonify({"version": "1.5.2-final-fix", "initialized": auto_system._initialized})

def graceful_shutdown():
    logger.info("🛑 [SHUTDOWN] Инициирована корректная остановка сервера...")
    auto_system.stop_file_watcher()
    if auto_system.background_thread.is_alive():
        auto_system.processing_queue.put(None)
        auto_system.background_thread.join(timeout=5)
    logger.info("✅ [SHUTDOWN] Сервер остановлен.")

atexit.register(graceful_shutdown)
signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))
signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))

if __name__ == '__main__':
    logger.info("🤖 [MAIN] Запуск системы TTS...")
    auto_system.ensure_initialized()
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)