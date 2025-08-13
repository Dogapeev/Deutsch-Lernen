// app.js - Final Version 3.0 (Server-Side Vocabulary & Dynamic UI)

"use strict";

// --- КОНФИГУРАЦИЯ И КОНСТАНТЫ ---
const APP_VERSION = '3.0'; // Обновляем версию
const API_BASE_URL = 'https://deutsch-lernen-0qxe.onrender.com';

const DELAYS = {
    INITIAL_WORD: 500,
    BETWEEN_REPEATS: 1500,
    BEFORE_MORPHEMES: 1500,
    BEFORE_SENTENCE: 2500,
    BEFORE_TRANSLATION: 1500,
    BEFORE_NEXT_WORD: 2000,
    CARD_FADE_OUT: 750,
    CARD_FADE_IN: 300
};

const delay = ms => new Promise(res => setTimeout(res, ms));

class VocabularyApp {
    constructor() {
        this.appVersion = APP_VERSION;
        this.allWords = [];
        this.availableVocabularies = {};
        this.wordHistory = [];
        this.currentHistoryIndex = -1;
        this.sequenceController = null;
        this.audioPlayer = document.getElementById('audioPlayer');

        this.state = {
            isAutoPlaying: false,
            currentWord: null,
            currentPhase: 'initial',
            studiedToday: 0,
            lastStudyDate: null,
            soundEnabled: true,
            translationSoundEnabled: true,
            sentenceSoundEnabled: true,
            repeatMode: '2',
            selectedLevels: ['A1', 'A2', 'B1', 'B2'],
            selectedTheme: 'all',
            showArticles: true,
            showMorphemes: true,
            showMorphemeTranslations: true,
            showSentences: true,
            selectedVocabulary: null, // Имя текущего словаря
        };

        this.elements = {
            studyArea: document.getElementById('studyArea'),
            totalWords: document.getElementById('totalWords'),
            studiedToday: document.getElementById('studiedToday'),
            settingsPanel: document.getElementById('settings-panel'),
            settingsOverlay: document.getElementById('settings-overlay'),
            vocabularySelectorPanel: document.getElementById('vocabulary-selector-panel'),
            vocabularySelectorOverlay: document.getElementById('vocabulary-selector-overlay'),
            vocabularyList: document.getElementById('vocabularyList'),
            themeButtonsContainer: document.getElementById('themeButtonsContainer'),
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
        try {
            const response = await fetch(`${API_BASE_URL}/vocabularies/list`);
            if (!response.ok) throw new Error('Не удалось получить список словарей.');
            this.availableVocabularies = await response.json();

            // Определяем, какой словарь загружать
            const vocabToLoad = this.state.selectedVocabulary && this.availableVocabularies[this.state.selectedVocabulary]
                ? this.state.selectedVocabulary
                : Object.keys(this.availableVocabularies)[0];

            if (vocabToLoad) {
                await this.switchVocabulary(vocabToLoad);
            } else {
                this.showNoWordsMessage('На сервере нет доступных словарей.');
            }

        } catch (error) {
            console.error("Ошибка инициализации:", error);
            this.showNoWordsMessage('Ошибка подключения к серверу. Попробуйте обновить страницу.');
        } finally {
            this.bindEvents();
            this.updateUI();
        }
    }

    async switchVocabulary(vocabName) {
        this.stopAutoPlay();
        this.showNoWordsMessage('Загрузка словаря...');

        try {
            const response = await fetch(`${API_BASE_URL}/vocabularies/get/${vocabName}`);
            if (!response.ok) throw new Error(`Не удалось загрузить словарь: ${vocabName}`);
            const words = await response.json();

            this.allWords = words.map((w, i) => ({ ...w, id: w.id || `word_${Date.now()}_${i}` }));

            // Сброс и обновление состояния
            this.wordHistory = [];
            this.currentHistoryIndex = -1;

            this.updateDynamicThemes();
            this.updateDynamicLevels(); // Важно вызвать до сброса фильтров

            // Сбрасываем фильтры на значения по умолчанию
            const availableLevels = new Set(this.allWords.map(w => w.level));
            const defaultLevels = Array.from(availableLevels);

            this.setState({
                selectedVocabulary: vocabName,
                selectedTheme: 'all',
                selectedLevels: defaultLevels.length > 0 ? defaultLevels : ['A1']
            });

            this.handleFilterChange(); // Запустит отображение первого слова
            this.toggleVocabularySelector(false); // Закрыть окно выбора, если оно было открыто

        } catch (error) {
            console.error("Ошибка смены словаря:", error);
            this.showNoWordsMessage(`Не удалось загрузить словарь "${vocabName}".`);
        }
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
        const repeats = this.state.repeatMode === 'random' ? 1 : parseInt(this.state.repeatMode, 10);
        for (let i = 0; i < repeats; i++) {
            await delay(i === 0 ? DELAYS.INITIAL_WORD : DELAYS.BETWEEN_REPEATS);
            checkAborted();
            await this.speakGerman(word.german);
            checkAborted();
        }
    }

    async _revealMorphemesPhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_MORPHEMES);
        checkAborted();
        this.displayMorphemesAndTranslations(word);
    }

    async _playSentencePhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_SENTENCE);
        checkAborted();
        this.displaySentence(word);
        if (this.state.showSentences && word.sentence) {
            await this.speakSentence(word.sentence);
            checkAborted();
        }
    }

    async _revealTranslationPhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_TRANSLATION);
        checkAborted();
        this.displayFinalTranslation(word);
        await this.speakRussian(word.russian);
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

    speak(text, lang) {
        return new Promise(async (resolve, reject) => {
            if (!text || (this.sequenceController && this.sequenceController.signal.aborted)) {
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
                const apiUrl = `${API_BASE_URL}/synthesize?lang=${lang}&text=${encodeURIComponent(text)}`;
                const response = await fetch(apiUrl, { signal: this.sequenceController?.signal });
                if (!response.ok) throw new Error(`TTS server error: ${response.statusText}`);
                const data = await response.json();
                if (!data.url) throw new Error('Invalid response from TTS server');
                if (this.sequenceController?.signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));

                this.audioPlayer.src = `${API_BASE_URL}${data.url}`;
                this.audioPlayer.addEventListener('ended', onFinish, { once: true });
                this.audioPlayer.addEventListener('error', onFinish, { once: true });
                this.sequenceController?.signal.addEventListener('abort', onAbort, { once: true });

                await this.audioPlayer.play();
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Ошибка в методе speak:', error);
                }
                onFinish();
            }
        });
    }

    async speakGerman(text) { if (this.state.soundEnabled) await this.speak(text, 'de'); }
    async speakRussian(text) { if (this.state.translationSoundEnabled) await this.speak(text, 'ru'); }
    async speakSentence(text) { if (this.state.sentenceSoundEnabled) await this.speak(text, 'de'); }

    toggleSetting(key) {
        const wasAutoPlaying = this.state.isAutoPlaying;
        this.stopAutoPlay();

        let newState = { [key]: !this.state[key] };
        if (key === 'showMorphemes' && !newState[key]) {
            newState.showMorphemeTranslations = false;
        }
        this.setState(newState);

        if (!document.getElementById('wordCard')) return;

        const currentWord = this.state.currentWord;
        if (currentWord) {
            this.runDisplaySequence(currentWord);
        }

        if (wasAutoPlaying) {
            this.startAutoPlay();
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
        this.state.repeatMode = safeJsonParse('repeatMode', '2');
        this.state.selectedLevels = safeJsonParse('selectedLevels', ['A1', 'A2', 'B1', 'B2']);
        this.state.selectedTheme = localStorage.getItem('selectedTheme') || 'all';
        this.state.showArticles = safeJsonParse('showArticles', true);
        this.state.showMorphemes = safeJsonParse('showMorphemes', true);
        this.state.showMorphemeTranslations = safeJsonParse('showMorphemeTranslations', true);
        this.state.showSentences = safeJsonParse('showSentences', true);
        this.state.selectedVocabulary = localStorage.getItem('selectedVocabulary') || null;
    }

    saveStateToLocalStorage() {
        localStorage.setItem('appVersion', this.appVersion);
        localStorage.setItem('lastStudyDate', this.state.lastStudyDate);
        localStorage.setItem('studiedToday', this.state.studiedToday);
        localStorage.setItem('soundEnabled', JSON.stringify(this.state.soundEnabled));
        localStorage.setItem('translationSoundEnabled', JSON.stringify(this.state.translationSoundEnabled));
        localStorage.setItem('sentenceSoundEnabled', JSON.stringify(this.state.sentenceSoundEnabled));
        localStorage.setItem('repeatMode', JSON.stringify(this.state.repeatMode));
        localStorage.setItem('selectedLevels', JSON.stringify(this.state.selectedLevels));
        localStorage.setItem('selectedTheme', this.state.selectedTheme);
        localStorage.setItem('showArticles', JSON.stringify(this.state.showArticles));
        localStorage.setItem('showMorphemes', JSON.stringify(this.state.showMorphemes));
        localStorage.setItem('showMorphemeTranslations', JSON.stringify(this.state.showMorphemeTranslations));
        localStorage.setItem('showSentences', JSON.stringify(this.state.showSentences));
        if (this.state.selectedVocabulary) {
            localStorage.setItem('selectedVocabulary', this.state.selectedVocabulary);
        }
    }

    runMigrations() {
        const savedVersion = localStorage.getItem('appVersion') || '1.0';
        if (parseFloat(savedVersion) < 3.0) {
            // Удаляем старый кеш слов, так как теперь они на сервере
            localStorage.removeItem('germanWords');
            localStorage.setItem('appVersion', this.appVersion);
        }
    }

    handleFilterChange() {
        this.stopAutoPlay();
        const nextWord = this.getNextWord();
        this.wordHistory = [];
        this.currentHistoryIndex = -1;
        this.setState({ currentWord: nextWord, currentPhase: 'initial' });
        if (nextWord) {
            this.runDisplaySequence(nextWord);
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

        if (wasAutoPlaying) {
            this.startAutoPlay();
        }
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

        if (wasAutoPlaying) {
            this.startAutoPlay();
        }
    }

    renderInitialCard(word) {
        if (!word) { this.showNoWordsMessage(); return; }
        this.elements.studyArea.innerHTML = `<div class="card card-appear" id="wordCard"><div class="level-indicator ${word.level.toLowerCase()}">${word.level}</div><div class="word-container">${this.formatGermanWord(word)}<div class="pronunciation">${word.pronunciation || ''}</div><div id="translationContainer" class="translation-container"></div><div id="morphemeTranslations" class="morpheme-translations"></div><div id="sentenceContainer" class="sentence-container"></div></div></div>`;
        document.getElementById('wordCard')?.addEventListener('click', () => this.toggleAutoPlay());
        this.updateUI();
    }

    displayMorphemesAndTranslations(word) {
        const { showMorphemes, showMorphemeTranslations } = this.state;
        const mainWordElement = document.querySelector('.word .main-word');
        const translationsContainer = document.getElementById('morphemeTranslations');
        const wordElement = document.querySelector('.word');
        if (!mainWordElement || !translationsContainer || !wordElement || !word) return;

        const parsed = this.parseGermanWord(word);
        wordElement.classList.remove('show-morphemes');
        translationsContainer.classList.remove('visible');
        translationsContainer.innerHTML = '';
        mainWordElement.innerHTML = `<span class="morpheme">${parsed.mainWord}</span>`;

        if (word.morphemes) {
            if (showMorphemes) {
                const separatorHTML = `<span class="morpheme-separator"><span class="morpheme-separator-desktop">-</span><span class="morpheme-separator-mobile">|</span></span>`;
                mainWordElement.innerHTML = word.morphemes.map(item => `<span class="morpheme">${item.m || ''}</span>`).join(separatorHTML);
                wordElement.classList.add('show-morphemes');
            }
            if (showMorphemes && showMorphemeTranslations) {
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
        } else {
            container.innerHTML = '';
        }
    }

    displayFinalTranslation(word, withAnimation = true) {
        const card = document.getElementById('wordCard');
        if (!card || !word) return;
        card.classList.add('final-phase');
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
        const canGenerateNext = activeWords.length > 0 && (this.state.repeatMode === 'random' || currentIndexInActive < activeWords.length - 1 || currentIndexInActive === -1);

        document.querySelectorAll('[id^=nextButton]').forEach(btn => btn.disabled = !hasNextInHistory && !canGenerateNext);
    }

    updateLevelButtons() { document.querySelectorAll('.level-btn').forEach(b => b.classList.toggle('active', this.state.selectedLevels.includes(b.dataset.level))); }
    updateThemeButtons() { document.querySelectorAll('.block-btn[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === this.state.selectedTheme)); }
    updateRepeatControlsState() {
        document.querySelectorAll('[data-mode]').forEach(button => {
            button.classList.toggle('active', button.dataset.mode === this.state.repeatMode);
        });
    }

    bindEvents() {
        // Settings Panel
        document.getElementById('settingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(true));
        document.getElementById('closeSettingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(false));
        this.elements.settingsOverlay.addEventListener('click', () => this.toggleSettingsPanel(false));

        // Vocabulary Selector
        document.querySelectorAll('[id^=selectVocabularyButton]').forEach(b => b.addEventListener('click', () => this.toggleVocabularySelector(true)));
        document.getElementById('closeVocabularySelectorButton')?.addEventListener('click', () => this.toggleVocabularySelector(false));
        this.elements.vocabularySelectorOverlay.addEventListener('click', () => this.toggleVocabularySelector(false));

        // Player Controls
        document.querySelectorAll('[id^=toggleButton]').forEach(b => b.addEventListener('click', () => this.toggleAutoPlay()));
        document.querySelectorAll('[id^=prevButton]').forEach(b => b.addEventListener('click', () => this.showPreviousWord()));
        document.querySelectorAll('[id^=nextButton]').forEach(b => b.addEventListener('click', () => this.showNextWordManually()));

        // Option Toggles
        document.querySelectorAll('[id^=soundToggle]').forEach(b => b.addEventListener('click', () => this.toggleSetting('soundEnabled')));
        document.querySelectorAll('[id^=translationSoundToggle]').forEach(b => b.addEventListener('click', () => this.toggleSetting('translationSoundEnabled')));
        document.querySelectorAll('[id^=sentenceSoundToggle]').forEach(b => b.addEventListener('click', () => this.toggleSetting('sentenceSoundEnabled')));
        document.querySelectorAll('[id^=toggleArticles]').forEach(b => b.addEventListener('click', () => this.toggleSetting('showArticles')));
        document.querySelectorAll('[id^=toggleMorphemes]').forEach(b => b.addEventListener('click', () => this.toggleSetting('showMorphemes')));
        document.querySelectorAll('[id^=toggleMorphemeTranslations]').forEach(b => b.addEventListener('click', () => this.toggleSetting('showMorphemeTranslations')));
        document.querySelectorAll('[id^=toggleSentences]').forEach(b => b.addEventListener('click', () => this.toggleSetting('showSentences')));

        // Filters
        document.querySelectorAll('.level-btn').forEach(btn => btn.addEventListener('click', e => this.toggleLevel(e.target.dataset.level)));
        document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', e => this.setRepeatMode(e.target.dataset.mode)));

        // Initial binding for theme buttons is handled by updateDynamicThemes
    }

    toggleSettingsPanel(show) {
        this.elements.settingsPanel.classList.toggle('visible', show);
        this.elements.settingsOverlay.classList.toggle('visible', show);
    }

    toggleVocabularySelector(show) {
        this.elements.vocabularySelectorPanel.classList.toggle('visible', show);
        this.elements.vocabularySelectorOverlay.classList.toggle('visible', show);
        if (show) {
            this.renderVocabularySelector();
        }
    }

    renderVocabularySelector() {
        const list = this.elements.vocabularyList;
        if (!list || !this.availableVocabularies) return;
        list.innerHTML = '<li>Загрузка...</li>';

        const vocabs = Object.entries(this.availableVocabularies);
        if (vocabs.length === 0) {
            list.innerHTML = '<li>Словари не найдены.</li>';
            return;
        }

        list.innerHTML = '';
        vocabs.forEach(([name, meta]) => {
            const li = document.createElement('li');
            li.className = 'vocabulary-item';
            li.dataset.vocabName = name;
            li.innerHTML = `
                <span class="vocab-name">${name.replace('.json', '')}</span>
                <span class="vocab-meta">${meta.word_count} слов</span>
            `;
            if (name === this.state.selectedVocabulary) {
                li.classList.add('active');
            }
            li.addEventListener('click', () => this.switchVocabulary(name));
            list.appendChild(li);
        });
    }

    toggleLevel(level) {
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

    getActiveWords() {
        const { selectedLevels, selectedTheme } = this.state;
        if (!this.allWords) return [];
        return this.allWords.filter(w => w?.level && selectedLevels.includes(w.level) && (selectedTheme === 'all' || w.theme === selectedTheme));
    }

    getNextWord() {
        const activeWords = this.getActiveWords();
        if (activeWords.length === 0) return null;

        if (this.state.repeatMode === 'random') {
            return activeWords[Math.floor(Math.random() * activeWords.length)];
        }

        const currentId = this.state.currentWord?.id;
        if (!currentId) return activeWords[0];

        const currentIndex = activeWords.findIndex(w => w.id === currentId);
        if (currentIndex === -1) return activeWords[0];

        const nextIndex = (currentIndex + 1) % activeWords.length;
        return activeWords[nextIndex];
    }

    updateDynamicThemes() {
        const container = this.elements.themeButtonsContainer;
        if (!container) return;

        const themes = [...new Set(this.allWords.map(w => w.theme))].filter(Boolean).sort();
        container.innerHTML = '';

        // Add "All" button
        const allBtn = document.createElement('button');
        allBtn.className = 'block-btn active';
        allBtn.dataset.theme = 'all';
        allBtn.textContent = 'Все темы';
        allBtn.addEventListener('click', () => this.setTheme('all'));
        container.appendChild(allBtn);

        // Add theme-specific buttons
        themes.forEach(theme => {
            const themeBtn = document.createElement('button');
            themeBtn.className = 'block-btn';
            themeBtn.dataset.theme = theme;
            themeBtn.textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
            themeBtn.addEventListener('click', () => this.setTheme(theme));
            container.appendChild(themeBtn);
        });
    }

    updateDynamicLevels() {
        const availableLevels = new Set(this.allWords.map(w => w.level));

        document.querySelectorAll('.level-btn').forEach(btn => {
            const level = btn.dataset.level;
            if (availableLevels.has(level)) {
                btn.disabled = false;
                btn.classList.remove('disabled');
            } else {
                btn.disabled = true;
                btn.classList.add('disabled');
            }
        });

        // Ensure selectedLevels only contains available levels
        const newSelectedLevels = this.state.selectedLevels.filter(l => availableLevels.has(l));
        if (newSelectedLevels.length === 0 && availableLevels.size > 0) {
            // If no selected levels are available, select the first available one
            this.setState({ selectedLevels: [availableLevels.values().next().value] });
        } else if (newSelectedLevels.length !== this.state.selectedLevels.length) {
            this.setState({ selectedLevels: newSelectedLevels });
        }
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
        const mainWordHtml = `<span class="morpheme">${parsed.mainWord}</span>`;
        const articleHtml = parsed.article ? `<span class="article ${parsed.genderClass}">${parsed.article}</span>` : '';
        return `<div class="word ${parsed.genderClass} ${articleClass}">${articleHtml}<span class="main-word">${mainWordHtml}</span></div>`;
    }

    showNoWordsMessage(message = null) {
        const defaultMsg = this.allWords && this.allWords.length > 0
            ? 'Нет слов для выбранных фильтров.<br>Попробуйте изменить уровень или тему.'
            : 'Загружаю словари...';
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${message || defaultMsg}</p></div>`;
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