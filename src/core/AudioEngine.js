"use strict";

import { TTS_API_BASE_URL } from '../utils/constants.js';

export class AudioEngine {
    constructor({ stateManager }) {
        this.stateManager = stateManager; // Сохраняем ссылку на stateManager

        this.mediaPlayer = document.createElement('audio');
        this.mediaPlayer.id = 'unifiedMediaPlayer';
        document.body.appendChild(this.mediaPlayer);

        this.silentAudioSrc = null;
        this.audioContext = null;
        this.sequenceController = null;

        this.progressAnimation = {
            rafId: null,
            startTime: null,
            duration: 0,
            isRunning: false
        };

        this.initAudioContext();
        this.initMediaSession();
    }

    setSequenceController(controller) {
        this.sequenceController = controller;
    }

    speakById(wordId, part, vocabName) {
        return new Promise(async (resolve, reject) => {

            if (!this.mediaPlayer) {
                return reject(new Error('MediaPlayer not initialized'));
            }

            if (!wordId || (this.sequenceController && this.sequenceController.signal.aborted)) {
                return resolve();
            }

            const onAbort = () => {
                this.mediaPlayer.pause();
                cleanupAndRestoreSilentTrack();
                reject(new DOMException('Aborted', 'AbortError'));
            };

            const onFinish = () => {
                cleanupAndRestoreSilentTrack();
                resolve();
            };

            // --- ИЗМЕНЕНО ---
            // Восстанавливаем логику возврата к тихому треку для поддержки сессии
            const cleanupAndRestoreSilentTrack = () => {
                this.mediaPlayer.removeEventListener('ended', onFinish);
                this.mediaPlayer.removeEventListener('error', onFinish);
                this.sequenceController?.signal.removeEventListener('abort', onAbort);

                // Вот ключевой фикс: если автопроигрывание активно, немедленно
                // возвращаем тихий трек, чтобы аудиосессия не прервалась.
                if (this.stateManager.getState().isAutoPlaying) {
                    this.playSilentAudio();
                }
            };

            try {
                const apiUrl = `${TTS_API_BASE_URL}/synthesize_by_id?id=${wordId}&part=${part}&vocab=${vocabName}`;
                const response = await fetch(apiUrl, { signal: this.sequenceController?.signal });
                if (!response.ok) throw new Error(`TTS server error: ${response.statusText}`);
                const data = await response.json();
                if (!data.url) throw new Error('Invalid response from TTS server');

                if (this.sequenceController?.signal.aborted) {
                    return reject(new DOMException('Aborted', 'AbortError'));
                }

                this.mediaPlayer.pause();
                this.mediaPlayer.loop = false;
                this.mediaPlayer.volume = 1.0;
                this.mediaPlayer.src = `${TTS_API_BASE_URL}${data.url}`;

                this.mediaPlayer.addEventListener('ended', onFinish, { once: true });
                this.mediaPlayer.addEventListener('error', onFinish, { once: true });
                this.sequenceController?.signal.addEventListener('abort', onAbort, { once: true });

                await this.mediaPlayer.play();

            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Ошибка в AudioEngine.speakById:', error);
                }
                onFinish(); // В любом случае завершаем промис, чтобы не блокировать последовательность
            }
        });
    }

    async playSilentAudio() {
        if (!this.mediaPlayer) return;
        try {
            const silentSrc = await this.generateSilentAudioSrc();
            // Проверяем, не играет ли уже тихий трек, чтобы избежать лишних действий
            if (this.mediaPlayer.src !== silentSrc || this.mediaPlayer.paused) {
                this.mediaPlayer.src = silentSrc;
                this.mediaPlayer.loop = true;
                this.mediaPlayer.volume = 0.01;
                await this.mediaPlayer.play();
            }
        } catch (e) {
            console.warn('⚠️ Ошибка запуска тихого трека:', e);
        }
    }

    pauseSilentAudio() {
        if (!this.mediaPlayer) return;
        this.mediaPlayer.pause();
    }

    initAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('✅ Audio Context инициализирован');
        } catch (e) {
            console.warn('⚠️ Audio Context не поддерживается:', e);
        }
    }

    initMediaSession() {
        if (!('mediaSession' in navigator)) {
            console.log('⚠️ MediaSession API не поддерживается');
            return;
        }
        console.log('✅ Инициализация MediaSession');
    }

    async generateSilentAudioSrc() {
        if (this.silentAudioSrc) return this.silentAudioSrc;
        if (!this.audioContext) return null;

        try {
            const duration = 2;
            const sampleRate = this.audioContext.sampleRate;
            const buffer = this.audioContext.createBuffer(1, duration * sampleRate, sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < buffer.length; i++) { data[i] = 0; }

            const audioBlob = await this.bufferToWave(buffer, buffer.length);
            this.silentAudioSrc = URL.createObjectURL(audioBlob);
            return this.silentAudioSrc;
        } catch (e) {
            console.error('❌ Ошибка генерации тихого аудио:', e);
            return null;
        }
    }

    bufferToWave(abuffer, len) {
        const numOfChan = abuffer.numberOfChannels;
        const length = len * numOfChan * 2 + 44;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        let pos = 0;
        const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
        const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };
        setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
        setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
        setUint32(abuffer.sampleRate); setUint32(abuffer.sampleRate * 2 * numOfChan);
        setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
        setUint32(length - pos - 4);
        const channels = [];
        for (let i = 0; i < abuffer.numberOfChannels; i++) { channels.push(abuffer.getChannelData(i)); }
        let offset = 0;
        while (pos < length) {
            for (let i = 0; i < numOfChan; i++) {
                const sample = Math.max(-1, Math.min(1, channels[i][offset]));
                view.setInt16(pos, (sample < 0 ? sample * 32768 : sample * 32767), true);
                pos += 2;
            }
            offset++;
        }
        return new Blob([buffer], { type: "audio/wav" });
    }

    updateMediaSessionMetadata(word, duration = 2) {
        if (!('mediaSession' in navigator) || !word) return;
        const artworkUrl = this.generateGermanFlagArtwork();
        navigator.mediaSession.metadata = new MediaMetadata({
            title: word.german || '',
            artist: word.russian || '',
            album: `${word.level || ''} - Deutsch Lernen`,
            artwork: [{ src: artworkUrl, sizes: '512x512', type: 'image/svg+xml' }]
        });
    }

    generateGermanFlagArtwork() {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="#000000"/><text x="256" y="310" font-family="Helvetica, Arial, sans-serif" font-size="280" font-weight="regular" fill="#707070" text-anchor="middle">DE</text></svg>`;
        return 'data:image/svg+xml,' + encodeURIComponent(svg);
    }

    startSmoothProgress(durationMs, elapsedMs = 0) {
        this.stopSmoothProgress();
        this.progressAnimation.startTime = performance.now() - elapsedMs;
        this.progressAnimation.duration = durationMs;
        this.progressAnimation.isRunning = true;

        const animate = (currentTime) => {
            if (!this.progressAnimation.isRunning) return;
            const elapsed = currentTime - this.progressAnimation.startTime;
            const progress = Math.min(elapsed / this.progressAnimation.duration, 0.99);

            if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
                try {
                    const durationSec = this.progressAnimation.duration / 1000;
                    navigator.mediaSession.setPositionState({
                        duration: durationSec,
                        playbackRate: 1,
                        position: progress * durationSec
                    });
                } catch (e) { /* Игнорируем */ }
            }

            if (progress < 0.99) {
                this.progressAnimation.rafId = requestAnimationFrame(animate);
            }
        };
        this.progressAnimation.rafId = requestAnimationFrame(animate);
    }

    stopSmoothProgress() {
        if (this.progressAnimation.rafId) {
            cancelAnimationFrame(this.progressAnimation.rafId);
            this.progressAnimation.rafId = null;
        }
        this.progressAnimation.isRunning = false;
    }

    completeSmoothProgress() {
        this.stopSmoothProgress();
        if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
            try {
                const durationSec = this.progressAnimation.duration / 1000;
                if (durationSec > 0) {
                    navigator.mediaSession.setPositionState({
                        duration: durationSec,
                        playbackRate: 1,
                        position: durationSec
                    });
                }
            } catch (e) { /* Игнорируем */ }
        }
    }
}