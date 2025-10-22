// app.js - Версия 4.0.0 (Stable Frame & Final UI)
"use strict";

// --- КОНФИГУРАЦИЯ И КОНСТАНТЫ ---
const APP_VERSION = '4.0.0'; // Обновляем версию
const TTS_API_BASE_URL = 'https://deutsch-lernen-sandbox.onrender.com';
// ... (остальные константы) ...

const DELAYS = {
    INITIAL_WORD: 500,
    BETWEEN_REPEATS: 1000,
    BEFORE_MORPHEMES: 1000,
    BEFORE_SENTENCE: 2000,
    BEFORE_TRANSLATION: 1000,
    BEFORE_NEXT_WORD: 2000,
    CARD_FADE_OUT: 750,
    CARD_FADE_IN: 300
};
const delay = ms => new Promise(res => setTimeout(res, ms));

class VocabularyApp {
    // ... (весь остальной код класса VocabularyApp остается БЕЗ ИЗМЕНЕНИЙ) ...
    // ... (constructor, setState, init, loadAndSwitchVocabulary... etc.) ...
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
            studiedToday: 0,
            lastStudyDate: null,
            soundEnabled: true,
            translationSoundEnabled: true,
            sentenceSoundEnabled: true,
            sequenceMode: 'sequential',
            repeatMode: 2,
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
        // --- ИЗМЕНЕНИЕ 1: Добавляем 'mainContent' в список элементов для доступа к стабильному фрейму ---
        this.elements = {
            mainContent: document.getElementById('mainContent'),
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
        this.state = { ...this.state, ...newState };
        this.updateUI();
        this.saveStateToLocalStorage();
    }
    async init() {
        this.bindEvents();
        setTimeout(() => {
            document.querySelector('.header-mobile')?.classList.add('collapsed');
        }, 3000);
        await this.loadAndSwitchVocabulary(this.state.currentVocabulary, true);
    }
    async loadAndSwitchVocabulary(vocabNameToLoad, isInitialLoad = false) {
        this.stopAutoPlay();
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>Загрузка...</p></div>`;
        if (this.state.availableVocabularies.length === 0) {
            try {
                const response = await fetch(`${TTS_API_BASE_URL}/api/vocabularies/list`);
                if (!response.ok) throw new Error('Сервер не отвечает.');
                const vocabs = await response.json();
                if (!vocabs || vocabs.length === 0) throw new Error('На сервере нет словарей. Убедитесь, что файлы .json лежат в папке /vocabularies/');
                this.state.availableVocabularies = vocabs;
            } catch (error) {
                console.error(error);
                this.handleLoadingError(error.message);
                return;
            }
        }
        let finalVocabName = vocabNameToLoad;
        const vocabExists = this.state.availableVocabularies.some(v => v.name === finalVocabName);
        if (!vocabExists) {
            finalVocabName = this.state.availableVocabularies[0]?.name;
            if (!finalVocabName) {
                this.handleLoadingError("Не найдено ни одного словаря для загрузки.");
                return;
            }
        }
        try {
            await this.fetchVocabularyData(finalVocabName);
            const vocabularyData = this.vocabulariesCache[finalVocabName];
            if (!vocabularyData) throw new Error("Кэшированные данные не найдены после загрузки.");
            this.allWords = vocabularyData.words;
            this.themeMap = vocabularyData.meta.themes || {};
        } catch (error) {
            console.error(`Ошибка загрузки словаря "${finalVocabName}":`, error);
            this.handleLoadingError(`Не удалось загрузить данные словаря: ${finalVocabName}.`);
            return;
        }
        this.state.currentVocabulary = finalVocabName;
        this.updateDynamicFilters();
        this.renderVocabularySelector();
        this.handleFilterChange(isInitialLoad);
    }
    async fetchVocabularyData(vocabName) {
        if (this.vocabulariesCache[vocabName] && this.vocabulariesCache[vocabName].words) {
            return;
        }
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>Загружаю словарь: ${vocabName}...</p></div>`;
        const response = await fetch(`${TTS_API_BASE_URL}/api/vocabulary/${vocabName}`);
        if (!response.ok) throw new Error(`Ошибка сервера ${response.status}`);
        const data = await response.json();
        if (!data.words || !data.meta || !data.meta.themes) {
            if (Array.isArray(data)) {
                console.warn(`Словарь "${vocabName}" имеет устаревший формат (простой массив). Рекомендуется обновить его до структуры {meta, words}.`);
                this.vocabulariesCache[vocabName] = {
                    words: data.map((w, i) => ({ ...w, id: w.id || `${vocabName}_word_${Date.now()}_${i}` })),
                    meta: { themes: {} }
                };
                return;
            }
            throw new Error(`Неверный формат словаря "${vocabName}": отсутствует 'words' или 'meta.themes'`);
        }
        this.vocabulariesCache[vocabName] = {
            words: data.words.map((w, i) => ({ ...w, id: w.id || `${vocabName}_word_${Date.now()}_${i}` })),
            meta: data.meta
        };
    }
    handleLoadingError(errorMessage) {
        this.allWords = [];
        this.themeMap = {};
        this.state.currentWord = null;
        this.state.availableLevels = [];
        this.state.availableThemes = [];
        this.renderThemeButtons();
        this.showNoWordsMessage(errorMessage);
        this.renderVocabularySelector();
        this.updateUI();
    }
    updateDynamicFilters() {
        const words = this.allWords;
        const availableLevels = [...new Set(words.map(w => w.level).filter(Boolean))].sort();
        this.state.availableLevels = availableLevels;
        let newSelectedLevels = this.state.selectedLevels.filter(l => availableLevels.includes(l));
        if (newSelectedLevels.length === 0 && availableLevels.length > 0) {
            newSelectedLevels = [...availableLevels];
        }
        this.state.selectedLevels = newSelectedLevels;
        const availableThemes = [...new Set(words.map(w => w.theme).filter(Boolean))].sort();
        this.state.availableThemes = availableThemes;
        this.renderThemeButtons();
        if (this.state.selectedTheme !== 'all' && !availableThemes.includes(this.state.selectedTheme)) {
            this.state.selectedTheme = 'all';
        }
    }
    renderVocabularySelector() {
        const vocabs = this.state.availableVocabularies;
        const showSelector = vocabs && vocabs.length > 0;
        if (this.elements.vocabularyManager) this.elements.vocabularyManager.style.display = showSelector ? 'block' : 'none';
        if (this.elements.mobileVocabularySection) this.elements.mobileVocabularySection.style.display = showSelector ? 'block' : 'none';
        const createOptions = (selectEl) => {
            selectEl.innerHTML = '';
            if (!showSelector) return;
            vocabs.forEach(vocab => {
                const option = document.createElement('option');
                option.value = vocab.name;
                const displayName = vocab.name.charAt(0).toUpperCase() + vocab.name.slice(1);
                option.textContent = `${displayName} (${vocab.word_count} слов)`;
                if (vocab.name === this.state.currentVocabulary) {
                    option.selected = true;
                }
                selectEl.appendChild(option);
            });
        };
        document.querySelectorAll('[id^=vocabularySelector]').forEach(createOptions);
    }
    startAutoPlay() {
        if (this.state.isAutoPlaying) return;
        let wordToShow = this.state.currentWord;
        if (!wordToShow || this.state.currentPhase === 'translation') {
            wordToShow = this.getNextWord();
            if (wordToShow) {
                this.setState({ currentWord: wordToShow, currentPhase: 'initial' });
            }
        }
        if (wordToShow) {
            this.setState({ isAutoPlaying: true });
            this.runDisplaySequence(wordToShow);
        } else {
            this.showNoWordsMessage();
        }
    }
    stopAutoPlay() {
        if (this.sequenceController) {
            this.sequenceController.abort();
        }
        this.setState({ isAutoPlaying: false });
    }
    toggleAutoPlay() {
        if (this.state.isAutoPlaying) {
            this.stopAutoPlay();
        } else {
            this.startAutoPlay();
        }
    }
    async runDisplaySequence(word) {
        if (!word) {
            this.showNoWordsMessage();
            this.stopAutoPlay();
            return;
        }
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
        this.renderInitialCard(word);
        this.addToHistory(word);
    }
    async _playGermanPhase(word, checkAborted) {
        const repeats = this.state.repeatMode;
        for (let i = 0; i < repeats; i++) {
            await delay(i === 0 ? DELAYS.INITIAL_WORD : DELAYS.BETWEEN_REPEATS);
            checkAborted();
            await this.speakGerman(word);
            checkAborted();
        }
    }
    async _revealMorphemesPhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_MORPHEMES);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-morphemes');
        this.displayMorphemesAndTranslations(word);
    }
    async _playSentencePhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_SENTENCE);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-sentence');
        this.displaySentence(word);
        if (this.state.showSentences && word.sentence) {
            await this.speakSentence(word);
            checkAborted();
        }
    }
    async _revealTranslationPhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_TRANSLATION);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-translation');
        this.displayFinalTranslation(word);
        await this.speakRussian(word);
        checkAborted();
        if (this.state.isAutoPlaying) {
            this.setState({ studiedToday: this.state.studiedToday + 1 });
        }
    }
    async _prepareNextWord(checkAborted) {
        await delay(DELAYS.BEFORE_NEXT_WORD);
        checkAborted();
        const card = document.getElementById('wordCard');
        if (card) {
            card.classList.add('word-crossfade', 'word-fade-out');
            await delay(DELAYS.CARD_FADE_OUT);
            checkAborted();
        }
    }
    speakById(wordId, part) {
        return new Promise(async (resolve, reject) => {
            if (!wordId || (this.sequenceController && this.sequenceController.signal.aborted)) {
                return resolve();
            }

            const onAbort = () => {
                this.audioPlayer.pause();
                this.audioPlayer.src = '';
                cleanup();
                reject(new DOMException('Aborted', 'AbortError'));
            };
            const onFinish = () => {
                cleanup();
                resolve();
            };
            const cleanup = () => {
                this.audioPlayer.removeEventListener('ended', onFinish);
                this.audioPlayer.removeEventListener('error', onFinish);
                this.sequenceController?.signal.removeEventListener('abort', onAbort);
            };

            try {
                const apiUrl = `${TTS_API_BASE_URL}/synthesize_by_id?id=${wordId}&part=${part}&vocab=${this.state.currentVocabulary}`;
                const response = await fetch(apiUrl, { signal: this.sequenceController?.signal });
                if (!response.ok) throw new Error(`TTS server error: ${response.statusText}`);
                const data = await response.json();
                if (!data.url) throw new Error('Invalid response from TTS server');
                if (this.sequenceController?.signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));

                this.audioPlayer.src = `${TTS_API_BASE_URL}${data.url}`;
                this.audioPlayer.addEventListener('ended', onFinish, { once: true });
                this.audioPlayer.addEventListener('error', onFinish, { once: true });
                this.sequenceController?.signal.addEventListener('abort', onAbort, { once: true });

                await this.audioPlayer.play();
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Ошибка в методе speakById:', error);
                }
                onFinish();
            }
        });
    }
    async speakGerman(word) { if (this.state.soundEnabled && word && word.id) await this.speakById(word.id, 'german'); }
    async speakRussian(word) { if (this.state.translationSoundEnabled && word && word.id) await this.speakById(word.id, 'russian'); }
    async speakSentence(word) { if (this.state.sentenceSoundEnabled && word && word.id && word.sentence) await this.speakById(word.id, 'sentence'); }
    toggleSetting(key) {
        const wasAutoPlaying = this.state.isAutoPlaying;
        this.stopAutoPlay();
        let newState = { [key]: !this.state[key] };
        if (key === 'showMorphemes' && !newState[key]) {
            newState.showMorphemeTranslations = false;
        }
        this.setState(newState);
        const word = this.state.currentWord;
        if (word && document.getElementById('wordCard')) {
            this.updateCardView(word);
        }
        if (wasAutoPlaying) {
            this.startAutoPlay();
        }
    }
    updateCardView(word) {
        this.renderInitialCard(word);
        const phase = this.state.currentPhase;
        const card = document.getElementById('wordCard');
        if (!card) return;

        if (phase === 'morphemes' || phase === 'sentence' || phase === 'translation') {
            card.classList.add('phase-morphemes');
            this.displayMorphemesAndTranslations(word);
        }

        if (phase === 'sentence' || phase === 'translation') {
            card.classList.add('phase-sentence');
            this.displaySentence(word);
        }

        if (phase === 'translation') {
            card.classList.add('phase-translation');
            this.displayFinalTranslation(word, false);
        }
    }
    updateUI() {
        this.setupIcons();
        this.updateStats();
        this.updateControlButtons();
        this.updateNavigationButtons();
        this.updateLevelButtons();
        this.updateThemeButtons();
        this.updateRepeatControlsState();
    }
    renderThemeButtons() {
        if (!this.elements.themeButtonsContainer) return;
        const wrapper = this.elements.themeButtonsContainer;
        wrapper.innerHTML = `<span class="block-label"><svg class="icon"><use xlink:href="#icon-category"></use></svg>Темы</span>`;
        const createBtn = (theme, text) => {
            const btn = document.createElement('button');
            btn.className = 'block-btn';
            btn.dataset.theme = theme;
            btn.textContent = text;
            btn.addEventListener('click', () => this.setTheme(theme));
            return btn;
        };
        if (this.state.availableThemes.length > 0) {
            wrapper.appendChild(createBtn('all', 'Все темы'));
            this.state.availableThemes.forEach(theme => {
                const themeName = this.themeMap[theme] || theme.charAt(0).toUpperCase() + theme.slice(1);
                wrapper.appendChild(createBtn(theme, themeName));
            });
        }
        this.updateThemeButtons();
    }
    setupIcons() {
        const iconMap = {
            prevButton: '#icon-prev', nextButton: '#icon-next', settingsButton: '#icon-settings',
            soundToggle: this.state.soundEnabled ? '#icon-sound-on' : '#icon-sound-off',
            translationSoundToggle: this.state.translationSoundEnabled ? '#icon-chat-on' : '#icon-chat-off',
            sentenceSoundToggle: this.state.sentenceSoundEnabled ? '#icon-sentence-on' : '#icon-sentence-off',
            toggleButton: this.state.isAutoPlaying ? '#icon-pause' : '#icon-play'
        };
        for (const [key, href] of Object.entries(iconMap)) {
            document.querySelectorAll(`[id^=${key}]`).forEach(btn => {
                const use = btn.querySelector('use');
                if (!use) {
                    btn.innerHTML = `<svg class="icon"><use xlink:href="${href}"></use></svg>`;
                } else if (use.getAttribute('xlink:href') !== href) {
                    use.setAttribute('xlink:href', href);
                }
            });
        }
    }
    updateControlButtons() {
        this.setupIcons();
        this.updateToggleButton();
        const controls = {
            toggleArticles: this.state.showArticles,
            toggleMorphemes: this.state.showMorphemes,
            toggleMorphemeTranslations: this.state.showMorphemeTranslations,
            toggleSentences: this.state.showSentences,
            soundToggle: this.state.soundEnabled,
            translationSoundToggle: this.state.translationSoundEnabled,
            sentenceSoundToggle: this.state.sentenceSoundEnabled
        };
        for (const [key, state] of Object.entries(controls)) {
            document.querySelectorAll(`[id^=${key}]`).forEach(btn => {
                btn.classList.toggle('active', state);
                if (btn.classList.contains('option-btn') || (btn.classList.contains('repeat-selector') && !btn.dataset.mode)) {
                    btn.textContent = state ? 'Вкл' : 'Выкл';
                }
            });
        }
        document.querySelectorAll('[id^=toggleMorphemeTranslations]').forEach(btn => {
            btn.disabled = !this.state.showMorphemes;
        });
    }
    updateToggleButton() {
        document.querySelectorAll('[id^=toggleButton]').forEach(btn => {
            btn.classList.toggle('playing', this.state.isAutoPlaying);
        });
        document.getElementById('wordCard')?.classList.toggle('is-clickable', !this.state.isAutoPlaying);
    }
    loadStateFromLocalStorage() {
        const safeJsonParse = (k, d) => { try { const i = localStorage.getItem(k); return i ? JSON.parse(i) : d; } catch { return d; } };
        const today = new Date().toDateString();
        const lastStudyDate = localStorage.getItem('lastStudyDate');
        this.state.studiedToday = (lastStudyDate === today) ? (parseInt(localStorage.getItem('studiedToday')) || 0) : 0;
        this.state.lastStudyDate = today;
        this.state.soundEnabled = safeJsonParse('soundEnabled', true);
        this.state.translationSoundEnabled = safeJsonParse('translationSoundEnabled', true);
        this.state.sentenceSoundEnabled = safeJsonParse('sentenceSoundEnabled', true);

        // Миграция старого repeatMode в новую структуру
        const oldRepeatMode = safeJsonParse('repeatMode', 2);
        if (oldRepeatMode === 'random') {
            this.state.sequenceMode = 'random';
            this.state.repeatMode = 2;
        } else {
            this.state.sequenceMode = safeJsonParse('sequenceMode', 'sequential');
            this.state.repeatMode = typeof oldRepeatMode === 'string' ? parseInt(oldRepeatMode, 10) : oldRepeatMode;
        }

        this.state.selectedLevels = safeJsonParse('selectedLevels', ['A1', 'A2', 'B1', 'B2']);
        this.state.selectedTheme = localStorage.getItem('selectedTheme') || 'all';
        this.state.showArticles = safeJsonParse('showArticles', true);
        this.state.showMorphemes = safeJsonParse('showMorphemes', true);
        this.state.showMorphemeTranslations = safeJsonParse('showMorphemeTranslations', true);
        this.state.showSentences = safeJsonParse('showSentences', true);
        this.state.currentVocabulary = localStorage.getItem('currentVocabulary') || 'vocabulary';
    }
    saveStateToLocalStorage() {
        localStorage.setItem('appVersion', this.appVersion);
        localStorage.setItem('lastStudyDate', this.state.lastStudyDate);
        localStorage.setItem('studiedToday', this.state.studiedToday);
        localStorage.setItem('soundEnabled', JSON.stringify(this.state.soundEnabled));
        localStorage.setItem('translationSoundEnabled', JSON.stringify(this.state.translationSoundEnabled));
        localStorage.setItem('sentenceSoundEnabled', JSON.stringify(this.state.sentenceSoundEnabled));
        localStorage.setItem('sequenceMode', JSON.stringify(this.state.sequenceMode));
        localStorage.setItem('repeatMode', JSON.stringify(this.state.repeatMode));
        localStorage.setItem('selectedLevels', JSON.stringify(this.state.selectedLevels));
        localStorage.setItem('selectedTheme', this.state.selectedTheme);
        localStorage.setItem('showArticles', JSON.stringify(this.state.showArticles));
        localStorage.setItem('showMorphemes', JSON.stringify(this.state.showMorphemes));
        localStorage.setItem('showMorphemeTranslations', JSON.stringify(this.state.showMorphemeTranslations));
        localStorage.setItem('showSentences', JSON.stringify(this.state.showSentences));
        localStorage.setItem('currentVocabulary', this.state.currentVocabulary);
    }
    runMigrations() {
        const savedVersion = localStorage.getItem('appVersion') || '1.0';
        if (parseFloat(savedVersion) < 2.8) {
            localStorage.removeItem('germanWords');
            localStorage.setItem('appVersion', this.appVersion);
        }
    }
    handleFilterChange(isInitialLoad = false) {
        this.stopAutoPlay();
        const nextWord = this.getNextWord();
        this.wordHistory = [];
        this.currentHistoryIndex = -1;
        this.setState({ currentWord: nextWord, currentPhase: 'initial' });
        if (nextWord) {
            if (isInitialLoad) {
                this.renderInitialCard(nextWord);
                this.addToHistory(nextWord);
            } else {
                this.runDisplaySequence(nextWord);
            }
        } else {
            this.showNoWordsMessage();
        }
    }
    addToHistory(word) {
        if (!word || (this.wordHistory[this.currentHistoryIndex] && this.wordHistory[this.currentHistoryIndex].id === word.id)) return;
        if (this.currentHistoryIndex < this.wordHistory.length - 1) {
            this.wordHistory.splice(this.currentHistoryIndex + 1);
        }
        this.wordHistory.push(word);
        if (this.wordHistory.length > 50) this.wordHistory.shift();
        this.currentHistoryIndex = this.wordHistory.length - 1;
        this.updateNavigationButtons();
    }
    showPreviousWord() {
        if (this.currentHistoryIndex <= 0) return;
        const wasAutoPlaying = this.state.isAutoPlaying;
        this.stopAutoPlay();
        this.currentHistoryIndex--;
        const word = this.wordHistory[this.currentHistoryIndex];
        this.setState({ currentWord: word, currentPhase: 'initial' });
        this.runDisplaySequence(word);
        if (wasAutoPlaying) this.startAutoPlay();
    }
    showNextWordManually() {
        const wasAutoPlaying = this.state.isAutoPlaying;
        this.stopAutoPlay();
        let nextWord;
        if (this.currentHistoryIndex < this.wordHistory.length - 1) {
            this.currentHistoryIndex++;
            nextWord = this.wordHistory[this.currentHistoryIndex];
        } else {
            nextWord = this.getNextWord();
        }
        if (!nextWord) {
            this.showNoWordsMessage();
            return;
        }
        this.setState({ currentWord: nextWord, currentPhase: 'initial' });
        this.runDisplaySequence(nextWord);
        if (wasAutoPlaying) this.startAutoPlay();
    }

    // --- ИЗМЕНЕНИЕ 2: Полностью переработанный метод для раздельной отрисовки индикатора и карточки ---
    renderInitialCard(word) {
        if (!word) {
            this.showNoWordsMessage();
            return;
        }

        // 1. Управляем индикатором отдельно, ВНЕ studyArea
        // Сначала удаляем старый индикатор, если он есть, из стабильного фрейма
        this.elements.mainContent.querySelector('.level-indicator')?.remove();

        // Затем создаем и вставляем новый индикатор прямо в mainContent (наш стабильный фрейм)
        if (word.level) {
            const levelHtml = `<div class="level-indicator ${word.level.toLowerCase()}">${word.level}</div>`;
            this.elements.mainContent.insertAdjacentHTML('afterbegin', levelHtml);
        }

        // 2. Генерируем HTML для карточки УЖЕ БЕЗ ИНДИКАТОРА
        const cardHtml = `
            <div class="card card-appear" id="wordCard">
                <div class="word-container">
                    ${this.formatGermanWord(word)}
                    <div class="pronunciation">${word.pronunciation || ''}</div>
                    <div class="swappable-area">
                        <div id="morphemeTranslations" class="morpheme-translations"></div>
                        <div id="translationContainer" class="translation-container"></div>
                    </div>
                    <div id="sentenceContainer" class="sentence-container"></div>
                </div>
            </div>`;

        // 3. Обновляем ТОЛЬКО studyArea, не затрагивая индикатор
        this.elements.studyArea.innerHTML = cardHtml;

        // 4. Вешаем обработчик как и раньше
        document.getElementById('wordCard')?.addEventListener('click', () => this.toggleAutoPlay());
        this.updateUI();
    }

    displayMorphemesAndTranslations(word) {
        const { showMorphemes, showMorphemeTranslations } = this.state;
        const mainWordElement = document.querySelector('.word .main-word');
        const translationsContainer = document.getElementById('morphemeTranslations');
        const wordElement = document.querySelector('.word');

        if (!mainWordElement || !translationsContainer || !wordElement || !word) return;

        wordElement.classList.remove('show-morphemes');
        translationsContainer.classList.remove('visible');
        translationsContainer.innerHTML = '';

        if (word.morphemes && word.morphemes.length > 0 && showMorphemes) {
            const separatorHTML = `<span class="morpheme-separator"><span class="morpheme-separator-desktop">-</span><span class="morpheme-separator-mobile">|</span></span>`;
            mainWordElement.innerHTML = word.morphemes.map(item => `<span class="morpheme">${item.m || ''}</span>`).join(separatorHTML);
            wordElement.classList.add('show-morphemes');

            if (showMorphemeTranslations) {
                translationsContainer.innerHTML = word.morphemes.map(item => `<div class="morpheme-translation-item"><span class="morpheme-part">${item.m || ''}</span><span class="translation-part">${item.t || '?'}</span></div>`).join('');
                translationsContainer.classList.add('visible');
            }
        }
    }
    displaySentence(word) {
        const { showSentences } = this.state;
        const container = document.getElementById('sentenceContainer');
        if (!container || !word) return;

        if (showSentences && word.sentence) {
            container.innerHTML = `<div class="sentence">${word.sentence}<div class="sentence-translation">${word.sentence_ru}</div></div>`;
            container.classList.add('visible');
        } else {
            container.innerHTML = '';
            container.classList.remove('visible');
        }
    }
    displayFinalTranslation(word, withAnimation = true) {
        const card = document.getElementById('wordCard');
        if (!card) return;
        const translationContainer = document.getElementById('translationContainer');
        if (translationContainer) {
            translationContainer.innerHTML = `<div class="translation ${withAnimation ? 'translation-appear' : ''}">${word.russian}</div>`;
        }
    }
    updateStats() {
        if (this.elements.totalWords) this.elements.totalWords.textContent = this.getActiveWords().length;
        if (this.elements.studiedToday) this.elements.studiedToday.textContent = this.state.studiedToday;
    }
    updateNavigationButtons() {
        document.querySelectorAll('[id^=prevButton]').forEach(btn => btn.disabled = this.currentHistoryIndex <= 0);
        const hasNextInHistory = this.currentHistoryIndex < this.wordHistory.length - 1;
        const activeWords = this.getActiveWords();
        const currentIndexInActive = activeWords.findIndex(w => w.id === this.state.currentWord?.id);
        const canGenerateNext = activeWords.length > 0 && (this.state.sequenceMode === 'random' || currentIndexInActive < activeWords.length - 1 || currentIndexInActive === -1);
        document.querySelectorAll('[id^=nextButton]').forEach(btn => btn.disabled = !this.allWords.length || (!hasNextInHistory && !canGenerateNext));
    }
    updateLevelButtons() {
        document.querySelectorAll('.level-btn').forEach(b => {
            const level = b.dataset.level;
            const isAvailable = this.state.availableLevels.includes(level);
            b.disabled = !isAvailable;
            b.classList.toggle('active', isAvailable && this.state.selectedLevels.includes(level));
        });
    }
    updateThemeButtons() {
        document.querySelectorAll('.block-btn[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === this.state.selectedTheme));
    }
    updateRepeatControlsState() {
        // Обновляем кнопки повторений
        document.querySelectorAll('.repeat-selector, .repeat-selector-mobile').forEach(button => {
            button.classList.toggle('active', parseInt(button.dataset.mode) === this.state.repeatMode);
        });
        // Обновляем кнопки порядка
        document.querySelectorAll('.sequence-selector, .sequence-selector-mobile').forEach(button => {
            button.classList.toggle('active', button.dataset.mode === this.state.sequenceMode);
        });
    }
    bindEvents() {
        document.getElementById('settingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(true));
        document.getElementById('closeSettingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(false));
        this.elements.settingsOverlay.addEventListener('click', () => this.toggleSettingsPanel(false));
        document.querySelectorAll('[id^=toggleButton]').forEach(b => b.addEventListener('click', () => this.toggleAutoPlay()));
        document.querySelectorAll('[id^=prevButton]').forEach(b => b.addEventListener('click', () => this.showPreviousWord()));
        document.querySelectorAll('[id^=nextButton]').forEach(b => b.addEventListener('click', () => this.showNextWordManually()));
        document.querySelectorAll('[id^=soundToggle]').forEach(b => b.addEventListener('click', () => this.toggleSetting('soundEnabled')));
        document.querySelectorAll('[id^=translationSoundToggle]').forEach(b => b.addEventListener('click', () => this.toggleSetting('translationSoundEnabled')));
        document.querySelectorAll('[id^=sentenceSoundToggle]').forEach(b => b.addEventListener('click', () => this.toggleSetting('sentenceSoundEnabled')));
        document.querySelectorAll('[id^=toggleArticles]').forEach(b => b.addEventListener('click', () => this.toggleSetting('showArticles')));
        document.querySelectorAll('[id^=toggleMorphemes]').forEach(b => b.addEventListener('click', () => this.toggleSetting('showMorphemes')));
        document.querySelectorAll('[id^=toggleMorphemeTranslations]').forEach(b => b.addEventListener('click', () => this.toggleSetting('showMorphemeTranslations')));
        document.querySelectorAll('[id^=toggleSentences]').forEach(b => b.addEventListener('click', () => this.toggleSetting('showSentences')));
        document.querySelectorAll('.level-btn').forEach(btn => btn.addEventListener('click', e => this.toggleLevel(e.target.dataset.level)));
        document.querySelectorAll('.repeat-selector, .repeat-selector-mobile').forEach(btn => btn.addEventListener('click', e => this.setRepeatMode(parseInt(e.currentTarget.dataset.mode))));
        document.querySelectorAll('.sequence-selector, .sequence-selector-mobile').forEach(btn => btn.addEventListener('click', e => this.setSequenceMode(e.currentTarget.dataset.mode)));
        document.querySelectorAll('[id^=vocabularySelector]').forEach(sel => sel.addEventListener('change', (e) => this.loadAndSwitchVocabulary(e.target.value)));
    }
    toggleSettingsPanel(show) {
        this.elements.settingsPanel.classList.toggle('visible', show);
        this.elements.settingsOverlay.classList.toggle('visible', show);
    }
    toggleLevel(level) {
        if (!this.state.availableLevels.includes(level)) return;
        const newLevels = this.state.selectedLevels.includes(level)
            ? (this.state.selectedLevels.length > 1 ? this.state.selectedLevels.filter(l => l !== level) : this.state.selectedLevels)
            : [...this.state.selectedLevels, level];
        this.setState({ selectedLevels: newLevels });
        this.handleFilterChange();
    }
    setTheme(theme) {
        this.setState({ selectedTheme: theme });
        this.handleFilterChange();
    }
    setRepeatMode(mode) { this.setState({ repeatMode: mode }); }
    setSequenceMode(mode) { this.setState({ sequenceMode: mode }); }
    getActiveWords() {
        const { selectedLevels, selectedTheme } = this.state;
        if (!this.allWords || this.allWords.length === 0) return [];
        return this.allWords.filter(w => w?.level && selectedLevels.includes(w.level) && (selectedTheme === 'all' || w.theme === selectedTheme));
    }
    getNextWord() {
        const activeWords = this.getActiveWords();
        if (activeWords.length === 0) return null;
        if (this.state.sequenceMode === 'random') {
            return activeWords[Math.floor(Math.random() * activeWords.length)];
        }
        const currentId = this.state.currentWord?.id;
        if (!currentId) return activeWords[0];
        const currentIndex = activeWords.findIndex(w => w.id === currentId);
        if (currentIndex === -1) return activeWords[0];
        const nextIndex = (currentIndex + 1) % activeWords.length;
        return activeWords[nextIndex];
    }
    parseGermanWord(word) {
        const german = word.german || '';
        const articles = ['der ', 'die ', 'das '];
        for (const article of articles) {
            if (german.startsWith(article)) return { article: article.trim(), mainWord: german.substring(article.length), genderClass: article.trim() };
        }
        return { article: null, mainWord: german, genderClass: 'das' };
    }
    formatGermanWord(word) {
        const parsed = this.parseGermanWord(word);
        const articleClass = this.state.showArticles ? '' : 'hide-articles';
        const mainWordHtml = parsed.mainWord;
        const articleHtml = parsed.article ? `<span class="article ${parsed.genderClass}">${parsed.article}</span>` : '';
        return `<div class="word ${parsed.genderClass} ${articleClass}">${articleHtml}<span class="main-word">${mainWordHtml}</span></div>`;
    }
    showNoWordsMessage(customMessage = '') {
        const msg = customMessage || (this.allWords && this.allWords.length > 0
            ? 'Нет слов для выбранных фильтров.<br>Попробуйте изменить уровень или тему.'
            : 'Загрузка словаря...');
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${msg}</p></div>`;
        this.setState({ currentWord: null });
    }
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