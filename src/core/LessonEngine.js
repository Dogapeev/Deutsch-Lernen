// src/core/LessonEngine.js
"use strict";

import { DELAYS } from '../utils/constants.js';
import { delay } from '../utils/helpers.js';

export class LessonEngine {
    constructor({ stateManager, audioEngine, ui }) {
        // --- ЗАВИСИМОСТИ ---
        this.stateManager = stateManager;
        this.audioEngine = audioEngine;
        this.ui = ui;

        // --- ВНУТРЕННЕЕ СОСТОЯНИЕ ДВИЖКА ---
        this.playbackSequence = [];
        this.currentSequenceIndex = -1;
        this.sequenceController = null;
    }

    // --- ПУБЛИЧНЫЕ МЕТОДЫ УПРАВЛЕНИЯ ---

    /**
     * Запускает или возобновляет ЦИКЛ непрерывного воспроизведения.
     * Это основное действие "Play".
     */
    start() {
        const state = this.stateManager.getState();
        if (state.isAutoPlaying) return;

        // Немедленно сообщаем системе (часам), что ЦИКЛ начался
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }

        let wordToShow = state.currentWord;
        let startPhaseIndex = state.currentPhaseIndex || 0;

        // Если начинаем с нуля, берем первое/следующее слово
        if (!wordToShow || startPhaseIndex === 0) {
            wordToShow = this._getNextWord();
            startPhaseIndex = 0;
            if (wordToShow) {
                this.stateManager.setState({ currentWord: wordToShow, currentPhase: 'initial', currentPhaseIndex: 0 });
            }
        }

        if (wordToShow) {
            // Входим в режим автопроигрывания (цикл активен)
            this.stateManager.setState({ isAutoPlaying: true });
            this.audioEngine.playSilentAudio();
            this._runDisplaySequence(wordToShow, startPhaseIndex);
        } else {
            this.ui.showNoWordsMessage();
            // Если играть нечего, сразу останавливаемся
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'paused';
            }
        }
    }

    /**
     * Останавливает (ставит на паузу) ЦИКЛ воспроизведения.
     * Сохраняет текущую фазу для возможного возобновления.
     * Это основное действие "Stop".
     */
    stop() {
        if (this.sequenceController) {
            this.sequenceController.abort();
        }

        // Немедленно сообщаем системе (часам), что ЦИКЛ остановлен
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }

        // Выходим из режима автопроигрывания (цикл неактивен)
        this.stateManager.setState({ isAutoPlaying: false });
        this.audioEngine.pauseSilentAudio();
        this.audioEngine.stopSmoothProgress();
    }

    /**
     * Переключает между start() и stop().
     */
    toggle() {
        if (this.stateManager.getState().isAutoPlaying) {
            this.stop();
        } else {
            this.start();
        }
    }

    /**
     * Бесшовно переключает на следующее слово, не прерывая цикл воспроизведения.
     * Логика полностью повторяет эталонную версию 5.4.6.
     */
    next() {
        if (this.playbackSequence.length <= 1) return;

        const wasAutoPlaying = this.stateManager.getState().isAutoPlaying;
        // 1. Мягко прерываем текущее слово, НЕ меняя isAutoPlaying
        this._interruptSequence();

        // 2. Временно выключаем флаг, чтобы _runDisplaySequence не запустился сам по себе
        //    во время подготовки нового слова.
        if (wasAutoPlaying) {
            this.stateManager.setState({ isAutoPlaying: false });
        }

        // 3. Готовим следующее слово
        const nextWord = this._getNextWord();
        if (!nextWord) {
            this.ui.showNoWordsMessage();
            return;
        }
        this.stateManager.setState({ currentWord: nextWord, currentPhase: 'initial', currentPhaseIndex: 0 });

        // 4. Запускаем последовательность для нового слова
        this._runDisplaySequence(nextWord);

        // 5. Если цикл был активен, восстанавливаем флаг, чтобы цикл продолжился
        if (wasAutoPlaying) {
            this.stateManager.setState({ isAutoPlaying: true });
        }
    }

    /**
     * Бесшовно переключает на предыдущее слово, логика аналогична next().
     */
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
     * Генерирует новую последовательность слов на основе текущих фильтров.
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

    /**
     * Главная функция, управляющая последовательностью показа одного слова.
     */
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
            const phases = this._buildPhases(word, state);

            if (startFromIndex === 0) {
                await this.ui.fadeInNewCard(word, checkAborted);
            }

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

            // Если мы все еще в режиме цикла (пользователь не нажал Stop)...
            if (this.stateManager.getState().isAutoPlaying) {
                // ...то готовим и запускаем следующее слово.
                await this.ui.prepareNextWord(checkAborted);
                const nextWord = this._getNextWord();
                this.stateManager.setState({ currentWord: nextWord, currentPhase: 'initial', currentPhaseIndex: 0 });
                this._runDisplaySequence(nextWord); // Рекурсия для бесконечного цикла
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

    _buildPhases(word, state) {
        const phases = [];

        for (let i = 0; i < state.repeatMode; i++) {
            const isFirst = (i === 0);
            const duration = (isFirst ? DELAYS.INITIAL_WORD : DELAYS.BETWEEN_REPEATS) + 1800;
            phases.push({
                duration: duration,
                task: () => this._playGermanPhase(word, isFirst)
            });
        }

        if (state.showMorphemes) {
            phases.push({
                duration: DELAYS.BEFORE_MORPHEMES,
                task: () => this.ui.revealMorphemesPhase(word, this._getCheckAbortedFn())
            });
        }

        if (state.showSentences && word.sentence) {
            const duration = DELAYS.BEFORE_SENTENCE + (state.sentenceSoundEnabled ? 3500 : 0);
            phases.push({
                duration: duration,
                task: () => this._playSentencePhase(word)
            });
        }

        const translationDuration = DELAYS.BEFORE_TRANSLATION + (state.translationSoundEnabled ? 1800 : 0);
        phases.push({
            duration: translationDuration,
            task: () => this._revealTranslationPhase(word)
        });

        return phases;
    }

    _getCheckAbortedFn() {
        return () => {
            if (this.sequenceController.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        };
    }

    _interruptSequence() {
        if (this.sequenceController) {
            this.sequenceController.abort();
        }
        this.audioEngine.stopSmoothProgress();
    }

    async _playGermanPhase(word, isFirstRepeat) {
        const checkAborted = this._getCheckAbortedFn();
        const waitTime = isFirstRepeat ? DELAYS.INITIAL_WORD : DELAYS.BETWEEN_REPEATS;
        await delay(waitTime);
        checkAborted();
        const vocabName = this.stateManager.getState().currentVocabulary;
        await this.audioEngine.speakById(word.id, 'german', vocabName);
        checkAborted();
    }

    async _playSentencePhase(word) {
        const checkAborted = this._getCheckAbortedFn();
        await this.ui.revealSentencePhase(word, checkAborted);
        if (this.stateManager.getState().sentenceSoundEnabled) {
            const vocabName = this.stateManager.getState().currentVocabulary;
            await this.audioEngine.speakById(word.id, 'sentence', vocabName);
            checkAborted();
        }
    }

    async _revealTranslationPhase(word) {
        const checkAborted = this._getCheckAbortedFn();
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