// src/core/LessonEngine.js
"use strict";

import { DELAYS, AUDIO_DURATIONS } from '../utils/constants.js';
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

        // НЕОБХОДИМО: Немедленно сообщаем системе о начале воспроизведения
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

        // --- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Добавляем немедленное обновление здесь ---
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

    // --- ИЗМЕНЕННЫЙ МЕТОД NEXT (ЭТАЛОННОЕ ПОВЕДЕНИЕ) ---
    next() {
        if (this.playbackSequence.length <= 1) return;

        // 1. Запоминаем, был ли включен режим автопроигрывания.
        const wasAutoPlaying = this.stateManager.getState().isAutoPlaying;

        // 2. Прерываем ТОЛЬКО текущую последовательность слова (звук, анимацию),
        // НЕ меняя глобальное состояние isAutoPlaying.
        this._interruptSequence();

        // 3. Получаем следующее слово.
        const nextWord = this._getNextWord();
        if (!nextWord) {
            this.ui.showNoWordsMessage();
            // Если слов больше нет, нужно убедиться, что плеер остановлен
            if (wasAutoPlaying) {
                this.stop();
            }
            return;
        }

        // 4. Обновляем состояние на новое слово.
        this.stateManager.setState({ currentWord: nextWord, currentPhase: 'initial', currentPhaseIndex: 0 });

        // 5. Запускаем показ нового слова.
        // Если была пауза, слово просто покажется и остановится.
        // Если был плей, _runDisplaySequence в конце своего выполнения
        // проверит актуальное состояние isAutoPlaying и продолжит цикл.
        this._runDisplaySequence(nextWord);

        // 6. Если изначально было автопроигрывание, мы должны убедиться,
        // что оно ОСТАНЕТСЯ включенным.
        if (wasAutoPlaying) {
            // Мы не вызываем start(), чтобы избежать двойного запуска.
            // Мы просто гарантируем, что флаг isAutoPlaying установлен в true.
            if (!this.stateManager.getState().isAutoPlaying) {
                this.stateManager.setState({ isAutoPlaying: true });
                this.audioEngine.playSilentAudio();
            }
        }
    }

    // --- ИЗМЕНЕННЫЙ МЕТОД PREVIOUS (ЭТАЛОННОЕ ПОВЕДЕНИЕ) ---
    previous() {
        if (this.playbackSequence.length <= 1) return;

        // Логика полностью аналогична методу next()
        const wasAutoPlaying = this.stateManager.getState().isAutoPlaying;
        this._interruptSequence();

        this.currentSequenceIndex--;
        if (this.currentSequenceIndex < 0) {
            // Если дошли до начала, переходим в конец
            this.currentSequenceIndex = this.playbackSequence.length - 1;
        }

        const word = this.playbackSequence[this.currentSequenceIndex];
        this.stateManager.setState({ currentWord: word, currentPhase: 'initial', currentPhaseIndex: 0 });

        this._runDisplaySequence(word);

        if (wasAutoPlaying) {
            if (!this.stateManager.getState().isAutoPlaying) {
                this.stateManager.setState({ isAutoPlaying: true });
                this.audioEngine.playSilentAudio();
            }
        }
    }


    /**
     * Генерирует новую последовательность слов на основе текущих фильтров в состоянии.
     * @param {Array} allWords - Полный список всех слов.
     */
    generatePlaybackSequence(activeWords) {
        const { sequenceMode } = this.stateManager.getState();

        // Просто присваиваем готовый список. 
        // Если придет null или undefined, создаем пустой массив.
        this.playbackSequence = [...(activeWords || [])];

        if (sequenceMode === 'random' && this.playbackSequence.length > 1) {
            this._shuffleArray(this.playbackSequence);
        }

        // Сбрасываем индекс, т.к. последовательность полностью обновилась
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
            const phases = [];

            if (startFromIndex === 0) {
                phases.push({ name: 'fadeIn', duration: DELAYS.CARD_FADE_IN, task: () => this.ui.fadeInNewCard(word, checkAborted) });
            }

            for (let i = 0; i < state.repeatMode; i++) {
                const delayDuration = (i === 0) ? DELAYS.INITIAL_WORD : DELAYS.BETWEEN_REPEATS;
                phases.push({
                    name: `playGerman_${i}`,
                    // ✅ ИЗМЕНЕНО: Используем константу
                    duration: delayDuration + AUDIO_DURATIONS.GERMAN_WORD,
                    task: () => this._playGermanPhase(word, checkAborted, i === 0)
                });
            }

            if (state.showMorphemes) {
                phases.push({ name: 'revealMorphemes', duration: DELAYS.BEFORE_MORPHEMES, task: () => this.ui.revealMorphemesPhase(word, checkAborted) });
            }

            if (state.showSentences && word.sentence) {
                // ✅ ИЗМЕНЕНО: Используем константу
                const sentenceDuration = state.sentenceSoundEnabled ? AUDIO_DURATIONS.SENTENCE : 0;
                phases.push({
                    name: 'playSentence',
                    duration: DELAYS.BEFORE_SENTENCE + sentenceDuration,
                    task: () => this._playSentencePhase(word, checkAborted)
                });
            }

            // ✅ ИЗМЕНЕНО: Используем константу
            const translationDuration = state.translationSoundEnabled ? AUDIO_DURATIONS.TRANSLATION : 0;
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
                this.stateManager.setState({ currentPhaseIndex: 0 });
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
            // Увеличиваем счетчик только один раз за слово, в последней фазе
            this.stateManager.setState({ studiedToday: studiedToday + 1 });
        }
    }

    // Этот метод теперь только прерывает текущую операцию, не меняя глобальное состояние
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
            this.currentSequenceIndex = 0; // Цикл по кругу
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