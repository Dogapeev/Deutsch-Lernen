# Файл: tts-server/server.py
# ВЕРСИЯ 2.3.1 (PEP 8 Compliant):
# Финальная версия с полным набором метрик, health-чеков,
# административных эндпоинтов и чистым, профессиональным форматированием.

import os
import json
import hashlib
import time
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
from gtts import gTTS
import logging
import threading
import queue
from datetime import datetime, timedelta
from collections import deque
import sys
import atexit
import signal
from io import BytesIO

# --- Библиотеки для работы с Google Drive и Limiter ---
from googleapiclient.discovery import build
from google.oauth2.service_account import Credentials
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# --- Конфигурация ---
class Config:
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
    ADMIN_TOKEN = os.getenv('ADMIN_TOKEN')
    CORS_ORIGINS = os.getenv('CORS_ORIGINS', '*')
    FOLDER_ID = os.getenv('GOOGLE_DRIVE_FOLDER_ID')
    CREDENTIALS_FILE = 'credentials.json'
    SCOPES = ['https://www.googleapis.com/auth/drive']
    LOCAL_CACHE_DIR = "/tmp/audio_cache"
    SUPPORTED_LANGUAGES = {'de', 'ru', 'en', 'fr', 'es'}
    MAX_TEXT_LENGTH = 250

# --- Настройка логирования и Flask ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
app = Flask(__name__)
CORS(app, origins=Config.CORS_ORIGINS.split(','))
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"]
)

# === ДОБАВЛЕНО: Класс для сбора метрик ===
class SystemMetrics:
    def __init__(self):
        self.start_time = time.time()
        self.request_count = 0
        self.tts_generation_count = 0
        self.cache_hits = 0
        self.cache_misses = 0
        self.gdrive_uploads = 0
        self.gdrive_downloads = 0
        self.errors = 0
        self.lock = threading.Lock()

    def record_request(self):
        with self.lock:
            self.request_count += 1

    def record_tts_generation(self):
        with self.lock:
            self.tts_generation_count += 1

    def record_cache_hit(self):
        with self.lock:
            self.cache_hits += 1

    def record_cache_miss(self):
        with self.lock:
            self.cache_misses += 1

    def record_gdrive_upload(self):
        with self.lock:
            self.gdrive_uploads += 1

    def record_gdrive_download(self):
        with self.lock:
            self.gdrive_downloads += 1

    def record_error(self):
        with self.lock:
            self.errors += 1

    def get_stats(self):
        with self.lock:
            uptime = time.time() - self.start_time
            if (self.cache_hits + self.cache_misses) > 0:
                hit_rate = (self.cache_hits / (self.cache_hits + self.cache_misses)) * 100
            else:
                hit_rate = 0

            return {
                "uptime_seconds": round(uptime, 2),
                "requests_total": self.request_count,
                "tts_generations_total": self.tts_generation_count,
                "cache_hit_rate_percent": round(hit_rate, 2),
                "cache_hits": self.cache_hits,
                "cache_misses": self.cache_misses,
                "gdrive_uploads": self.gdrive_uploads,
                "gdrive_downloads": self.gdrive_downloads,
                "errors_total": self.errors,
                "requests_per_minute": round((self.request_count / uptime) * 60, 2) if uptime > 0 else 0
            }

# --- Класс кэша с режимом отката (Fallback) ---
class GDriveCacheWithFallback:
    def __init__(self):
        self.gdrive_enabled = False
        self.service = None
        self.folder_id = None
        self.file_cache = {}
        self._initialize()

    def _initialize(self):
        try:
            if Config.FOLDER_ID and os.path.exists(Config.CREDENTIALS_FILE):
                creds = Credentials.from_service_account_file(
                    Config.CREDENTIALS_FILE, scopes=Config.SCOPES
                )
                self.service = build('drive', 'v3', credentials=creds)
                self.folder_id = Config.FOLDER_ID
                self._populate_initial_cache()
                self.gdrive_enabled = True
                logger.info("☁️ [CACHE] Google Drive успешно подключен. Режим: hybrid.")
            else:
                logger.warning("⚠️ [CACHE] Google Drive не настроен. Работаем в режиме только локального кэша.")
        except Exception as e:
            logger.error(f"❌ [CACHE] Ошибка подключения к Google Drive: {e}")
            logger.warning("🔄 [CACHE] Переключаемся в режим только локального кэширования.")

    def _populate_initial_cache(self):
        logger.info("Загрузка списка файлов из Google Диска...")
        page_token = None
        while True:
            response = self.service.files().list(
                q=f"'{self.folder_id}' in parents and trashed=false",
                fields="nextPageToken, files(id, name)",
                pageToken=page_token
            ).execute()
            for file in response.get('files', []):
                self.file_cache[file.get('name')] = file.get('id')
            page_token = response.get('nextPageToken', None)
            if page_token is None:
                break
        logger.info(f"Найдено {len(self.file_cache)} файлов в кэше Google Диска.")

    def check_exists(self, filename):
        return self.file_cache.get(filename) is not None if self.gdrive_enabled else False

    def upload(self, in_memory_file, filename):
        if not self.gdrive_enabled:
            return False
        try:
            in_memory_file.seek(0)
            file_metadata = {'name': filename, 'parents': [self.folder_id]}
            media = MediaIoBaseUpload(in_memory_file, mimetype='audio/mpeg')
            file = self.service.files().create(
                body=file_metadata, media_body=media, fields='id'
            ).execute()
            self.file_cache[filename] = file.get('id')
            return True
        except Exception as e:
            logger.error(f"Ошибка загрузки '{filename}' на GDrive: {e}")
            return False

    def download_to_stream(self, filename):
        if not self.gdrive_enabled:
            return None
        file_id = self.file_cache.get(filename)
        if not file_id:
            return None
        try:
            request = self.service.files().get_media(fileId=file_id)
            fh = BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            fh.seek(0)
            return fh
        except Exception as e:
            logger.error(f"Ошибка скачивания '{filename}' с GDrive: {e}")
            return None

# --- Класс защиты от Rate Limiting ---
class SmartTTSRateLimiter:
    def __init__(self, max_requests_per_minute=6, max_requests_per_hour=60):
        self.max_per_minute = max_requests_per_minute
        self.max_per_hour = max_requests_per_hour
        self.minute_requests = deque()
        self.hour_requests = deque()
        self.lock = threading.Lock()

    def can_make_request(self):
        with self.lock:
            now = datetime.now()
            one_minute_ago = now - timedelta(minutes=1)
            one_hour_ago = now - timedelta(hours=1)
            while self.minute_requests and self.minute_requests[0] < one_minute_ago:
                self.minute_requests.popleft()
            while self.hour_requests and self.hour_requests[0] < one_hour_ago:
                self.hour_requests.popleft()

            if len(self.minute_requests) >= self.max_per_minute:
                return False, "minute_limit"
            if len(self.hour_requests) >= self.max_per_hour:
                return False, "hour_limit"
            return True, "ok"

    def record_request(self):
        with self.lock:
            self.minute_requests.append(datetime.now())
            self.hour_requests.append(datetime.now())

# --- Основная логика TTS сервера ---
class AutoVocabularySystem:
    def __init__(self):
        self.local_cache_dir = Path(Config.LOCAL_CACHE_DIR)
        os.makedirs(self.local_cache_dir, exist_ok=True)
        logger.info(f"📁 [LOCAL CACHE] Локальный кэш (Уровень 1) инициализирован в: {self.local_cache_dir}")

        self.gdrive_cache = GDriveCacheWithFallback()
        self.tts_limiter = SmartTTSRateLimiter()
        self.failed_generations = {}
        self.gtts_lock = threading.Lock()
        self.background_thread = threading.Thread(
            target=self.background_processor, daemon=True
        )
        self.initialization_lock = threading.Lock()
        self._initialized = False
        self.metrics = SystemMetrics()

    def ensure_initialized(self):
        with self.initialization_lock:
            if self._initialized:
                return
            logger.info("🚀 [INIT] Выполняю отложенную инициализацию...")
            self.background_thread.start()
            self._initialized = True
            logger.info("✅ [INIT] Инициализация завершена.")

    def _get_text_hash(self, lang, text):
        return hashlib.md5(f"{lang}:{text}".encode('utf-8')).hexdigest()

    def generate_audio_sync(self, lang, text):
        filename = f"{self._get_text_hash(lang, text)}.mp3"
        local_filepath = self.local_cache_dir / filename

        if local_filepath.exists():
            return True

        if self.gdrive_cache.check_exists(filename):
            try:
                audio_stream = self.gdrive_cache.download_to_stream(filename)
                if audio_stream:
                    self.metrics.record_gdrive_download()
                    with open(local_filepath, "wb") as f:
                        f.write(audio_stream.getbuffer())
                    return True
            except Exception as e:
                logger.error(f"Ошибка восстановления из GDrive: {e}")

        failure_key = f"{lang}:{text}"
        if failure_key in self.failed_generations:
            _, attempt_count = self.failed_generations[failure_key]
            if attempt_count >= 3:
                return False

        can_request, reason = self.tts_limiter.can_make_request()
        if not can_request:
            logger.warning(f"⏳ [RATE_LIMIT] Пропускаю генерацию из-за {reason}")
            return False

        try:
            self.tts_limiter.record_request()
            cleaned_text = ''.join(c for c in text if c.isprintable() and c not in '<>&')
            if not cleaned_text.strip():
                return False

            with self.gtts_lock:
                tts = gTTS(text=cleaned_text, lang=lang, slow=False)
                in_memory_file = BytesIO()
                tts.write_to_fp(in_memory_file)

            with open(local_filepath, "wb") as f:
                f.write(in_memory_file.getbuffer())
            self.metrics.record_tts_generation()

            if self.gdrive_cache.upload(in_memory_file, filename):
                self.metrics.record_gdrive_upload()

            if failure_key in self.failed_generations:
                del self.failed_generations[failure_key]
            return True
        except Exception as e:
            current_attempt = self.failed_generations.get(failure_key, (0, 0))[1] + 1
            self.failed_generations[failure_key] = (time.time(), current_attempt)
            self.metrics.record_error()
            if any(k in str(e).lower() for k in ['quota', 'limit', '429']):
                logger.error("🚫 [QUOTA] Превышен лимит Google TTS")
            else:
                logger.error(f"❌ [TTS] Ошибка генерации {filename}: {e}")
            return False

    def background_processor(self):
        logger.info("🔄 [BG_THREAD] Фоновый процессор запущен")
        # В будущем здесь может быть логика для отложенных задач

auto_system = AutoVocabularySystem()

# --- Middleware и обработчики ошибок ---
@app.before_request
def before_request_middleware():
    auto_system.metrics.record_request()
    auto_system.ensure_initialized()
    # Пропускаем проверку для эндпоинтов мониторинга
    if request.path in ['/health', '/metrics'] or request.path.startswith('/admin'):
        return
    if request.content_length and request.content_length > 1024 * 1024:  # 1MB limit
        return jsonify({"error": "Request too large"}), 413

@app.errorhandler(500)
def handle_500(e):
    auto_system.metrics.record_error()
    logger.error(f"Internal server error: {e}", exc_info=True)
    return jsonify(error="Internal server error"), 500

@app.errorhandler(404)
def handle_404(e):
    auto_system.metrics.record_error()
    return jsonify(error="Not found"), 404

# --- API Endpoints ---
@app.route('/audio/<filename>')
def serve_audio(filename):
    try:
        if not filename.endswith('.mp3'):
            return jsonify({"error": "Invalid file format"}), 400

        local_filepath = auto_system.local_cache_dir / filename
        if local_filepath.exists():
            auto_system.metrics.record_cache_hit()
            return send_from_directory(str(auto_system.local_cache_dir), filename)

        auto_system.metrics.record_cache_miss()
        if auto_system.gdrive_cache.check_exists(filename):
            audio_stream = auto_system.gdrive_cache.download_to_stream(filename)
            if audio_stream:
                auto_system.metrics.record_gdrive_download()
                with open(local_filepath, "wb") as f:
                    f.write(audio_stream.getbuffer())
                return send_from_directory(str(auto_system.local_cache_dir), filename)

        return jsonify({"error": "File not found"}), 404
    except Exception as e:
        auto_system.metrics.record_error()
        logger.error(f"Ошибка обслуживания {filename}: {e}")
        return jsonify(error="Server error"), 500

@app.route('/synthesize', methods=['GET', 'POST'])
@limiter.limit("10 per minute")
def synthesize_text():
    try:
        if request.method == 'GET':
            text = request.args.get('text', '').strip()
            lang = request.args.get('lang', 'de').strip()
        else:
            data = request.json or {}
            text = data.get('text', '').strip()
            lang = data.get('lang', 'de').strip()

        if not text or not lang:
            return jsonify(error="Parameters 'text' and 'lang' are required"), 400
        if len(text) > Config.MAX_TEXT_LENGTH:
            return jsonify(error=f"Text too long (max {Config.MAX_TEXT_LENGTH})"), 400
        if lang not in Config.SUPPORTED_LANGUAGES:
            return jsonify(error=f"Unsupported language: {lang}"), 400

        if auto_system.generate_audio_sync(lang, text):
            filename = auto_system._get_text_hash(lang, text) + ".mp3"
            return jsonify(status="success", url=f"/audio/{filename}")
        else:
            auto_system.metrics.record_error()
            return jsonify(error="TTS generation failed"), 503
    except Exception as e:
        auto_system.metrics.record_error()
        logger.error(f"Error in synthesize: {e}")
        return jsonify(error="Server error"), 500

# --- Эндпоинты мониторинга и администрирования ---
@app.route('/health')
def health_check():
    try:
        components = {
            "system_initialized": auto_system._initialized,
            "background_processor_alive": auto_system.background_thread.is_alive(),
            "local_cache_writable": os.access(auto_system.local_cache_dir, os.W_OK),
            "gdrive_connected": auto_system.gdrive_cache.gdrive_enabled
        }
        is_healthy = all(components.values())
        return jsonify(status="healthy" if is_healthy else "degraded", components=components), 200 if is_healthy else 503
    except Exception as e:
        return jsonify(status="unhealthy", error=str(e)), 500

@app.route('/metrics')
def get_metrics():
    try:
        stats = auto_system.metrics.get_stats()
        can_request, reason = auto_system.tts_limiter.can_make_request()
        stats["tts_rate_limit_status"] = {
            "can_generate": can_request, "reason": reason,
            "minute_requests": len(auto_system.tts_limiter.minute_requests),
            "hour_requests": len(auto_system.tts_limiter.hour_requests)
        }
        return jsonify(stats)
    except Exception as e:
        return jsonify(error=f"Failed to get metrics: {e}"), 500

@app.route('/admin/stats')
def admin_stats():
    if not Config.ADMIN_TOKEN or request.headers.get('X-Admin-Token') != Config.ADMIN_TOKEN:
        return jsonify(error="Unauthorized"), 401
    return jsonify(
        metrics=auto_system.metrics.get_stats(),
        failed_generations=auto_system.failed_generations
    )

@app.route('/admin/cleanup', methods=['POST'])
def admin_cleanup():
    if not Config.ADMIN_TOKEN or request.headers.get('X-Admin-Token') != Config.ADMIN_TOKEN:
        return jsonify(error="Unauthorized"), 401
    failed_count = len(auto_system.failed_generations)
    auto_system.failed_generations.clear()
    return jsonify(status="cleaned", cleared_failed_generations=failed_count)

# --- Управление запуском и остановкой ---
def validate_environment():
    warnings = []
    if not Config.FOLDER_ID:
        warnings.append("GOOGLE_DRIVE_FOLDER_ID не задан - GDrive будет отключен")
    if not os.path.exists(Config.CREDENTIALS_FILE):
        warnings.append(f"{Config.CREDENTIALS_FILE} не найден - GDrive будет отключен")
    if not Config.ADMIN_TOKEN:
        warnings.append("ADMIN_TOKEN не задан - админ-эндпоинты будут недоступны")
    if Config.CORS_ORIGINS == '*':
        warnings.append("CORS_ORIGINS='*' - рекомендуется ограничить для production")
    for warning in warnings:
        logger.warning(f"⚠️ [ENV] {warning}")

def graceful_shutdown():
    logger.info("🛑 [SHUTDOWN] Инициирована корректная остановка сервера...")
    auto_system.processing_queue.put(None)
    auto_system.background_thread.join(timeout=5)
    logger.info("✅ [SHUTDOWN] Сервер остановлен.")

atexit.register(graceful_shutdown)
signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))
signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))

if __name__ == '__main__':
    validate_environment()
    port = int(os.getenv('PORT', 5000))
    debug = Config.DEBUG
    logger.info(f"🚀 Запуск TTS сервера v2.3.1 (PEP 8) на порту {port}")
    logger.info(f"📢 Режим отладки: {debug}")
    app.run(host='0.0.0.0', port=port, debug=debug)