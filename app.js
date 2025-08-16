// app.js - Версия 3.0.0 (Interactive Verb Cards)
"use strict";

// --- КОНФИГУРАЦИЯ И КОНСТАНТЫ ---
const APP_VERSION = '3.0.0'; // Обновляем версию
const TTS_API_BASE_URL = 'https://deutsch-lernen-blnp.onrender.com';
// ... (остальные константы) ...

const DELAYS = {
    INITIAL_WORD: 500,
    BETWEEN_REPEATS: 1500,
    BEFORE_MORPHEMES: 1500,
    BEFORE_SENTENCE: 4000,
    BEFORE_TRANSLATION: 3000,
    BEFORE_NEXT_WORD: 3000,
    CARD_FADE_OUT: 750,
    CARD_FADE_IN: 300
};
const delay = ms => new Promise(res => setTimeout(res, ms));

class VocabularyApp {
    constructor() {
        this.appVersion = APP_VERSION;
        this.allWords = [];
        this.vocabulariesCache = {};
        this.wordHistory = [];
        this.currentHistoryIndex = -1;
        this.sequenceController = null;
        this.audioPlayer = document.getElementById('audioPlayer');
        this.themeMap = {};
        this.state = {
            isAutoPlaying: false,
            currentWord: null,
            currentPhase: 'initial',
            // НОВОЕ: Состояния для режима грамматики
            isGrammarModeActive: false,
            activeGrammarTab: 'praesens',
            // --- Конец новых состояний ---
            studiedToday: 0,
            lastStudyDate: null,
            soundEnabled: true,
            translationSoundEnabled: true,
            sentenceSoundEnabled: true,
            repeatMode: '2',
            currentVocabulary: 'vocabulary',
            availableVocabularies: [],
            selectedLevels: ['A1', 'A2', 'B1', 'B2'],
            availableLevels: [],
            selectedTheme: 'all',
            availableThemes: [],
            showArticles: true,
            showMorphemes: true,
            showMorphemeTranslations: true,
            showSentences: true,
        };
        this.elements = {
            studyArea: document.getElementById('studyArea'),
            totalWords: document.getElementById('totalWords'),
            studiedToday: document.getElementById('studiedToday'),
            settingsPanel: document.getElementById('settings-panel'),
            settingsOverlay: document.getElementById('settings-overlay'),
            themeButtonsContainer: document.getElementById('themeButtonsContainer'),
            vocabularyManager: document.querySelector('.vocabulary-manager'),
            mobileVocabularySection: document.querySelector('.settings-section[data-section="vocabulary"]'),
        };
        this.loadStateFromLocalStorage();
        this.runMigrations();
    }

    setState(newState) {
        // НОВОЕ: Если мы выходим из режима грамматики, нужно обновить карточку
        const oldGrammarMode = this.state.isGrammarModeActive;
        this.state = { ...this.state, ...newState };
        this.updateUI();
        this.saveStateToLocalStorage();
        if (oldGrammarMode && !this.state.isGrammarModeActive && this.state.currentWord) {
            this.renderWordCard(this.state.currentWord);
            this.updateCardView(this.state.currentWord);
        }
    }

    // ... (init, loadAndSwitchVocabulary и другие методы остаются без изменений) ...

    async runDisplaySequence(word) {
        if (!word) {
            this.showNoWordsMessage();
            this.stopAutoPlay();
            return;
        }
        // НОВОЕ: Не запускать последовательность, если мы в режиме грамматики
        if (this.state.isGrammarModeActive) return;

        if (this.sequenceController) {
            this.sequenceController.abort();
        }
        this.sequenceController = new AbortController();
        const { signal } = this.sequenceController;
        try {
            const checkAborted = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
            if (word.id !== this.state.currentWord?.id) {
                this.setState({ currentWord: word, currentPhase: 'initial' });
            }
            let phase = this.state.currentPhase;
            if (phase === 'initial') {
                await this._fadeInNewCard(word, checkAborted);
                if (!this.state.isAutoPlaying) return;
                await this._playGermanPhase(word, checkAborted);
                this.setState({ currentPhase: 'german' });
                phase = 'german';
            }
            checkAborted();
            if (phase === 'german') {
                await this._revealMorphemesPhase(word, checkAborted);
                this.setState({ currentPhase: 'morphemes' });
                phase = 'morphemes';
            }
            checkAborted();
            if (phase === 'morphemes') {
                await this._playSentencePhase(word, checkAborted);
                this.setState({ currentPhase: 'sentence' });
                phase = 'sentence';
            }
            checkAborted();
            if (phase === 'sentence') {
                await this._revealTranslationPhase(word, checkAborted);
                this.setState({ currentPhase: 'translation' });
            }
            checkAborted();
            if (this.state.isAutoPlaying) {
                await this._prepareNextWord(checkAborted);
                const nextWord = this.getNextWord();
                this.setState({ currentWord: nextWord, currentPhase: 'initial' });
                this.runDisplaySequence(nextWord);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('▶️ Последовательность корректно прервана. Текущая фаза:', this.state.currentPhase);
            } else {
                console.error('Ошибка в последовательности воспроизведения:', error);
                this.stopAutoPlay();
            }
        }
    }

    async _fadeInNewCard(word, checkAborted) {
        const oldCard = document.getElementById('wordCard');
        if (oldCard) {
            oldCard.classList.add('word-crossfade', 'word-fade-out');
            await delay(DELAYS.CARD_FADE_IN);
            checkAborted();
        }
        this.renderWordCard(word); // ИЗМЕНЕНО: Используем новую общую функцию
        this.addToHistory(word);
    }

    // ... (остальные _-методы последовательности без изменений) ...

    // --- НОВЫЕ МЕТОДЫ ДЛЯ РЕЖИМА ГРАММАТИКИ ---

    handleCardClick() {
        const word = this.state.currentWord;
        if (!word) return;

        // Если это глагол и мы не в режиме грамматики, входим в него
        if (word.grammar_details?.type === 'verb' && !this.state.isGrammarModeActive) {
            this.enterGrammarMode();
        } else if (!this.state.isGrammarModeActive) {
            // Для всех остальных слов просто запускаем/останавливаем
            this.toggleAutoPlay();
        }
        // Если мы уже в режиме грамматики, клик по карточке ничего не делает (управление через кнопки)
    }

    enterGrammarMode() {
        if (!this.state.currentWord || this.state.currentWord.grammar_details?.type !== 'verb') return;
        this.stopAutoPlay();
        this.setState({ isGrammarModeActive: true, activeGrammarTab: 'praesens' });
        this.renderWordCard(this.state.currentWord);
    }

    exitGrammarMode() {
        this.setState({ isGrammarModeActive: false });
        // setState сам вызовет перерисовку
    }

    setActiveGrammarTab(tabName) {
        this.setState({ activeGrammarTab: tabName });
        this.renderWordCard(this.state.currentWord); // Перерисовываем карточку с новой активной вкладкой
    }

    highlightVerbEnding(conjugatedForm) {
        const parts = conjugatedForm.split(' ');
        const verbPart = parts[0];
        const prefixPart = parts.length > 1 ? ` <span class="verb-prefix">${parts.slice(1).join(' ')}</span>` : '';
        const endings = ['est', 'et', 'en', 'st', 't', 'e'];
        for (const ending of endings) {
            if (verbPart.endsWith(ending)) {
                const stem = verbPart.slice(0, -ending.length);
                return `<span class="verb-stem">${stem}</span><span class.verb-ending">${ending}</span>${prefixPart}`;
            }
        }
        return `<span class="verb-stem">${conjugatedForm}</span>`;
    }

    // --- КОНЕЦ НОВЫХ МЕТОДОВ ---

    // ИЗМЕНЕНО: renderInitialCard переименована в renderWordCard и стала умнее
    renderWordCard(word) {
        if (!word) { this.showNoWordsMessage(); return; }

        // Сценарий 1: Режим грамматики для глагола
        if (this.state.isGrammarModeActive && word.grammar_details?.type === 'verb') {
            this.renderGrammarCard(word);
        }
        // Сценарий 2: Обычный режим для всех слов
        else {
            this.renderStandardCard(word);
        }
        this.updateUI();
    }

    renderStandardCard(word) {
        const levelHtml = word.level ? `<div class="level-indicator ${word.level.toLowerCase()}">${word.level}</div>` : '';
        const grammarButtonHtml = word.grammar_details?.type === 'verb'
            ? `<button class="grammar-prompt-btn">Другие формы §</button>`
            : '';

        this.elements.studyArea.innerHTML = `
            <div class="card card-appear" id="wordCard">
                ${levelHtml}
                <div class="word-container">
                    ${this.formatGermanWord(word)}
                    <div class="pronunciation">${word.pronunciation || ''}</div>
                    <div id="translationContainer" class="translation-container"></div>
                    <div id="morphemeTranslations" class="morpheme-translations"></div>
                    <div id="sentenceContainer" class="sentence-container"></div>
                    ${grammarButtonHtml}
                </div>
            </div>`;

        document.getElementById('wordCard')?.addEventListener('click', () => this.handleCardClick());
    }

    renderGrammarCard(word) {
        const tabs = ['praesens', 'praeteritum', 'perfekt', 'konjunktiv_ii'];
        const tabLabels = { 'praesens': 'Präsens', 'praeteritum': 'Präteritum', 'perfekt': 'Perfekt', 'konjunktiv_ii': 'Konjunktiv II' };

        const tabsHtml = tabs.map(tab => `
            <button class="grammar-tab ${this.state.activeGrammarTab === tab ? 'active' : ''}" data-tab="${tab}">
                ${tabLabels[tab]}
            </button>
        `).join('');

        this.elements.studyArea.innerHTML = `
            <div class="card grammar-mode" id="wordCard">
                <button class="grammar-back-btn">&larr; Назад</button>
                <div class="word-container grammar-header">
                    <div class="word">${word.german}</div>
                    <div class="translation">${word.russian}</div>
                </div>
                <div class="grammar-tabs">${tabsHtml}</div>
                <div class="grammar-content">${this.renderGrammarTabContent(word)}</div>
            </div>`;

        // Добавляем обработчики событий
        document.querySelector('.grammar-back-btn').addEventListener('click', () => this.exitGrammarMode());
        document.querySelectorAll('.grammar-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.setActiveGrammarTab(e.currentTarget.dataset.tab));
        });
    }

    renderGrammarTabContent(word) {
        const details = word.grammar_details;
        if (!details) return '<div>Нет данных.</div>';

        switch (this.state.activeGrammarTab) {
            case 'praesens':
                return `
                    <div class="conjugation-table">
                        ${details.praesens_conjugation.map(item => `
                            <div class="conjugation-row">
                                <span class="person">${item.person}</span>
                                <span class="form">${this.highlightVerbEnding(item.form)}</span>
                            </div>
                        `).join('')}
                    </div>`;

            case 'praeteritum':
                // Эта логика упрощена, но для большинства случаев сработает
                const praeteritumBase = details.praeteritum.split(' ')[0];
                const prefix = details.praeteritum.split(' ').length > 1 ? ` ${details.praeteritum.split(' ').slice(1).join(' ')}` : '';
                const praeteritumEndings = { ich: '', du: 'st', 'er/sie/es': '', wir: 'en', ihr: 't', 'sie/Sie': 'en' };
                return `
                     <div class="conjugation-table">
                        ${details.praesens_conjugation.map(item => `
                             <div class="conjugation-row">
                                <span class="person">${item.person}</span>
                                <span class="form">${this.highlightVerbEnding(praeteritumBase + praeteritumEndings[item.person] + prefix)}</span>
                            </div>
                        `).join('')}
                    </div>`;

            case 'perfekt':
                const auxVerb = details.auxiliary;
                const auxConjugation = {
                    'haben': { ich: 'habe', du: 'hast', 'er/sie/es': 'hat', wir: 'haben', ihr: 'habt', 'sie/Sie': 'haben' },
                    'sein': { ich: 'bin', du: 'bist', 'er/sie/es': 'ist', wir: 'sind', ihr: 'seid', 'sie/Sie': 'sind' }
                };
                return `
                    <div class="grammar-formula">
                        <p>Вспом. глагол: <strong>${auxVerb}</strong></p>
                        <p>Формула: <strong>${auxVerb} + ... + ${details.perfekt}</strong></p>
                    </div>
                    <div class="conjugation-table">
                        ${details.praesens_conjugation.map(item => `
                             <div class="conjugation-row">
                                <span class="person">${item.person}</span>
                                <span class="form">${auxConjugation[auxVerb][item.person]} ... ${details.perfekt}</span>
                            </div>
                        `).join('')}
                    </div>`;

            case 'konjunktiv_ii':
                return `<div class="grammar-formula single-line"><p>${details.konjunktiv_ii_er}</p></div>`;

            default:
                return '<div>Выберите вкладку.</div>';
        }
    }

    // ... (остальные функции без изменений) ...
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new VocabularyApp();
        app.init();
        window.app = app;
        console.log('✅ Приложение инициализировано. Версия:', APP_VERSION);
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        document.body.innerHTML = `<div style="text-align:center;padding:50px;"><h1>Произошла ошибка</h1><p>Попробуйте очистить кэш браузера.</p></div>`;
    }
});