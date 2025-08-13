// app.js - Final Version 2.4 (Simple & Robust Play/Pause Logic)

"use strict";

// --- КОНФИГУРАЦИЯ И КОНСТАНТЫ ---
const APP_VERSION = '1.7';
const TTS_API_BASE_URL = 'https://deutsch-lernen-0qxe.onrender.com';

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
        this.wordHistory = [];
        this.currentHistoryIndex = -1;
        this.sequenceController = null;
        this.audioPlayer = document.getElementById('audioPlayer');

        this.state = {
            isAutoPlaying: false,
            currentWord: null,
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
        };

        this.elements = {
            studyArea: document.getElementById('studyArea'),
            totalWords: document.getElementById('totalWords'),
            studiedToday: document.getElementById('studiedToday'),
            settingsPanel: document.getElementById('settings-panel'),
            settingsOverlay: document.getElementById('settings-overlay'),
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
        await this.loadVocabulary();
        this.bindEvents();
        this.updateUI();

        if (this.getActiveWords().length === 0) {
            this.showNoWordsMessage();
            return;
        }

        const wordToStart = this.getNextWord();
        if (wordToStart) {
            this.setState({ currentWord: wordToStart });
            this.renderInitialCard(this.state.currentWord);
            this.addToHistory(this.state.currentWord);
        }
    }

    /**
     * ✅ НОВАЯ ЛОГИКА: Запускает последовательность для текущего слова.
     */
    startAutoPlay() {
        if (this.state.isAutoPlaying) return;
        const wordToShow = this.state.currentWord || this.getNextWord();
        if (wordToShow) {
            this.setState({ isAutoPlaying: true, currentWord: wordToShow });
            this.runDisplaySequence(wordToShow);
        }
    }

    /**
     * ✅ НОВАЯ ЛОГИКА: Надежно останавливает все.
     */
    stopAutoPlay() {
        if (this.sequenceController) {
            this.sequenceController.abort(); // Отменяем все задержки и fetch
        }
        this.audioPlayer.pause(); // На всякий случай останавливаем звук
        this.audioPlayer.src = ''; // и сбрасываем источник
        this.setState({ isAutoPlaying: false });
    }

    /**
     * ✅ НОВАЯ ЛОГИКА: Простое и понятное переключение.
     */
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

        if (this.sequenceController) this.sequenceController.abort();
        this.sequenceController = new AbortController();
        const { signal } = this.sequenceController;

        try {
            const checkAborted = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };

            await this._fadeInNewCard(word, checkAborted);
            if (!this.state.isAutoPlaying) return;

            await this._playGermanPhase(checkAborted);
            await this._revealMorphemesPhase(checkAborted);
            await this._playSentencePhase(checkAborted);
            await this._revealTranslationPhase(checkAborted);

            if (this.state.isAutoPlaying) {
                await this._prepareNextWord(checkAborted);
                const nextWord = this.getNextWord();
                this.setState({ currentWord: nextWord });
                this.runDisplaySequence(nextWord);
            }
        } catch (error) {
            if (error.name !== 'AbortError') console.error('Ошибка в последовательности воспроизведения:', error);
        }
    }

    async _fadeInNewCard(word, checkAborted) {
        // ... (без изменений) ...
    }
    async _playGermanPhase(checkAborted) {
        // ... (без изменений) ...
    }
    async _revealMorphemesPhase(checkAborted) {
        // ... (без изменений) ...
    }
    async _playSentencePhase(checkAborted) {
        // ... (без изменений) ...
    }
    async _revealTranslationPhase(checkAborted) {
        // ... (без изменений) ...
    }
    async _prepareNextWord(checkAborted) {
        // ... (без изменений) ...
    }

    /**
     * ✅ НОВАЯ ЛОГИКА: Упрощенная и более надежная обработка.
     */
    speak(text, lang) {
        return new Promise(async (resolve, reject) => {
            if (!text || this.sequenceController?.signal.aborted) return resolve();

            const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
            this.sequenceController?.signal.addEventListener('abort', onAbort, { once: true });

            try {
                const apiUrl = `${TTS_API_BASE_URL}/synthesize?lang=${lang}&text=${encodeURIComponent(text)}`;
                const response = await fetch(apiUrl, { signal: this.sequenceController?.signal });
                if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
                const data = await response.json();
                if (!data.url) throw new Error('Invalid server response');
                if (this.sequenceController?.signal.aborted) return; // Проверка после асинхронной операции

                this.audioPlayer.src = `${TTS_API_BASE_URL}${data.url}`;

                const onEnded = () => resolve();
                const onError = (e) => { console.error("Audio error", e); resolve(); }; // Не прерываем все, просто идем дальше

                this.audioPlayer.addEventListener('ended', onEnded, { once: true });
                this.audioPlayer.addEventListener('error', onError, { once: true });

                await this.audioPlayer.play();

            } catch (error) {
                if (error.name !== 'AbortError') console.error('Speak method error:', error);
                resolve(); // Всегда разрешаем, чтобы не ломать цепочку
            } finally {
                this.sequenceController?.signal.removeEventListener('abort', onAbort);
            }
        });
    }

    // --- ОСТАЛЬНАЯ ЧАСТЬ КОДА ОСТАЕТСЯ БЕЗ ИЗМЕНЕНИЙ ---
    // Я привожу ее полностью для вашего удобства

    async speakGerman(text) { if (this.state.soundEnabled) await this.speak(text, 'de'); }
    async speakRussian(text) { if (this.state.translationSoundEnabled) await this.speak(text, 'ru'); }
    async speakSentence(text) { if (this.state.sentenceSoundEnabled) await this.speak(text, 'de'); }

    toggleSetting(key) {
        let newState = { [key]: !this.state[key] };
        if (key === 'showMorphemes' && !newState[key]) {
            newState.showMorphemeTranslations = false;
        }
        this.setState(newState);
        const card = document.getElementById('wordCard');
        if (!card) return;
        switch (key) {
            case 'showArticles':
                card.querySelector('.word')?.classList.toggle('hide-articles', !newState[key]);
                break;
            case 'showMorphemes':
            case 'showMorphemeTranslations':
                this.displayMorphemesAndTranslations();
                break;
            case 'showSentences':
                this.displaySentence();
                break;
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
                if (!btn.querySelector('svg')) {
                    btn.innerHTML = `<svg class="icon"><use xlink:href="${href}"></use></svg>`;
                } else {
                    btn.querySelector('use').setAttribute('xlink:href', href);
                }
            });
        }
    }

    updateControlButtons() {
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
            if (btn.querySelector('use')) {
                btn.querySelector('use').setAttribute('xlink:href', this.state.isAutoPlaying ? '#icon-pause' : '#icon-play');
            }
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
    }

    runMigrations() {
        const savedVersion = localStorage.getItem('appVersion') || '1.0';
        const parseVersion = (v) => parseFloat(v) || 0;
        if (parseVersion(savedVersion) < parseVersion(this.appVersion)) {
            if (parseVersion(savedVersion) < 1.1) {
                if (!this.state.selectedLevels || this.state.selectedLevels.length <= 1) {
                    this.setState({ selectedLevels: ['A1', 'A2', 'B1', 'B2'] });
                }
            }
            localStorage.setItem('appVersion', this.appVersion);
        }
    }

    async loadVocabulary() {
        const loadFromLocalStorage = () => { try { const d = localStorage.getItem('germanWords'); return d ? JSON.parse(d) : null; } catch { return null; } };
        const loadFromJSON = async () => { try { const r = await fetch('vocabulary.json'); if (!r.ok) throw new Error(`Network response was not ok`); return await r.json(); } catch (e) { console.error('Ошибка загрузки словаря:', e); return []; } };
        let data = loadFromLocalStorage();
        if (!data || data.length === 0) { data = await loadFromJSON(); }
        this.allWords = data.map((w, i) => ({ ...w, id: w.id || `word_${Date.now()}_${i}` }));
        if (this.allWords.length > 0) localStorage.setItem('germanWords', JSON.stringify(this.allWords));
    }

    handleFilterChange() {
        this.stopAutoPlay();
        const nextWord = this.getNextWord();
        this.wordHistory = [];
        this.currentHistoryIndex = -1;
        this.setState({ currentWord: nextWord });
        if (nextWord) {
            this.renderInitialCard(nextWord);
            this.addToHistory(nextWord);
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
        this.setState({ currentWord: word });
        if (wasAutoPlaying) this.startAutoPlay(); else this.renderInitialCard(word);
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
            if (nextWord) this.addToHistory(nextWord);
        }
        this.setState({ currentWord: nextWord });
        if (wasAutoPlaying) this.startAutoPlay(); else this.renderInitialCard(nextWord);
    }

    renderInitialCard(word) {
        if (!word) { this.showNoWordsMessage(); return; }
        this.elements.studyArea.innerHTML = `<div class="card card-appear" id="wordCard"><div class="level-indicator ${word.level.toLowerCase()}">${word.level}</div><div class="word-container">${this.formatGermanWord(word)}<div class="pronunciation">${word.pronunciation || ''}</div><div id="translationContainer" class="translation-container"></div><div id="morphemeTranslations" class="morpheme-translations"></div><div id="sentenceContainer" class="sentence-container"></div></div></div>`;
        document.getElementById('wordCard')?.addEventListener('click', () => this.toggleAutoPlay());
        this.updateUI();
    }

    displayMorphemesAndTranslations() {
        const { currentWord, showMorphemes, showMorphemeTranslations } = this.state;
        const mainWordElement = document.querySelector('.word .main-word');
        const translationsContainer = document.getElementById('morphemeTranslations');
        const wordElement = document.querySelector('.word');
        if (!mainWordElement || !translationsContainer || !wordElement || !currentWord) return;
        const parsed = this.parseGermanWord(currentWord);
        wordElement.classList.remove('show-morphemes');
        translationsContainer.classList.remove('visible');
        translationsContainer.innerHTML = '';
        mainWordElement.innerHTML = `<span class="morpheme">${parsed.mainWord}</span>`;
        if (currentWord.morphemes) {
            if (showMorphemes) {
                const separatorHTML = `<span class="morpheme-separator"><span class="morpheme-separator-desktop">-</span><span class="morpheme-separator-mobile">|</span></span>`;
                mainWordElement.innerHTML = currentWord.morphemes.map(item => `<span class="morpheme">${item.m || ''}</span>`).join(separatorHTML);
                wordElement.classList.add('show-morphemes');
            }
            if (showMorphemes && showMorphemeTranslations) {
                translationsContainer.innerHTML = currentWord.morphemes.map(item => `<div class="morpheme-translation-item"><span class="morpheme-part">${item.m || ''}</span><span class="translation-part">${item.t || '?'}</span></div>`).join('');
                translationsContainer.classList.add('visible');
            }
        }
    }

    displaySentence() {
        const { currentWord, showSentences } = this.state;
        const container = document.getElementById('sentenceContainer');
        if (!container || !currentWord) return;
        if (showSentences && currentWord.sentence) {
            container.innerHTML = `<div class="sentence">${currentWord.sentence}<div class="sentence-translation">${currentWord.sentence_ru}</div></div>`;
        } else {
            container.innerHTML = '';
        }
    }

    displayFinalTranslation(withAnimation = true) {
        const card = document.getElementById('wordCard');
        if (!card) return;
        card.classList.remove('sentence-phase');
        card.classList.add('final-phase');
        const translationContainer = document.getElementById('translationContainer');
        if (translationContainer) {
            translationContainer.innerHTML = `<div class="translation ${withAnimation ? 'translation-appear' : ''}">${this.state.currentWord.russian}</div>`;
        }
    }

    updateStats() {
        if (this.elements.totalWords) this.elements.totalWords.textContent = this.getActiveWords().length;
        if (this.elements.studiedToday) this.elements.studiedToday.textContent = this.state.studiedToday;
    }

    updateNavigationButtons() {
        document.querySelectorAll('[id^=prevButton]').forEach(btn => btn.disabled = this.currentHistoryIndex <= 0);
        const hasNext = this.currentHistoryIndex < this.wordHistory.length - 1 || this.getActiveWords().length > this.wordHistory.length;
        document.querySelectorAll('[id^=nextButton]').forEach(btn => btn.disabled = !hasNext);
    }

    updateLevelButtons() { document.querySelectorAll('.level-btn').forEach(b => b.classList.toggle('active', this.state.selectedLevels.includes(b.dataset.level))); }
    updateThemeButtons() { document.querySelectorAll('.block-btn[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === this.state.selectedTheme)); }
    updateRepeatControlsState() {
        document.querySelectorAll('[data-mode]').forEach(button => {
            button.classList.toggle('active', button.dataset.mode === this.state.repeatMode);
        });
        const hintElement = document.getElementById('repeat-mode-hint');
        if (hintElement) {
            hintElement.style.display = this.state.repeatMode === 'random' ? 'block' : 'none';
        }
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
        document.querySelectorAll('.block-btn[data-theme]').forEach(btn => btn.addEventListener('click', e => this.setTheme(e.target.dataset.theme)));
        document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', e => this.setRepeatMode(e.target.dataset.mode)));
        document.querySelectorAll('[id^=reloadDefaultWords]').forEach(b => b.addEventListener('click', () => this.reloadDefaultWords()));
        document.querySelectorAll('[id^=exportWords]').forEach(b => b.addEventListener('click', () => this.exportWords()));
        document.querySelectorAll('[id^=importWords]').forEach(b => b.addEventListener('click', () => b.nextElementSibling.click()));
        document.querySelectorAll('input[type=file]').forEach(i => i.addEventListener('change', e => this.importWords(e)));
    }

    toggleSettingsPanel(show) {
        this.elements.settingsPanel.classList.toggle('visible', show);
        this.elements.settingsOverlay.classList.toggle('visible', show);
    }

    toggleLevel(level) {
        const { selectedLevels } = this.state;
        const newLevels = selectedLevels.includes(level)
            ? (selectedLevels.length > 1 ? selectedLevels.filter(l => l !== level) : selectedLevels)
            : [...selectedLevels, level];
        this.setState({ selectedLevels: newLevels });
        this.handleFilterChange();
    }

    setTheme(theme) {
        this.setState({ selectedTheme: theme });
        this.handleFilterChange();
    }

    setRepeatMode(mode) { this.setState({ repeatMode: mode }); }

    reloadDefaultWords() { if (confirm('Сбросить прогресс и загрузить стандартный словарь?')) { localStorage.clear(); window.location.reload(); } }

    exportWords() {
        if (this.allWords.length === 0) return alert("Словарь пуст.");
        const blob = new Blob([JSON.stringify(this.allWords, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `german-vocabulary.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    importWords(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if (!Array.isArray(imported)) throw new Error('Неверный формат файла.');
                this.stopAutoPlay();
                this.allWords = imported.map((w, i) => ({ ...w, id: w.id || `word_${Date.now()}_${i}` }));
                localStorage.setItem('germanWords', JSON.stringify(this.allWords));
                this.handleFilterChange();
                alert(`Импорт завершен: ${imported.length} слов.`);
            } catch (err) { alert('Ошибка чтения файла: ' + err.message); }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

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
        const currentIndex = activeWords.findIndex(w => w.id === currentId);
        return activeWords[(currentIndex + 1) % activeWords.length];
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

    showNoWordsMessage() {
        const msg = this.allWords && this.allWords.length > 0
            ? 'Нет слов для выбранных фильтров.<br>Попробуйте изменить уровень или тему.'
            : 'Загружаю словарь...';
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${msg}</p></div>`;
    }

    showMessage(text) {
        const statusDiv = document.getElementById('levelStatus');
        if (statusDiv) {
            statusDiv.textContent = text;
            statusDiv.style.display = 'block';
            setTimeout(() => { statusDiv.style.display = 'none'; }, 3000);
        }
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