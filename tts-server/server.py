# Файл: server.py
# ВЕРСИЯ 2.3.5 (Final Production + Vocabulary API):
# Добавлена поддержка раздачи JSON-файлов словарей.

import os
import json
import hashlib
import time
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from gtts import gTTS
import logging
import threading
from datetime import datetime, timedelta
from collections import deque
import sys
import atexit
import signal
from io import BytesIO

# --- Библиотеки для работы с Google Drive ---
try:
    from googleapiclient.discovery import build
    from google.oauth2.service_account import Credentials
    from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload
    GDRIVE_AVAILABLE = True
except ImportError:
    GDRIVE_AVAILABLE = False
    logging.warning("Google Drive libraries not available. Running in local-only mode.")

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
    
    # Platform detection
    IS_RENDER = os.getenv('RENDER') == 'true'
    IS_HEROKU = 'DYNO' in os.environ
    IS_RAILWAY = 'RAILWAY_ENVIRONMENT' in os.environ
    IS_CLOUD = IS_RENDER or IS_HEROKU or IS_RAILWAY

    # --- НОВАЯ КОНФИГУРАЦИЯ ---
    VOCABULARIES_DIR = "vocabularies" # Папка со словарями


# --- Настройка логирования ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# --- Flask App ---
app = Flask(__name__)
CORS(app, origins=Config.CORS_ORIGINS.split(','))
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"] # Старые лимиты для TTS
)

# --- НОВЫЙ ДЕКОРАТОР ДЛЯ ОТКЛЮЧЕНИЯ ЛИМИТОВ ---
# Мы не хотим ограничивать доступ к словарям
def no_limit():
    return "unlimited"

# ... (весь ваш существующий код от ThreadSafeMetrics до TTSSystem остается без изменений) ...
# ...
# === Gevent-safe метрики ===
class ThreadSafeMetrics:
    def __init__(self):
        self.start_time = time.time()
        self._data = {
            'request_count': 0,
            'tts_generation_count': 0,
            'cache_hits': 0,
            'cache_misses': 0,
            'gdrive_uploads': 0,
            'gdrive_downloads': 0,
            'errors': 0
        }
        self._lock = threading.RLock()

    def _safe_increment(self, key):
        try:
            with self._lock:
                self._data[key] += 1
        except Exception:
            # Fallback для случаев конфликта с gevent
            self._data[key] += 1

    def record_request(self):
        self._safe_increment('request_count')

    def record_tts_generation(self):
        self._safe_increment('tts_generation_count')

    def record_cache_hit(self):
        self._safe_increment('cache_hits')

    def record_cache_miss(self):
        self._safe_increment('cache_misses')

    def record_gdrive_upload(self):
        self._safe_increment('gdrive_uploads')

    def record_gdrive_download(self):
        self._safe_increment('gdrive_downloads')

    def record_error(self):
        self._safe_increment('errors')

    def get_stats(self):
        try:
            with self._lock:
                data = self._data.copy()
                uptime = time.time() - self.start_time
                
                total_cache_ops = data['cache_hits'] + data['cache_misses']
                hit_rate = (data['cache_hits'] / total_cache_ops * 100) if total_cache_ops > 0 else 0

                return {
                    "uptime_seconds": round(uptime, 2),
                    "requests_total": data['request_count'],
                    "tts_generations_total": data['tts_generation_count'],
                    "cache_hit_rate_percent": round(hit_rate, 2),
                    "cache_hits": data['cache_hits'],
                    "cache_misses": data['cache_misses'],
                    "gdrive_uploads": data['gdrive_uploads'],
                    "gdrive_downloads": data['gdrive_downloads'],
                    "errors_total": data['errors'],
                    "requests_per_minute": round((data['request_count'] / uptime) * 60, 2) if uptime > 0 else 0
                }
        except Exception as e:
            logger.error(f"Error getting stats: {e}")
            return {
                "uptime_seconds": round(time.time() - self.start_time, 2),
                "error": "Stats collection issue"
            }

# === Rate Limiter ===
class SmartTTSRateLimiter:
    def __init__(self, max_requests_per_minute=6, max_requests_per_hour=60):
        self.max_per_minute = max_requests_per_minute
        self.max_per_hour = max_requests_per_hour
        self.minute_requests = deque()
        self.hour_requests = deque()
        self._lock = threading.RLock()

    def can_make_request(self):
        try:
            with self._lock:
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
        except Exception:
            # Fallback при проблемах с threading
            return True, "ok"

    def record_request(self):
        try:
            with self._lock:
                now = datetime.now()
                self.minute_requests.append(now)
                self.hour_requests.append(now)
        except Exception:
            pass  # Игнорируем ошибки в облачном окружении

# === Google Drive Cache ===
class GoogleDriveCache:
    def __init__(self):
        self.gdrive_enabled = False
        self.service = None
        self.folder_id = None
        self.file_cache = {}
        self._init_lock = threading.Lock()
        self._initialized = False

    def _initialize(self):
        with self._init_lock:
            if self._initialized:
                return
            
            if not GDRIVE_AVAILABLE:
                logger.warning("⚠️ Google Drive libraries not installed. Local-only mode.")
                self._initialized = True
                return
                
            try:
                if Config.FOLDER_ID and os.path.exists(Config.CREDENTIALS_FILE):
                    creds = Credentials.from_service_account_file(
                        Config.CREDENTIALS_FILE, scopes=Config.SCOPES
                    )
                    self.service = build('drive', 'v3', credentials=creds)
                    self.folder_id = Config.FOLDER_ID
                    self._populate_cache()
                    self.gdrive_enabled = True
                    logger.info("☁️ Google Drive connected successfully")
                else:
                    logger.warning("⚠️ Google Drive not configured. Local-only mode.")
            except Exception as e:
                logger.error(f"❌ Google Drive initialization error: {e}")
                logger.info("🔄 Switching to local-only mode")
            finally:
                self._initialized = True

    def _populate_cache(self):
        try:
            logger.info("📥 Loading file list from Google Drive...")
            response = self.service.files().list(
                q=f"'{self.folder_id}' in parents and trashed=false",
                fields="files(id, name)",
                pageSize=1000
            ).execute()
            
            for file in response.get('files', []):
                self.file_cache[file.get('name')] = file.get('id')
            
            logger.info(f"✅ Found {len(self.file_cache)} files in Google Drive cache")
        except Exception as e:
            logger.error(f"Error loading cache: {e}")

    def ensure_initialized(self):
        if not self._initialized:
            self._initialize()

    def check_exists(self, filename):
        self.ensure_initialized()
        return self.gdrive_enabled and filename in self.file_cache

    def upload(self, in_memory_file, filename):
        self.ensure_initialized()
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
            logger.error(f"Error uploading to GDrive: {e}")
            return False

    def download_to_stream(self, filename):
        self.ensure_initialized()
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
            logger.error(f"Error downloading from GDrive: {e}")
            return None

# === Main TTS System ===
class TTSSystem:
    def __init__(self):
        self.local_cache_dir = Path(Config.LOCAL_CACHE_DIR)
        os.makedirs(self.local_cache_dir, exist_ok=True)
        
        self.gdrive_cache = GoogleDriveCache()
        self.tts_limiter = SmartTTSRateLimiter()
        self.failed_generations = {}
        self.metrics = ThreadSafeMetrics()
        
        # Thread-safe TTS lock
        self.gtts_lock = threading.Lock()
        
        # Lazy initialization
        self._initialized = False
        self.initialization_lock = threading.Lock()
        
        logger.info(f"📁 Local cache initialized: {self.local_cache_dir}")

    def ensure_initialized(self):
        with self.initialization_lock:
            if self._initialized:
                return
            logger.info("🚀 Performing lazy initialization...")
            # Initialize heavy components here if needed
            self._initialized = True
            logger.info("✅ Initialization completed")

    def _get_text_hash(self, lang, text):
        return hashlib.md5(f"{lang}:{text}".encode('utf-8')).hexdigest()

    def generate_audio_sync(self, lang, text):
        filename = f"{self._get_text_hash(lang, text)}.mp3"
        local_filepath = self.local_cache_dir / filename

        # Level 1: Local cache
        if local_filepath.exists():
            return True

        # Level 2: Google Drive cache
        if self.gdrive_cache.check_exists(filename):
            try:
                audio_stream = self.gdrive_cache.download_to_stream(filename)
                if audio_stream:
                    self.metrics.record_gdrive_download()
                    with open(local_filepath, "wb") as f:
                        f.write(audio_stream.getbuffer())
                    logger.info(f"✅ Restored {filename} from Google Drive")
                    return True
            except Exception as e:
                logger.error(f"Error restoring from GDrive: {e}")

        # Check failed generations
        failure_key = f"{lang}:{text}"
        if failure_key in self.failed_generations:
            _, attempt_count = self.failed_generations[failure_key]
            if attempt_count >= 3:
                logger.info(f"🚫 Skipping after {attempt_count} failures: {text[:30]}...")
                return False

        # Rate limiting
        can_request, reason = self.tts_limiter.can_make_request()
        if not can_request:
            logger.warning(f"⏳ Rate limit: {reason}")
            return False

        # Level 3: Generation
        try:
            self.tts_limiter.record_request()
            cleaned_text = ''.join(c for c in text if c.isprintable() and c not in '<>&')
            if not cleaned_text.strip():
                logger.warning(f"Empty text after cleaning: {text}")
                return False

            # Thread-safe TTS generation
            with self.gtts_lock:
                tts = gTTS(text=cleaned_text, lang=lang, slow=False)
                in_memory_file = BytesIO()
                tts.write_to_fp(in_memory_file)

            # Save locally
            with open(local_filepath, "wb") as f:
                f.write(in_memory_file.getbuffer())
            self.metrics.record_tts_generation()

            # Upload to GDrive (best effort)
            if self.gdrive_cache.upload(in_memory_file, filename):
                self.metrics.record_gdrive_upload()

            # Clear failures on success
            if failure_key in self.failed_generations:
                del self.failed_generations[failure_key]

            logger.info(f"🔊 Generated: {filename}")
            return True
            
        except Exception as e:
            # Record failure
            current_attempt = self.failed_generations.get(failure_key, (0, 0))[1] + 1
            self.failed_generations[failure_key] = (time.time(), current_attempt)
            self.metrics.record_error()
            
            if any(k in str(e).lower() for k in ['quota', 'limit', '429']):
                logger.error("🚫 TTS quota exceeded")
            else:
                logger.error(f"❌ TTS error: {e}")
            return False

# Initialize global system
tts_system = TTSSystem()

# === Middleware ===
@app.before_request
def before_request_middleware():
    tts_system.metrics.record_request()
    tts_system.ensure_initialized()
    
    # Skip validation for monitoring endpoints
    if request.path in ['/health', '/metrics', '/'] or request.path.startswith('/admin'):
        return
    
    # Basic request validation
    if request.content_length and request.content_length > 1024 * 1024:  # 1MB
        return jsonify({"error": "Request too large"}), 413

# === Error Handlers ===
@app.errorhandler(500)
def handle_500(e):
    tts_system.metrics.record_error()
    logger.error(f"Internal server error: {e}")
    return jsonify({
        "error": "Internal server error",
        "version": "2.3.5"
    }), 500

@app.errorhandler(404)
def handle_404(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(413)
def handle_413(e):
    return jsonify({"error": "Request too large"}), 413

# === API Endpoints ===
@app.route('/')
def index():
    return jsonify({
        "service": "TTS & Vocabulary Server", # Обновили название
        "version": "2.3.5-final",
        "status": "running",
        "platform": "cloud" if Config.IS_CLOUD else "local",
        "features": {
            "google_drive": tts_system.gdrive_cache.gdrive_enabled,
            "rate_limiting": True,
            "metrics": True,
            "vocabulary_api": True # Добавили флаг
        }
    })

# === НОВЫЕ ЭНДПОИНТЫ ДЛЯ СЛОВАРЕЙ ===

@app.route('/api/vocabularies/list')
@limiter.exempt # Отключаем лимиты для этого эндпоинта
def list_vocabularies():
    """
    Сканирует папку `vocabularies`, находит все .json файлы и возвращает их список
    в формате, который ожидает фронтенд.
    """
    vocab_dir = Config.VOCABULARIES_DIR
    if not os.path.isdir(vocab_dir):
        logger.error(f"Vocabulary directory '{vocab_dir}' not found.")
        return jsonify([]) # Возвращаем пустой список, как ожидает клиент

    vocabularies = []
    for filename in os.listdir(vocab_dir):
        if filename.endswith('.json'):
            try:
                filepath = os.path.join(vocab_dir, filename)
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    word_count = len(data.get('words', []))
                    vocab_name = filename[:-5] # Убираем .json
                    vocabularies.append({
                        "name": vocab_name,
                        "word_count": word_count
                    })
            except Exception as e:
                logger.error(f"Failed to process vocabulary file {filename}: {e}")
    
    return jsonify(vocabularies)

@app.route('/api/vocabulary/<vocab_name>')
@limiter.exempt # Отключаем лимиты для этого эндпоинта
def get_vocabulary(vocab_name):
    """
    Отдает содержимое конкретного файла словаря.
    Использует `send_from_directory` для безопасности.
    """
    # Простая проверка безопасности, чтобы избежать выхода из директории
    if ".." in vocab_name or "/" in vocab_name:
        return jsonify({"error": "Invalid vocabulary name"}), 400
        
    filename = f"{vocab_name}.json"
    vocab_dir = Config.VOCABULARIES_DIR

    if not os.path.exists(os.path.join(vocab_dir, filename)):
        return jsonify({"error": "Vocabulary not found"}), 404

    return send_from_directory(vocab_dir, filename)


# === СУЩЕСТВУЮЩИЕ ЭНДПОИНТЫ ДЛЯ TTS ===

@app.route('/audio/<filename>')
def serve_audio(filename):
    try:
        if not filename.endswith('.mp3'):
            return jsonify({"error": "Invalid file format"}), 400

        local_filepath = tts_system.local_cache_dir / filename
        
        # Check local cache first
        if local_filepath.exists():
            tts_system.metrics.record_cache_hit()
            return send_from_directory(str(tts_system.local_cache_dir), filename)

        # Check Google Drive cache
        tts_system.metrics.record_cache_miss()
        if tts_system.gdrive_cache.check_exists(filename):
            audio_stream = tts_system.gdrive_cache.download_to_stream(filename)
            if audio_stream:
                tts_system.metrics.record_gdrive_download()
                with open(local_filepath, "wb") as f:
                    f.write(audio_stream.getbuffer())
                return send_from_directory(str(tts_system.local_cache_dir), filename)

        return jsonify({"error": "File not found"}), 404
        
    except Exception as e:
        tts_system.metrics.record_error()
        logger.error(f"Error serving {filename}: {e}")
        return jsonify({"error": "Server error"}), 500

@app.route('/synthesize', methods=['GET', 'POST'])
@limiter.limit("10 per minute")
def synthesize_text():
    try:
        # Parse parameters
        if request.method == 'GET':
            text = request.args.get('text', '').strip()
            lang = request.args.get('lang', 'de').strip()
        else:
            data = request.json or {}
            text = data.get('text', '').strip()
            lang = data.get('lang', 'de').strip()

        # Validation
        if not text or not lang:
            return jsonify({"error": "Parameters 'text' and 'lang' are required"}), 400
        if len(text) > Config.MAX_TEXT_LENGTH:
            return jsonify({"error": f"Text too long (max {Config.MAX_TEXT_LENGTH})"}), 400
        if lang not in Config.SUPPORTED_LANGUAGES:
            return jsonify({"error": f"Unsupported language: {lang}"}), 400

        # Generate audio
        if tts_system.generate_audio_sync(lang, text):
            filename = tts_system._get_text_hash(lang, text) + ".mp3"
            return jsonify({
                "status": "success",
                "url": f"/audio/{filename}",
                "cached": tts_system.gdrive_cache.gdrive_enabled
            })
        else:
            tts_system.metrics.record_error()
            return jsonify({"error": "TTS generation failed"}), 503
            
    except Exception as e:
        tts_system.metrics.record_error()
        logger.error(f"Error in synthesize: {e}")
        return jsonify({"error": "Server error"}), 500

@app.route('/health')
def health_check():
    try:
        components = {
            "system_initialized": tts_system._initialized,
            "local_cache_writable": os.access(tts_system.local_cache_dir, os.W_OK),
            "gdrive_connected": tts_system.gdrive_cache.gdrive_enabled,
            "vocabularies_dir_exists": os.path.isdir(Config.VOCABULARIES_DIR) # Новая проверка
        }
        
        is_healthy = components["system_initialized"] and components["local_cache_writable"] and components["vocabularies_dir_exists"]
        
        return jsonify({
            "status": "healthy" if is_healthy else "degraded",
            "version": "2.3.5-final",
            "components": components,
            "platform": "cloud" if Config.IS_CLOUD else "local"
        }), 200 if is_healthy else 503
        
    except Exception as e:
        return jsonify({
            "status": "unhealthy",
            "error": str(e),
            "version": "2.3.5-final"
        }), 500

@app.route('/metrics')
def get_metrics():
    try:
        stats = tts_system.metrics.get_stats()
        can_request, reason = tts_system.tts_limiter.can_make_request()
        
        stats["tts_rate_limit_status"] = {
            "can_generate": can_request,
            "reason": reason
        }
        stats["platform"] = "cloud" if Config.IS_CLOUD else "local"
        stats["version"] = "2.3.5-final"
        
        return jsonify(stats)
    except Exception as e:
        return jsonify({"error": f"Failed to get metrics: {e}"}), 500

@app.route('/admin/stats')
def admin_stats():
    if not Config.ADMIN_TOKEN or request.headers.get('X-Admin-Token') != Config.ADMIN_TOKEN:
        return jsonify({"error": "Unauthorized"}), 401
    
    return jsonify({
        "metrics": tts_system.metrics.get_stats(),
        "failed_generations": len(tts_system.failed_generations),
        "failed_details": tts_system.failed_generations,
        "cache_files": len(list(tts_system.local_cache_dir.glob("*.mp3"))),
        "gdrive_cache_size": len(tts_system.gdrive_cache.file_cache)
    })

@app.route('/admin/cleanup', methods=['POST'])
def admin_cleanup():
    if not Config.ADMIN_TOKEN or request.headers.get('X-Admin-Token') != Config.ADMIN_TOKEN:
        return jsonify({"error": "Unauthorized"}), 401
    
    failed_count = len(tts_system.failed_generations)
    tts_system.failed_generations.clear()
    
    return jsonify({
        "status": "cleaned",
        "cleared_failed_generations": failed_count,
        "timestamp": datetime.now().isoformat()
    })

# === Environment validation ===
def validate_environment():
    logger.info("🔍 Environment validation:")
    logger.info(f"  Platform: {'Cloud' if Config.IS_CLOUD else 'Local'}")
    logger.info(f"  Google Drive available: {GDRIVE_AVAILABLE}")
    logger.info(f"  Folder ID: {'Set' if Config.FOLDER_ID else 'Not set'}")
    logger.info(f"  Credentials: {'Found' if os.path.exists(Config.CREDENTIALS_FILE) else 'Not found'}")
    logger.info(f"  Admin token: {'Set' if Config.ADMIN_TOKEN else 'Not set'}")
    # --- НОВАЯ ПРОВЕРКА ---
    if not os.path.isdir(Config.VOCABULARIES_DIR):
        logger.warning(f"  ⚠️ Vocabulary directory '{Config.VOCABULARIES_DIR}' not found. Creating it.")
        os.makedirs(Config.VOCABULARIES_DIR, exist_ok=True)
    else:
        logger.info(f"  ✅ Vocabulary directory '{Config.VOCABULARIES_DIR}' found.")


# === Graceful shutdown ===
def graceful_shutdown():
    logger.info("🛑 Graceful shutdown initiated...")
    # No background threads to stop in this version
    logger.info("✅ Server stopped")

atexit.register(graceful_shutdown)
signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))
signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))

if __name__ == '__main__':
    validate_environment()
    port = int(os.getenv('PORT', 5000))
    
    logger.info(f"🚀 Starting TTS & Vocabulary Server v2.3.5 on port {port}")
    logger.info(f"📢 Debug mode: {Config.DEBUG}")
    
    app.run(host='0.0.0.0', port=port, debug=Config.DEBUG)