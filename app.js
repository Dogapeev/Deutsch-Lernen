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
        this.isReady = false; // Флаг готовности приложения

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
        const savedVersion = localStorage.getItem('appVersion') || '1.0';
        const parseVersion = (v) => parseFloat(v) || 0;
        const currentVersion = parseVersion(this.appVersion);
        const storedVersion = parseVersion(savedVersion);

        if (storedVersion < currentVersion) {
            console.log(`🔄 Миграция настроек: ${savedVersion} → ${this.appVersion}`);
            if (storedVersion < 1.1) {
                if (!this.selectedLevels || this.selectedLevels.length === 0 || (this.selectedLevels.length === 1 && this.selectedLevels[0] === 'B1')) {
                    this.selectedLevels = ['A1', 'A2', 'B1', 'B2'];
                    console.log('✅ Миграция: Расширены уровни до A1, A2, B1, B2');
                }
            }
            this.saveStateToLocalStorage();
            console.log('✅ Миграция завершена');
        }
    }

    async init() {
        this.setLoading(true); // Включаем анимацию загрузки и блокируем кнопку

        this.setupIcons();
        this.bindEvents();
        await this.loadVocabulary();

        if (this.getActiveWords().length === 0) {
            this.showNoWordsMessage();
        } else {
            const wordToStart = this.getNextWord();
            this.currentWord = wordToStart;
            this.addToHistory(this.currentWord);
            this.renderInitialCard(this.currentWord);
        }

        this.isReady = true;
        this.updateUI(); // Первое полное обновление UI
        this.setLoading(false); // Выключаем анимацию и разблокируем кнопку
    }

    setLoading(isLoading) {
        document.querySelectorAll('.play-pause').forEach(btn => {
            btn.classList.toggle('loading', isLoading);
            btn.classList.toggle('is-disabled', isLoading);
        });
    }

    startAutoPlay() {
        if (!this.isReady || this.isAutoPlaying || !this.currentWord) return;

        this.isAutoPlaying = true;
        this.saveStateToLocalStorage();
        this.updateToggleButton();

        this.runDisplaySequence(this.currentWord);
    }

    stopAutoPlay() {
        this.isAutoPlaying = false;
        this.saveStateToLocalStorage();
        if (this.sequenceController) {
            this.sequenceController.abort();
        }
        this.updateToggleButton();
    }

    toggleAutoPlay() {
        if (this.isAutoPlaying) {
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
        const checkAborted = () => { if (signal.aborted) throw new DOMException('Sequence aborted', 'AbortError'); };

        try {
            this.currentWord = word;
            this.addToHistory(word);

            const studyArea = document.getElementById('studyArea');
            const oldCard = document.getElementById('wordCard');
            const isSameWordOnCard = oldCard && oldCard.dataset.wordId === word.id;

            if (!isSameWordOnCard) {
                studyArea.classList.add('fading');
                await delay(200); checkAborted();
                this.renderInitialCard(word);
                studyArea.classList.remove('fading');
            } else {
                this.updateUI();
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
            if (!text || (this.sequenceController && this.sequenceController.signal.aborted)) {
                return resolve();
            }
            try {
                const apiUrl = `${this.ttsApiBaseUrl}/synthesize?lang=${lang}&text=${encodeURIComponent(text)}`;
                const response = await fetch(apiUrl, { signal: this.sequenceController.signal });
                if (!response.ok) throw new Error(`TTS server error: ${response.statusText}`);
                const data = await response.json();
                const audioUrl = `${this.ttsApiBaseUrl}${data.url}`;
                if (this.sequenceController.signal.aborted) return resolve();
                this.audioPlayer.src = audioUrl;
                const playPromise = this.audioPlayer.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        if (error.name === "NotAllowedError") {
                            console.warn("Воспроизведение заблокировано браузером.");
                            resolve();
                        } else {
                            console.error('Ошибка воспроизведения аудио:', error);
                            resolve();
                        }
                    });
                }
                const abortHandler = () => {
                    this.audioPlayer.pause();
                    this.audioPlayer.src = '';
                    cleanUp();
                    reject(new DOMException('Sequence aborted', 'AbortError'));
                };
                const endedHandler = () => { cleanUp(); resolve(); };
                const errorHandler = (e) => { console.error('Ошибка аудио элемента:', e); cleanUp(); resolve(); };
                const cleanUp = () => {
                    this.sequenceController.signal.removeEventListener('abort', abortHandler);
                    this.audioPlayer.removeEventListener('ended', endedHandler);
                    this.audioPlayer.removeEventListener('error', errorHandler);
                };
                this.sequenceController.signal.addEventListener('abort', abortHandler, { once: true });
                this.audioPlayer.addEventListener('ended', endedHandler, { once: true });
                this.audioPlayer.addEventListener('error', errorHandler, { once: true });
            } catch (error) {
                if (error.name !== 'AbortError') console.error('Ошибка получения аудио:', error);
                resolve();
            }
        });
    }

    async speakGerman(text) { if (this.soundEnabled) await this.speak(text, 'de'); }
    async speakRussian(text) { if (this.translationSoundEnabled) await this.speak(text, 'ru'); }
    async speakSentence(text) { if (this.sentenceSoundEnabled) await this.speak(text, 'de'); }

    ensureWordIds(words) { words.forEach((w, i) => { if (!w.id) w.id = `word_${Date.now()}_${i}`; }); return words; }

    async loadVocabulary() {
        const loadFromLocalStorage = () => { try { const d = localStorage.getItem('germanWords'); return d ? JSON.parse(d) : null; } catch { return null; } };
        const loadFromJSON = async () => { try { const r = await fetch('vocabulary.json'); if (!r.ok) throw new Error(`Network error`); return await r.json(); } catch (e) { console.error('Ошибка загрузки словаря:', e); return []; } };
        let data = loadFromLocalStorage();
        let msg = `Загружен сохраненный словарь`;
        if (!data || data.length === 0) { data = await loadFromJSON(); msg = `Загружен стандартный словарь`; }
        this.allWords = this.ensureWordIds(data);
        this.saveWordsToLocalStorage();
        this.showMessage(`${msg}: ${this.allWords.length} слов`);
    }

    loadStateFromLocalStorage() {
        const safeJsonParse = (k, d) => { try { const i = localStorage.getItem(k); return i ? JSON.parse(i) : d; } catch { return d; } };
        this.isAutoPlaying = safeJsonParse('isAutoPlaying', false);
        this.studiedToday = parseInt(localStorage.getItem('studiedToday')) || 0;
        this.lastStudyDate = localStorage.getItem('lastStudyDate');
        this.accuracy = safeJsonParse('accuracy', { correct: 0, total: 0 });
        this.soundEnabled = safeJsonParse('soundEnabled', true);
        this.translationSoundEnabled = safeJsonParse('translationSoundEnabled', true);
        this.sentenceSoundEnabled = safeJsonParse('sentenceSoundEnabled', true);
        this.repeatMode = safeJsonParse('repeatMode', '2');
        this.selectedLevels = safeJsonParse('selectedLevels', ['A1', 'A2', 'B1', 'B2']);
        this.selectedTheme = localStorage.getItem('selectedTheme') || 'all';
        this.showArticles = safeJsonParse('showArticles', true);
        this.showMorphemes = safeJsonParse('showMorphemes', true);
        this.showMorphemeTranslations = safeJsonParse('showMorphemeTranslations', true);
        this.showSentences = safeJsonParse('showSentences', true);
    }

    saveStateToLocalStorage() { localStorage.setItem('appVersion', this.appVersion); localStorage.setItem('isAutoPlaying', JSON.stringify(this.isAutoPlaying)); localStorage.setItem('studiedToday', this.studiedToday); localStorage.setItem('accuracy', JSON.stringify(this.accuracy)); localStorage.setItem('soundEnabled', JSON.stringify(this.soundEnabled)); localStorage.setItem('translationSoundEnabled', JSON.stringify(this.translationSoundEnabled)); localStorage.setItem('sentenceSoundEnabled', JSON.stringify(this.sentenceSoundEnabled)); localStorage.setItem('repeatMode', JSON.stringify(this.repeatMode)); localStorage.setItem('selectedLevels', JSON.stringify(this.selectedLevels)); localStorage.setItem('selectedTheme', this.selectedTheme); localStorage.setItem('showArticles', JSON.stringify(this.showArticles)); localStorage.setItem('showMorphemes', JSON.stringify(this.showMorphemes)); localStorage.setItem('showMorphemeTranslations', JSON.stringify(this.showMorphemeTranslations)); localStorage.setItem('showSentences', JSON.stringify(this.showSentences)); }
    saveWordsToLocalStorage() { if (this.allWords.length > 0) localStorage.setItem('germanWords', JSON.stringify(this.allWords)); }

    handleFilterChange() {
        this.stopAutoPlay();
        this.currentWord = null;
        this.wordHistory = [];
        this.currentHistoryIndex = -1;

        const newWord = this.getNextWord();
        if (newWord) {
            this.currentWord = newWord;
            this.addToHistory(this.currentWord);
            this.renderInitialCard(this.currentWord);
        } else {
            this.showNoWordsMessage();
        }
        this.updateUI();
    }

    addToHistory(word) {
        if (!word || (this.wordHistory[this.currentHistoryIndex] && this.wordHistory[this.currentHistoryIndex].id === word.id)) return;
        if (this.currentHistoryIndex < this.wordHistory.length - 1) { this.wordHistory.splice(this.currentHistoryIndex + 1); }
        this.wordHistory.push(word);
        if (this.wordHistory.length > 50) { this.wordHistory.shift(); } else { this.currentHistoryIndex++; }
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

    renderInitialCard(word) {
        const studyArea = document.getElementById('studyArea');
        studyArea.innerHTML = `<div class="card" id="wordCard" data-word-id="${word.id}"><div class="level-indicator ${word.level.toLowerCase()}">${word.level}</div><div class="word-container">${this.formatGermanWord(word)}<div class="pronunciation">${word.pronunciation || ''}</div><div id="translationContainer" class="translation-container"></div><div id="morphemeTranslations" class="morpheme-translations"></div><div id="sentenceContainer" class="sentence-container"></div></div></div>`;
        document.getElementById('wordCard')?.addEventListener('click', () => this.toggleAutoPlay());
        this.updateUI();
    }

    displayMorphemesAndTranslations(isDirect = false) { /* ... без изменений ... */ }
    displaySentence() { /* ... без изменений ... */ }
    displayFinalTranslation(withAnimation = true) { if (!this.currentWord) return; /* ... остальное без изменений ... */ }

    updateUI() {
        if (!this.isReady) return;
        this.updateStats();
        this.updateLevelButtons();
        this.updateThemeButtons();
        this.updateRepeatControlsState();
        this.updateControlButtons();
        this.updateNavigationButtons();
        this.updateToggleButton();
        this.updatePlayButtonState();
    }

    updatePlayButtonState() {
        const isDisabled = this.getActiveWords().length === 0;
        document.querySelectorAll('.play-pause').forEach(btn => {
            btn.classList.toggle('is-disabled', isDisabled);
        });
    }

    updateControlButtons() { /* ... без изменений ... */ }

    updateToggleButton() {
        document.querySelectorAll('.play-pause').forEach(btn => {
            btn.innerHTML = `<svg class="icon"><use xlink:href="${this.isAutoPlaying ? '#icon-pause' : '#icon-play'}"></use></svg>`;
            btn.classList.toggle('playing', this.isAutoPlaying);
        });
        const card = document.getElementById('wordCard');
        if (card) card.classList.toggle('is-clickable', !this.isAutoPlaying);
    }

    updateNavigationButtons() {
        const canGoBack = this.currentHistoryIndex > 0;
        const canGoForward = this.currentHistoryIndex < this.wordHistory.length - 1 || this.getActiveWords().length > this.wordHistory.length;
        document.querySelectorAll('[id^=prevButton]').forEach(btn => btn.classList.toggle('is-disabled', !canGoBack));
        document.querySelectorAll('[id^=nextButton]').forEach(btn => btn.classList.toggle('is-disabled', !canGoForward));
    }

    updateStats() { document.getElementById('totalWords').textContent = this.getActiveWords().length; document.getElementById('studiedToday').textContent = this.studiedToday; const acc = this.accuracy.total > 0 ? Math.round((this.accuracy.correct / this.accuracy.total) * 100) : 0; document.getElementById('accuracy').textContent = acc + '%'; }
    updateLevelButtons() { document.querySelectorAll('.level-btn').forEach(b => b.classList.toggle('active', this.selectedLevels.includes(b.dataset.level))); }
    updateThemeButtons() { document.querySelectorAll('.block-btn[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === this.selectedTheme)); }
    updateRepeatControlsState() { document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === this.repeatMode)); }

    bindEvents() {
        const bindUniversalClick = (ids, callback) => ids.forEach(id => document.getElementById(id)?.addEventListener('click', callback));
        document.getElementById('settingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(true));
        document.getElementById('closeSettingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(false));
        document.getElementById('settings-overlay')?.addEventListener('click', () => this.toggleSettingsPanel(false));
        bindUniversalClick(['toggleButton_desktop', 'toggleButton_mobile'], () => this.toggleAutoPlay());
        bindUniversalClick(['prevButton_desktop', 'prevButton_mobile'], () => this.showPreviousWord());
        bindUniversalClick(['nextButton_desktop', 'nextButton_mobile'], () => this.showNextWordManually());
        // ... остальной код bindEvents без изменений
    }

    // ... остаток кода (setupIcons, toggleSettingsPanel, и т.д.) без критических изменений ...

    // Полный код оставшихся методов для ясности
    setupIcons() {
        const iconMap = { 'prevButton': '#icon-prev', 'nextButton': '#icon-next', 'settingsButton': '#icon-settings' };
        Object.keys(iconMap).forEach(key => {
            document.querySelectorAll(`[id^=${key}]`).forEach(btn => {
                btn.innerHTML = `<svg class="icon"><use xlink:href="${iconMap[key]}"></use></svg>`;
            });
        });
    }

    toggleSettingsPanel(show) { document.getElementById('settings-panel').classList.toggle('visible', show); document.getElementById('settings-overlay').classList.toggle('visible', show); }

    toggleSetting(key, requiresCardUpdate = false) {
        this[key] = !this[key];
        this.saveStateToLocalStorage();
        this.updateControlButtons();
        if (requiresCardUpdate && this.currentWord) {
            this.renderInitialCard(this.currentWord);
            this.displayMorphemesAndTranslations(true);
            this.displaySentence();
            if (document.getElementById('translationContainer').innerHTML) {
                this.displayFinalTranslation(false);
            }
        }
    }

    toggleLevel(level) { const i = this.selectedLevels.indexOf(level); if (i > -1) { if (this.selectedLevels.length > 1) this.selectedLevels.splice(i, 1); } else { this.selectedLevels.push(level); } this.saveStateToLocalStorage(); this.handleFilterChange(); }
    setTheme(theme) { this.selectedTheme = theme; this.saveStateToLocalStorage(); this.handleFilterChange(); }
    setRepeatMode(mode) { this.repeatMode = mode; this.saveStateToLocalStorage(); this.updateUI(); }
    reloadDefaultWords() { if (confirm('Сбросить прогресс и загрузить стандартный словарь?')) { localStorage.clear(); window.location.reload(); } }

    exportWords() {
        if (this.allWords.length === 0) { alert("Словарь пуст."); return; }
        const blob = new Blob([JSON.stringify(this.allWords, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `german-vocabulary.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
    }

    importWords(event) {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if (Array.isArray(imported)) {
                    this.stopAutoPlay();
                    this.allWords = this.ensureWordIds(imported);
                    this.saveWordsToLocalStorage();
                    this.wordHistory = []; this.currentHistoryIndex = -1;
                    this.handleFilterChange();
                    alert(`Импорт завершен: ${imported.length} слов.`);
                } else { alert('Неверный формат файла.'); }
            } catch (err) { alert('Ошибка чтения файла: ' + err.message); }
        };
        reader.readAsText(file); event.target.value = '';
    }

    getActiveWords() { return this.allWords ? this.allWords.filter(w => w && w.level && this.selectedLevels.includes(w.level) && (this.selectedTheme === 'all' || w.theme === this.selectedTheme)) : []; }

    getNextWord() {
        const activeWords = this.getActiveWords();
        if (activeWords.length === 0) return null;
        const historyIds = this.wordHistory.map(w => w.id);
        const unshownWords = activeWords.filter(w => !historyIds.includes(w.id));
        if (this.repeatMode === 'random' && unshownWords.length > 0) return unshownWords[Math.floor(Math.random() * unshownWords.length)];
        if (this.repeatMode === 'random') return activeWords[Math.floor(Math.random() * activeWords.length)];
        let currentIndex = -1;
        if (this.currentWord) currentIndex = activeWords.findIndex(w => w.id === this.currentWord.id);
        let nextIndex = (currentIndex + 1) % activeWords.length;
        return activeWords[nextIndex];
    }

    parseGermanWord(word) { /* ... без изменений ... */ }
    formatGermanWord(word) { /* ... без изменений ... */ }
    showNoWordsMessage() { /* ... без изменений ... */ }
    showMessage(text) { /* ... без изменений ... */ }
}


document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new VocabularyApp();
        // ВАЖНО: HTML-кнопки должны быть без атрибута disabled,
        // так как JS теперь управляет этим через классы.
        document.querySelectorAll('.player-btn').forEach(btn => btn.removeAttribute('disabled'));
        app.init();
        window.app = app;
        console.log('✅ Приложение инициализировано');
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        document.body.innerHTML = `<div style="text-align:center;padding:50px;"><h1>Произошла ошибка</h1><p>Попробуйте очистить кэш браузера.</p></div>`;
    }
});