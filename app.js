// app.js

const APP_VERSION = '1.2';
const delay = ms => new Promise(res => setTimeout(res, ms));

class VocabularyApp {
    constructor() {
        this.appVersion = APP_VERSION;
        this.allWords = [];
        this.currentWord = null;
        this.isAutoPlaying = false;
        this.wordHistory = [];
        this.currentHistoryIndex = -1;
        this.sequenceController = null;
        this.isReady = false;

        this.ttsApiBaseUrl = 'https://deutsch-lernen-je9i.onrender.com';
        this.audioPlayer = document.getElementById('audioPlayer');

        this.loadStateFromLocalStorage();
        this.runMigrations();

        const today = new Date().toDateString();
        if (this.lastStudyDate !== today) {
            this.studiedToday = 0;
            this.lastStudyDate = today;
            localStorage.setItem('lastStudyDate', today);
            localStorage.setItem('studiedToday', '0');
        }
    }

    runMigrations() {
        // ... без изменений ...
        const savedVersion = localStorage.getItem('appVersion') || '1.0';
        const parseVersion = (v) => parseFloat(v) || 0;
        const currentVersion = parseVersion(this.appVersion);
        const storedVersion = parseVersion(savedVersion);

        if (storedVersion < currentVersion) {
            console.log(`🔄 Миграция настроек: ${savedVersion} → ${this.appVersion}`);
            if (storedVersion < 1.1) {
                if (!this.selectedLevels || this.selectedLevels.length === 0 || (this.selectedLevels.length === 1 && this.selectedLevels[0] === 'B1')) {
                    this.selectedLevels = ['A1', 'A2', 'B1', 'B2'];
                }
            }
            this.saveStateToLocalStorage();
            console.log('✅ Миграция завершена');
        }
    }

    async init() {
        this.setPlayButtonState('loading'); // Включаем анимацию загрузки
        this.setupIcons();
        this.bindEvents();
        await this.loadVocabulary();

        this.isReady = true;

        this.handleFilterChange(true); // Первый запуск, без анимации смены карточки
    }

    // ИЗМЕНЕНИЕ: Полностью новая логика управления кнопкой
    setPlayButtonState(state) { // 'loading', 'loaded', 'playing', 'disabled'
        const buttons = document.querySelectorAll('.play-pause');
        buttons.forEach(btn => {
            btn.classList.remove('loading', 'loaded', 'playing', 'is-disabled');

            switch (state) {
                case 'loading':
                    btn.classList.add('loading', 'is-disabled');
                    break;
                case 'loaded':
                    btn.classList.add('loaded');
                    break;
                case 'playing':
                    btn.classList.add('loaded', 'playing');
                    break;
                case 'disabled':
                    btn.classList.add('loaded', 'is-disabled');
                    break;
            }
        });
    }

    startAutoPlay() {
        if (!this.isReady || this.isAutoPlaying || !this.currentWord) return;

        this.isAutoPlaying = true;
        this.saveStateToLocalStorage();
        this.setPlayButtonState('playing');

        this.runDisplaySequence(this.currentWord);
    }

    stopAutoPlay() {
        this.isAutoPlaying = false;
        this.saveStateToLocalStorage();
        if (this.sequenceController) {
            this.sequenceController.abort();
        }
        this.setPlayButtonState(this.getActiveWords().length > 0 ? 'loaded' : 'disabled');
    }

    toggleAutoPlay() {
        if (this.isAutoPlaying) {
            this.stopAutoPlay();
        } else {
            this.startAutoPlay();
        }
    }

    async runDisplaySequence(word, isFirstRun = false) {
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
        const checkAborted = () => { if (signal.aborted) throw new DOMException('Sequence aborted', 'AbortError'); };

        try {
            this.currentWord = word;
            this.addToHistory(word);

            const studyArea = document.getElementById('studyArea');
            if (!isFirstRun) {
                studyArea.classList.add('fading');
                await delay(200); checkAborted();
            }

            this.renderInitialCard(word);

            if (!isFirstRun) {
                studyArea.classList.remove('fading');
            }

            const repeats = this.repeatMode === 'random' ? 1 : parseInt(this.repeatMode, 10);
            for (let i = 0; i < repeats; i++) {
                await delay(i === 0 ? 500 : 1500); checkAborted();
                await this.speakGerman(this.currentWord.german); checkAborted();
            }
            await delay(1500); checkAborted();
            this.displayMorphemesAndTranslations();
            await delay(2500); checkAborted();
            this.displaySentence();
            if (this.showSentences && this.currentWord.sentence) {
                await this.speakSentence(this.currentWord.sentence); checkAborted();
            }
            await delay(1500); checkAborted();
            this.displayFinalTranslation();
            await this.speakRussian(this.currentWord.russian); checkAborted();

            if (this.isAutoPlaying) {
                await delay(2000); checkAborted();
                const nextWord = this.getNextWord();
                this.runDisplaySequence(nextWord);
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('▶️ Последовательность корректно остановлена.');
                this.renderInitialCard(this.currentWord);
            } else {
                console.error('Ошибка в последовательности воспроизведения:', error);
            }
        }
    }

    speak(text, lang) {
        return new Promise(async (resolve, reject) => {
            // ... speak logic remains the same ...
        });
    }

    async speakGerman(text) { if (this.soundEnabled) await this.speak(text, 'de'); }
    async speakRussian(text) { if (this.translationSoundEnabled) await this.speak(text, 'ru'); }
    async speakSentence(text) { if (this.sentenceSoundEnabled) await this.speak(text, 'de'); }

    ensureWordIds(words) { words.forEach((w, i) => { if (!w.id) w.id = `word_${Date.now()}_${i}`; }); return words; }

    async loadVocabulary() {
        // ... loadVocabulary logic remains the same ...
    }

    loadStateFromLocalStorage() {
        // ... loadStateFromLocalStorage logic remains the same ...
    }

    saveStateToLocalStorage() {
        // ... saveStateToLocalStorage logic remains the same ...
    }

    saveWordsToLocalStorage() { if (this.allWords.length > 0) localStorage.setItem('germanWords', JSON.stringify(this.allWords)); }

    // ИЗМЕНЕНИЕ: Исправлена логика для корректной работы
    handleFilterChange(isFirstRun = false) {
        this.stopAutoPlay();
        this.currentWord = null;
        this.wordHistory = [];
        this.currentHistoryIndex = -1;

        const newWord = this.getNextWord();
        if (newWord) {
            this.currentWord = newWord;
            this.addToHistory(this.currentWord);
            this.renderInitialCard(this.currentWord, isFirstRun);
        } else {
            this.showNoWordsMessage();
        }
        this.updateUI();
    }

    addToHistory(word) {
        if (!word) return;
        const lastWordInHistory = this.wordHistory[this.wordHistory.length - 1];
        if (lastWordInHistory && lastWordInHistory.id === word.id) return;

        if (this.currentHistoryIndex < this.wordHistory.length - 1) {
            this.wordHistory.splice(this.currentHistoryIndex + 1);
        }

        this.wordHistory.push(word);
        if (this.wordHistory.length > 50) {
            this.wordHistory.shift();
        }
        this.currentHistoryIndex = this.wordHistory.length - 1;

        this.updateNavigationButtons();
    }

    showPreviousWord() {
        if (!this.isReady || this.currentHistoryIndex <= 0) return;
        this.currentHistoryIndex--;
        const newWord = this.wordHistory[this.currentHistoryIndex];
        this.runDisplaySequence(newWord);
    }

    showNextWordManually() {
        if (!this.isReady) return;
        let newWord;
        if (this.currentHistoryIndex < this.wordHistory.length - 1) {
            this.currentHistoryIndex++;
            newWord = this.wordHistory[this.currentHistoryIndex];
        } else {
            newWord = this.getNextWord();
        }
        if (newWord) this.runDisplaySequence(newWord);
    }

    renderInitialCard(word, isFirstRun = false) {
        const studyArea = document.getElementById('studyArea');
        studyArea.innerHTML = `<div class="card" id="wordCard" data-word-id="${word.id}"><div class="level-indicator ${word.level.toLowerCase()}">${word.level}</div><div class="word-container">${this.formatGermanWord(word)}<div class="pronunciation">${word.pronunciation || ''}</div><div id="translationContainer" class="translation-container"></div><div id="morphemeTranslations" class="morpheme-translations"></div><div id="sentenceContainer" class="sentence-container"></div></div></div>`;
        if (isFirstRun) {
            studyArea.classList.remove('fading');
        }
        document.getElementById('wordCard')?.addEventListener('click', () => this.toggleAutoPlay());
    }

    displayMorphemesAndTranslations(isDirect = false) { /* ... без изменений ... */ }
    displaySentence() { /* ... без изменений ... */ }
    displayFinalTranslation(withAnimation = true) { /* ... без изменений ... */ }

    updateUI() {
        if (!this.isReady) return;
        this.updateStats();
        this.updateLevelButtons();
        this.updateThemeButtons();
        this.updateRepeatControlsState();
        this.updateControlButtons();
        this.updateNavigationButtons();
        this.stopAutoPlay(); // Это установит правильное состояние кнопки (loaded/disabled)
    }

    updateControlButtons() { /* ... без изменений ... */ }
    updateNavigationButtons() { /* ... без изменений ... */ }
    updateStats() { /* ... без изменений ... */ }
    updateLevelButtons() { /* ... без изменений ... */ }
    updateThemeButtons() { /* ... без изменений ... */ }
    updateRepeatControlsState() { /* ... без изменений ... */ }
    bindEvents() { /* ... без изменений ... */ }

    setupIcons() {
        const iconMap = { 'prevButton': '#icon-prev', 'nextButton': '#icon-next', 'settingsButton': '#icon-settings' };
        Object.keys(iconMap).forEach(key => {
            document.querySelectorAll(`[id^=${key}]`).forEach(btn => {
                btn.innerHTML = `<svg class="icon"><use xlink:href="${iconMap[key]}"></use></svg>`;
            });
        });
        document.querySelectorAll('[id^=soundToggle]').forEach(btn => btn.innerHTML = `<svg class="icon"><use xlink:href="#icon-sound-on"></use></svg>`);
        document.querySelectorAll('[id^=translationSoundToggle]').forEach(btn => btn.innerHTML = `<svg class="icon"><use xlink:href="#icon-chat-on"></use></svg>`);
        document.querySelectorAll('[id^=sentenceSoundToggle]').forEach(btn => btn.innerHTML = `<svg class="icon"><use xlink:href="#icon-sentence-on"></use></svg>`);
    }

    // ... остальной код (toggleSettingsPanel и т.д.) без изменений ...
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new VocabularyApp();
        app.init();
        window.app = app;
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        document.body.innerHTML = `<div style="text-align:center;padding:50px;"><h1>Произошла ошибка</h1><p>Попробуйте очистить кэш браузера.</p></div>`;
    }
});