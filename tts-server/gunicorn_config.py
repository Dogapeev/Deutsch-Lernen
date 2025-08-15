# gunicorn_config.py
# Конфигурация Gunicorn с правильным порядком monkey patching

# КРИТИЧЕСКИ ВАЖНО: Выполняем monkey patching ДО любых других импортов
from gevent import monkey
monkey.patch_all()

import os

# === Основные настройки Gunicorn ===
# Worker class для gevent
worker_class = 'gevent'

# Количество worker процессов
# Для Render.com рекомендуется 2-4 worker'а
workers = int(os.getenv('GUNICORN_WORKERS', 2))

# Максимальное количество одновременных соединений на worker
worker_connections = 1000

# Bind адрес - Render автоматически подставит PORT
bind = f"0.0.0.0:{os.getenv('PORT', 10000)}"

# === Timeout настройки ===
# Таймаут для обработки запросов (важно для TTS генерации)
timeout = 120

# Таймаут для keep-alive соединений
keepalive = 2

# === Логирование ===
# Уровень логирования
loglevel = 'info'

# Формат лога доступа
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Включаем логи доступа
accesslog = '-'  # stdout

# Логи ошибок
errorlog = '-'   # stderr

# === Performance настройки ===
# Максимальное количество запросов на worker (перезагрузка для предотвращения утечек памяти)
max_requests = 1000
max_requests_jitter = 100

# Preload приложения для экономии памяти
preload_app = True

# === Graceful shutdown ===
# Время ожидания для graceful shutdown
graceful_timeout = 30

# === Безопасность ===
# Отключаем Server header для безопасности
proc_name = 'tts-server'

# === Функции для lifecycle events ===
def on_starting(server):
    """Вызывается при запуске Gunicorn"""
    server.log.info("🚀 Starting TTS Server with gevent monkey patching")

def on_reload(server):
    """Вызывается при reload"""
    server.log.info("🔄 Reloading TTS Server")

def worker_int(worker):
    """Вызывается при получении SIGINT worker'ом"""
    worker.log.info("🛑 Worker received SIGINT")

def when_ready(server):
    """Вызывается когда сервер готов принимать соединения"""
    server.log.info("✅ TTS Server is ready to accept connections")
    server.log.info(f"📡 Listening on {bind}")
    server.log.info(f"👥 Workers: {workers}")
    server.log.info(f"🔧 Worker class: {worker_class}")

# === Monkey patching проверка ===
def post_fork(server, worker):
    """Вызывается после fork worker процесса"""
    import ssl
    import socket
    
    # Проверяем что monkey patching сработал
    if hasattr(socket.socket, '_gevent_sock_class'):
        worker.log.info("✅ Gevent monkey patching successful")
    else:
        worker.log.warning("⚠️ Gevent monkey patching may have failed")
    
    worker.log.info(f"🔧 Worker {worker.pid} started")