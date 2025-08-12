import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from gtts import gTTS
import hashlib

# --- Конфигурация ---
app = Flask(__name__)
CORS(app) 

# Папка для хранения сгенерированных аудиофайлов
AUDIO_DIR = "audio_cache"
os.makedirs(AUDIO_DIR, exist_ok=True)

# --- Маршруты API ---
@app.route('/synthesize', methods=['GET'])
def synthesize_speech():
    text = request.args.get('text')
    lang = request.args.get('lang')

    if not text or not lang:
        return jsonify({"error": "Missing 'text' or 'lang' parameter"}), 400

    filename_hash = hashlib.md5(f"{lang}:{text}".encode()).hexdigest()
    filename = f"{filename_hash}.mp3"
    filepath = os.path.join(AUDIO_DIR, filename)

    if not os.path.exists(filepath):
        try:
            print(f"LOG: Generating new file for: lang={lang}, text='{text}'")
            tts = gTTS(text=text, lang=lang, slow=False)
            tts.save(filepath)
        except Exception as e:
            print(f"ERROR: Failed to generate audio: {str(e)}")
            return jsonify({"error": f"Failed to generate audio: {str(e)}"}), 500
    else:
        print(f"LOG: Using cached file: {filename}")

    audio_url = f"/audio/{filename}"
    return jsonify({"url": audio_url})

@app.route('/audio/<filename>')
def serve_audio(filename):
    return send_from_directory(AUDIO_DIR, filename)

@app.route('/health')
def health_check():
    return "OK", 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)