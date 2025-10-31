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
        }
    }

    stop() {
        if (this.sequenceController) {
            this.sequenceController.abort();
        }
        this.stateManager.setState({ isAutoPlaying: false });
        this.audioEngine.pauseSilentAudio();
        this.audioEngine.stopSmoothProgress(); // ДОБАВЛЕНО: Убедимся, что прогресс-бар остановлен
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }
    }

    toggle() {
        const isAutoPlaying = this.stateManager.getState().isAutoPlaying;
        if (isAutoPlaying) {
            this.stop();
        } else {
            this.start();
        }
    }

    next() {
        if (this.playbackSequence.length <= 1) return;

        const wasAutoPlaying = this.stateManager.getState().isAutoPlaying;
        this._interruptSequence();
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

        if (wasAutoPlaying) {
            this.stateManager.setState({ isAutoPlaying: true });
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

        // "Взводим" плейлист
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

            const state = this.stateManager.getState();
            // ИЗМЕНЕНО: Возвращаем логику с длительностями, как в эталонном файле
            const phases = [];

            // Фаза появления новой карточки
            phases.push({ duration: DELAYS.CARD_FADE_IN, task: () => this.ui.fadeInNewCard(word, checkAborted), isAnimation: true });

            // Фазы повторения немецкого слова
            for (let i = 0; i < state.repeatMode; i++) {
                const delayDuration = (i === 0) ? DELAYS.INITIAL_WORD : DELAYS.BETWEEN_REPEATS;
                // Предполагаемая длительность звука ~1800ms
                phases.push({ duration: delayDuration + 1800, task: () => this._playGermanPhase(word, checkAborted, i === 0) });
            }

            // Фаза морфем
            if (state.showMorphemes) {
                phases.push({ duration: DELAYS.BEFORE_MORPHEMES, task: () => this.ui.revealMorphemesPhase(word, checkAborted) });
            }

            // Фаза предложения
            if (state.showSentences && word.sentence) {
                // Предполагаемая длительность озвучки предложения ~3500ms
                const sentenceDuration = state.sentenceSoundEnabled ? 3500 : 0;
                phases.push({ duration: DELAYS.BEFORE_SENTENCE + sentenceDuration, task: () => this._playSentencePhase(word, checkAborted) });
            }

            // Фаза перевода
            // Предполагаемая длительность озвучки перевода ~1800ms
            const translationDuration = state.translationSoundEnabled ? 1800 : 0;
            phases.push({ duration: DELAYS.BEFORE_TRANSLATION + translationDuration, task: () => this._revealTranslationPhase(word, checkAborted) });


            // ДОБАВЛЕНО: Расчет общей длительности и прошедшего времени
            const totalDuration = phases.reduce((sum, phase) => sum + phase.duration, 0);
            let elapsedMs = 0;
            if (startFromIndex > 0) {
                for (let i = 0; i < startFromIndex; i++) {
                    elapsedMs += phases[i]?.duration || 0;
                }
                this.ui.updateCardViewToPhase(word, startFromIndex, phases);
            }

            // ДОБАВЛЕНО: Обновление Media Session
            this.audioEngine.updateMediaSessionMetadata(word, totalDuration / 1000);
            this.audioEngine.startSmoothProgress(totalDuration, elapsedMs);

            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';

            for (let i = startFromIndex; i < phases.length; i++) {
                const phase = phases[i];
                // Пропускаем анимацию появления, если мы возобновляем, а не начинаем с нуля
                if (phase.isAnimation && startFromIndex > 0) continue;

                this.stateManager.setState({ currentPhaseIndex: i });
                checkAborted();
                await phase.task();
            }

            checkAborted();
            this.audioEngine.completeSmoothProgress(); // ДОБАВЛЕНО: Завершаем прогресс-бар
            this.stateManager.setState({ currentPhaseIndex: 0 });

            if (this.stateManager.getState().isAutoPlaying) {
                await this.ui.prepareNextWord(checkAborted);
                const nextWord = this._getNextWord();
                this.stateManager.setState({ currentWord: nextWord, currentPhase: 'initial', currentPhaseIndex: 0 });
                this._runDisplaySequence(nextWord);
            } else {
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('▶️ Последовательность урока корректно прервана.');
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
        await this.ui.revealSentencePhase(word, checkAborted); // UI часть
        if (this.stateManager.getState().sentenceSoundEnabled) {
            const vocabName = this.stateManager.getState().currentVocabulary;
            await this.audioEngine.speakById(word.id, 'sentence', vocabName);
            checkAborted();
        }
    }

    async _revealTranslationPhase(word, checkAborted) {
        await this.ui.revealTranslationPhase(word, checkAborted); // UI часть
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