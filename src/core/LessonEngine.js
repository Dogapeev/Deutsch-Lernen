// src/core/LessonEngine.js
"use strict";

import { DELAYS } from '../utils/constants.js';
import { delay } from '../utils/helpers.js';

export class LessonEngine {
    constructor({ stateManager, audioEngine, ui }) {
        // --- ЗАВИСИМОСТИ ---
        this.stateManager = stateManager;
        this.audioEngine = audioEngine;
        this.ui = ui; // Объект с методами для рендера UI (renderInitialCard, showNoWordsMessage и т.д.)

        // --- ВНУТРЕННЕЕ СОСТОЯНИЕ ДВИЖКА ---
        this.playbackSequence = [];      // Текущая последовательность слов для проигрывания
        this.currentSequenceIndex = -1;  // Индекс текущего слова в playbackSequence
        this.sequenceController = null;  // Контроллер для прерывания асинхронных операций
    }

    // --- ПУБЛИЧНЫЕ МЕТОДЫ УПРАВЛЕНИЯ ---

    start() {
        const state = this.stateManager.getState();
        if (state.isAutoPlaying) return;

        // --- ИСПРАВЛЕНО (по аналогии с 5.4.6): Немедленно сообщаем системе о начале воспроизведения ---
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }

        let wordToShow = state.currentWord;
        let startPhaseIndex = state.currentPhaseIndex || 0;

        if (!wordToShow || startPhaseIndex === 0) {
            wordToShow = this._getNextWord();
            startPhaseIndex = 0;
            if (wordToShow) {
                this.stateManager.setState({ currentWord: wordToShow, currentPhase: 'initial', currentPhaseIndex: 0 });
            }
        }

        if (wordToShow) {
            this.stateManager.setState({ isAutoPlaying: true });
            this.audioEngine.playSilentAudio();
            this._runDisplaySequence(wordToShow, startPhaseIndex);
        } else {
            this.ui.showNoWordsMessage();
            // ВАЖНО: Если играть нечего, откатываем состояние обратно на "паузу"
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'paused';
            }
        }
    }

    stop() {
        if (this.sequenceController) {
            this.sequenceController.abort();
        }

        // --- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ (как в 5.4.6): Немедленно обновляем MediaSession ---
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }

        this.stateManager.setState({ isAutoPlaying: false });
        this.audioEngine.pauseSilentAudio();
        this.audioEngine.stopSmoothProgress();
    }

    toggle() {
        const isAutoPlaying = this.stateManager.getState().isAutoPlaying;
        if (isAutoPlaying) {
            this.stop();
        } else {
            this.start();
        }
    }

    // --- ИСПРАВЛЕНО: Полностью переработанная логика next/previous для эталонного поведения ---
    next() {
        if (this.playbackSequence.length <= 1) return;

        const wasAutoPlaying = this.stateManager.getState().isAutoPlaying;
        // Прерываем текущую последовательность, не меняя глобальное состояние isAutoPlaying
        this._interruptSequence();

        // Временно ставим флаг на false, чтобы _runDisplaySequence не запустил следующий цикл автоматически
        if (wasAutoPlaying) {
            this.stateManager.setState({ isAutoPlaying: false });
        }

        const nextWord = this._getNextWord();
        if (!nextWord) {
            this.ui.showNoWordsMessage();
            return;
        }

        this.stateManager.setState({ currentWord: nextWord, currentPhase: 'initial', currentPhaseIndex: 0 });
        this._runDisplaySequence(nextWord);

        // Восстанавливаем состояние автопроигрывания
        if (wasAutoPlaying) {
            this.stateManager.setState({ isAutoPlaying: true });
            this.audioEngine.playSilentAudio(); // Убедимся, что тихий трек снова играет
        }
    }

    previous() {
        if (this.playbackSequence.length <= 1) return;

        const wasAutoPlaying = this.stateManager.getState().isAutoPlaying;
        this._interruptSequence();

        if (wasAutoPlaying) {
            this.stateManager.setState({ isAutoPlaying: false });
        }

        this.currentSequenceIndex--;
        if (this.currentSequenceIndex < 0) {
            this.currentSequenceIndex = this.playbackSequence.length - 1;
        }

        const word = this.playbackSequence[this.currentSequenceIndex];
        this.stateManager.setState({ currentWord: word, currentPhase: 'initial', currentPhaseIndex: 0 });
        this._runDisplaySequence(word);

        if (wasAutoPlaying) {
            this.stateManager.setState({ isAutoPlaying: true });
            this.audioEngine.playSilentAudio();
        }
    }


    /**
     * Генерирует новую последовательность слов на основе текущих фильтров в состоянии.
     * @param {Array} allWords - Полный список всех слов.
     */
    generatePlaybackSequence(allWords) {
        const state = this.stateManager.getState();
        const { selectedLevels, selectedTheme, sequenceMode } = state;

        if (!allWords || allWords.length === 0) {
            this.playbackSequence = [];
            return;
        }

        const activeWords = allWords.filter(w =>
            w?.level && selectedLevels.includes(w.level) &&
            (selectedTheme === 'all' || w.theme === selectedTheme)
        );

        this.playbackSequence = [...activeWords];

        if (sequenceMode === 'random' && this.playbackSequence.length > 1) {
            this._shuffleArray(this.playbackSequence);
        }

        this.currentSequenceIndex = -1;
    }


    // --- ПРИВАТНЫЕ МЕТОДЫ (ЛОГИКА УРОКА) ---

    async _runDisplaySequence(word, startFromIndex = 0) {
        if (!word) {
            this.ui.showNoWordsMessage();
            this.stop();
            return;
        }

        if (this.sequenceController) {
            this.sequenceController.abort();
        }
        this.sequenceController = new AbortController();
        const { signal } = this.sequenceController;
        this.audioEngine.setSequenceController(this.sequenceController);

        try {
            const checkAborted = () => {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            };

            // --- ИСПРАВЛЕНО (по аналогии с 5.4.6): Устанавливаем статус в начале ---
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
            }

            const state = this.stateManager.getState();
            const phases = [];

            if (startFromIndex === 0) {
                phases.push({
                    name: 'fadeIn',
                    duration: DELAYS.CARD_FADE_IN,
                    task: () => this.ui.fadeInNewCard(word, checkAborted)
                });
            }

            for (let i = 0; i < state.repeatMode; i++) {
                const delayDuration = (i === 0) ? DELAYS.INITIAL_WORD : DELAYS.BETWEEN_REPEATS;
                phases.push({
                    name: `playGerman_${i}`,
                    duration: delayDuration + 1800,
                    task: () => this._playGermanPhase(word, checkAborted, i === 0)
                });
            }

            if (state.showMorphemes) {
                phases.push({
                    name: 'revealMorphemes',
                    duration: DELAYS.BEFORE_MORPEMES,
                    task: () => this.ui.revealMorphemesPhase(word, checkAborted)
                });
            }

            if (state.showSentences && word.sentence) {
                const sentenceDuration = state.sentenceSoundEnabled ? 3500 : 0;
                phases.push({
                    name: 'playSentence',
                    duration: DELAYS.BEFORE_SENTENCE + sentenceDuration,
                    task: () => this._playSentencePhase(word, checkAborted)
                });
            }

            const translationDuration = state.translationSoundEnabled ? 1800 : 0;
            phases.push({
                name: 'revealTranslation',
                duration: DELAYS.BEFORE_TRANSLATION + translationDuration,
                task: () => this._revealTranslationPhase(word, checkAborted)
            });

            const totalDuration = phases.reduce((sum, phase) => sum + phase.duration, 0);
            let elapsedMs = 0;
            if (startFromIndex > 0) {
                for (let i = 0; i < startFromIndex; i++) {
                    elapsedMs += phases[i]?.duration || 0;
                }
                this.ui.updateCardViewToPhase(word, startFromIndex, phases);
            }

            this.audioEngine.updateMediaSessionMetadata(word, totalDuration / 1000);
            this.audioEngine.startSmoothProgress(totalDuration, elapsedMs);

            for (let i = startFromIndex; i < phases.length; i++) {
                const phase = phases[i];
                this.stateManager.setState({ currentPhaseIndex: i });
                checkAborted();
                await phase.task();
            }

            checkAborted();
            this.audioEngine.completeSmoothProgress();

            if (this.stateManager.getState().isAutoPlaying) {
                await this.ui.prepareNextWord(checkAborted);
                const nextWord = this._getNextWord();
                this.stateManager.setState({ currentWord: nextWord, currentPhase: 'initial', currentPhaseIndex: 0 });
                this._runDisplaySequence(nextWord);
            } else {
                // --- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ (как в 5.4.6): Устанавливаем статус 'paused' в конце ---
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'paused';
                }
                this.stateManager.setState({ currentPhaseIndex: 0 });
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('▶️ Последовательность урока корректно прервана. Позиция сохранена.');
            } else {
                console.error('Ошибка в последовательности урока:', error);
                this.stop();
            }
        }
    }

    async _playGermanPhase(word, checkAborted, isFirstRepeat) {
        const waitTime = isFirstRepeat ? DELAYS.INITIAL_WORD : DELAYS.BETWEEN_REPEATS;
        await delay(waitTime);
        checkAborted();
        const vocabName = this.stateManager.getState().currentVocabulary;
        await this.audioEngine.speakById(word.id, 'german', vocabName);
        checkAborted();
    }

    async _playSentencePhase(word, checkAborted) {
        await this.ui.revealSentencePhase(word, checkAborted);
        if (this.stateManager.getState().sentenceSoundEnabled) {
            const vocabName = this.stateManager.getState().currentVocabulary;
            await this.audioEngine.speakById(word.id, 'sentence', vocabName);
            checkAborted();
        }
    }

    async _revealTranslationPhase(word, checkAborted) {
        await this.ui.revealTranslationPhase(word, checkAborted);
        if (this.stateManager.getState().translationSoundEnabled) {
            const vocabName = this.stateManager.getState().currentVocabulary;
            await this.audioEngine.speakById(word.id, 'russian', vocabName);
            checkAborted();
        }
        if (this.stateManager.getState().isAutoPlaying) {
            const { studiedToday } = this.stateManager.getState();
            this.stateManager.setState({ studiedToday: studiedToday + 1 });
        }
    }

    _interruptSequence() {
        if (this.sequenceController) {
            this.sequenceController.abort();
        }
        this.audioEngine.stopSmoothProgress();
    }

    _getNextWord() {
        if (this.playbackSequence.length === 0) {
            this.currentSequenceIndex = -1;
            return null;
        }
        this.currentSequenceIndex++;
        if (this.currentSequenceIndex >= this.playbackSequence.length) {
            this.currentSequenceIndex = 0;
        }
        return this.playbackSequence[this.currentSequenceIndex];
    }

    _shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}