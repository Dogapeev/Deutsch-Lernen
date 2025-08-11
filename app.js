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
        this.audioUnlocked = false;
        this.isFirstPlay = true;

        this.ttsApiBaseUrl = 'https://deutsch-lernen-je9l.onrender.com';
        this.audioPlayer = document.getElementById('audioPlayer');

        this.loadStateFromLocalStorage();
        this.isAutoPlaying = false; // Всегда начинаем с выключенным автоплеем

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
        await this.loadVocabulary();
        this.setupIcons();
        this.bindEvents();
        this.updateUI();

        if (this.getActiveWords().length === 0) {
            this.showNoWordsMessage();
        } else {
            const wordToStart = this.getNextWord();
            if (wordToStart) {
                this.runDisplaySequence(wordToStart);
            }
        }
    }

    // --- НАДЕЖНЫЙ МЕТОД РАЗБЛОКИРОВКИ АУДИО ---
    async unlockAudio() {
        if (this.audioUnlocked) return;

        // Встраиваем крошечный беззвучный WAV файл
        const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        this.audioPlayer.src = silentWav;

        try {
            await this.audioPlayer.play();
            this.audioPlayer.pause();
            console.log('🔊 Аудиоконтекст успешно разблокирован.');
            this.audioUnlocked = true;
        } catch (error) {
            console.error('⚠️ Ошибка разблокировки аудиоконтекста:', error);
            // Даже если не удалось, приложение не сломается.
        } finally {
            // Очищаем плеер для настоящих аудиофайлов
            this.audioPlayer.src = '';
        }
    }

    startAutoPlay() {
        if (this.isAutoPlaying) return;

        this.isAutoPlaying = true;
        this.saveStateToLocalStorage();
        this.updateToggleButton();

        const wordToShow = this.currentWord || this.getNextWord();
        if (wordToShow) {
            this.runDisplaySequence(wordToShow);
        } else {
            this.showNoWordsMessage();
            this.stopAutoPlay();
        }
    }

    stopAutoPlay() {
        this.isAutoPlaying = false;
        this.saveStateToLocalStorage();
        if (this.sequenceController) {
            this.sequenceController.abort();
        }
        this.updateToggleButton();
    }

    async toggleAutoPlay() {
        if (this.isAutoPlaying) {
            this.stopAutoPlay();
        } else {
            // Сначала разблокируем аудио, затем запускаем
            await this.unlockAudio();
            this.isFirstPlay = true;
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
        const checkAborted = () => { if (signal.aborted) throw new DOMException('Sequence aborted', 'AbortError'); };

        try {
            const oldCard = document.getElementById('wordCard');
            if (oldCard) {
                oldCard.classList.add('word-crossfade', 'word-fade-out');
                await delay(300); checkAborted();
            }

            this.currentWord = word;
            this.renderInitialCard(word);
            this.addToHistory(word);

            if (!this.isAutoPlaying) return;

            // --- Основная последовательность автоплея ---
            const firstRepeatDelay = this.isFirstPlay ? 200 : 500;
            if (this.isFirstPlay) this.isFirstPlay = false;

            const repeats = this.repeatMode === 'random' ? 1 : parseInt(this.repeatMode, 10);
            for (let i = 0; i < repeats; i++) {
                await delay(i === 0 ? firstRepeatDelay : 1500); checkAborted();
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

            await delay(2000); checkAborted();
            const nextWord = this.getNextWord();
            this.runDisplaySequence(nextWord);

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('▶️ Последовательность корректно остановлена.');
            } else {
                console.error('❌ Ошибка в последовательности воспроизведения:', error);
                this.showMessage('Ошибка звука. Нажмите Play еще раз.');
                this.stopAutoPlay();
            }
        }
    }

    // --- РАБОЧАЯ ВЕРСИЯ ФУНКЦИИ ВОСПРОИЗВЕДЕНИЯ ---
    speak(text, lang) {
        return new Promise(async (resolve, reject) => {
            if (!text || (this.sequenceController && this.sequenceController.signal.aborted)) {
                return resolve();
            }
            const { signal } = this.sequenceController;

            const cleanUp = () => {
                this.audioPlayer.removeEventListener('ended', endedHandler);
                this.audioPlayer.removeEventListener('error', errorHandler);
                signal.removeEventListener('abort', abortHandler);
            };

            const abortHandler = () => { this.audioPlayer.pause(); this.audioPlayer.src = ''; cleanUp(); reject(new DOMException('Sequence aborted', 'AbortError')); };
            const endedHandler = () => { cleanUp(); resolve(); };
            const errorHandler = (e) => { cleanUp(); reject(new Error(`Audio playback error: ${this.audioPlayer.error?.message || 'Unknown Error'}`)); };

            this.audioPlayer.addEventListener('ended', endedHandler, { once: true });
            this.audioPlayer.addEventListener('error', errorHandler, { once: true });
            signal.addEventListener('abort', abortHandler, { once: true });

            try {
                const apiUrl = `${this.ttsApiBaseUrl}/synthesize?lang=${lang}&text=${encodeURIComponent(text)}`;
                const response = await fetch(apiUrl, { signal });
                if (!response.ok) throw new Error(`TTS server error: ${response.statusText}`);
                const data = await response.json();
                if (signal.aborted) return;

                this.audioPlayer.src = `${this.ttsApiBaseUrl}${data.url}`;
                await this.audioPlayer.play();
            } catch (error) {
                // Отклоняем промис, чтобы внешний try/catch мог его поймать
                reject(error);
            }
        });
    }

    async speakGerman(text) { if (this.soundEnabled) await this.speak(text, 'de'); }
    async speakRussian(text) { if (this.translationSoundEnabled) await this.speak(text, 'ru'); }
    async speakSentence(text) { if (this.sentenceSoundEnabled) await this.speak(text, 'de'); }

    ensureWordIds(words) { words.forEach((w, i) => { if (!w.id) w.id = `word_${Date.now()}_${i}`; }); return words; }

    async loadVocabulary() {
        const loadFromLocalStorage = () => { try { const d = localStorage.getItem('germanWords'); return d ? JSON.parse(d) : null; } catch { return null; } };
        const loadFromJSON = async () => { try { const r = await fetch('vocabulary.json'); if (!r.ok) throw new Error(`Network response was not ok`); return await r.json(); } catch (e) { console.error('Ошибка загрузки словаря:', e); return []; } };
        let data = loadFromLocalStorage();
        let msg = `Загружен сохраненный словарь`;
        if (!data || data.length === 0) { data = await loadFromJSON(); msg = `Загружен стандартный словарь`; }
        this.allWords = this.ensureWordIds(data);
        this.saveWordsToLocalStorage();
        this.showMessage(`${msg}: ${this.allWords.length} слов`);
    }

    loadStateFromLocalStorage() {
        const safeJsonParse = (k, d) => { try { const i = localStorage.getItem(k); return i ? JSON.parse(i) : d; } catch { return d; } };
        this.studiedToday = parseInt(localStorage.getItem('studiedToday')) || 0;
        this.lastStudyDate = localStorage.getItem('lastStudyDate');
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

    saveStateToLocalStorage() {
        localStorage.setItem('appVersion', this.appVersion);
        localStorage.setItem('studiedToday', this.studiedToday);
        localStorage.setItem('soundEnabled', JSON.stringify(this.soundEnabled));
        localStorage.setItem('translationSoundEnabled', JSON.stringify(this.translationSoundEnabled));
        localStorage.setItem('sentenceSoundEnabled', JSON.stringify(this.sentenceSoundEnabled));
        localStorage.setItem('repeatMode', JSON.stringify(this.repeatMode));
        localStorage.setItem('selectedLevels', JSON.stringify(this.selectedLevels));
        localStorage.setItem('selectedTheme', this.selectedTheme);
        localStorage.setItem('showArticles', JSON.stringify(this.showArticles));
        localStorage.setItem('showMorphemes', JSON.stringify(this.showMorphemes));
        localStorage.setItem('showMorphemeTranslations', JSON.stringify(this.showMorphemeTranslations));
        localStorage.setItem('showSentences', JSON.stringify(this.showSentences));
    }

    saveWordsToLocalStorage() { if (this.allWords.length > 0) localStorage.setItem('germanWords', JSON.stringify(this.allWords)); }

    handleFilterChange() {
        this.stopAutoPlay();
        this.currentWord = null; this.wordHistory = []; this.currentHistoryIndex = -1;
        this.updateUI();
        const newWord = this.getNextWord();
        if (newWord) {
            this.runDisplaySequence(newWord);
        } else {
            this.showNoWordsMessage();
        }
    }

    addToHistory(word) {
        if (!word || this.wordHistory[this.currentHistoryIndex]?.id === word.id) return;
        if (this.currentHistoryIndex < this.wordHistory.length - 1) {
            this.wordHistory.splice(this.currentHistoryIndex + 1);
        }
        this.wordHistory.push(word);
        if (this.wordHistory.length > 50) this.wordHistory.shift();
        this.currentHistoryIndex = this.wordHistory.length - 1;
        this.updateNavigationButtons();
    }

    navigate(direction) {
        this.stopAutoPlay();
        let newWord = null;
        if (direction === 'prev' && this.currentHistoryIndex > 0) {
            this.currentHistoryIndex--;
            newWord = this.wordHistory[this.currentHistoryIndex];
        } else if (direction === 'next') {
            if (this.currentHistoryIndex < this.wordHistory.length - 1) {
                this.currentHistoryIndex++;
                newWord = this.wordHistory[this.currentHistoryIndex];
            } else {
                newWord = this.getNextWord();
            }
        }
        if (newWord) {
            this.runDisplaySequence(newWord);
        }
        this.updateNavigationButtons();
    }

    renderInitialCard(word) {
        const studyArea = document.getElementById('studyArea');
        studyArea.innerHTML = `<div class="card card-appear" id="wordCard"><div class="level-indicator ${word.level.toLowerCase()}">${word.level}</div><div class="word-container">${this.formatGermanWord(word)}<div class="pronunciation">${word.pronunciation || ''}</div><div id="translationContainer" class="translation-container"></div><div id="morphemeTranslations" class="morpheme-translations"></div><div id="sentenceContainer" class="sentence-container"></div></div></div>`;
        document.getElementById('wordCard')?.addEventListener('click', () => this.toggleAutoPlay());
        this.updateToggleButton(); this.updateNavigationButtons();
    }

    displayFinalTranslation(withAnimation = true) {
        const card = document.getElementById('wordCard');
        if (!card || !card.isConnected) return;
        card.classList.remove('sentence-phase');
        card.classList.add('final-phase');
        if (this.isAutoPlaying) {
            this.studiedToday++;
            this.updateStats();
            this.saveStateToLocalStorage();
        }
        const translationContainer = document.getElementById('translationContainer');
        if (translationContainer) {
            translationContainer.innerHTML = `<div class="translation ${withAnimation ? 'translation-appear' : ''}">${this.currentWord.russian}</div>`;
        }
    }

    updateUI() { this.updateStats(); this.updateLevelButtons(); this.updateThemeButtons(); this.updateRepeatControlsState(); this.updateControlButtons(); this.updateNavigationButtons(); }

    updateControlButtons() {
        const controls = {
            'soundToggle': { state: this.soundEnabled, icons: ['#icon-sound-on', '#icon-sound-off'] },
            'translationSoundToggle': { state: this.translationSoundEnabled, icons: ['#icon-chat-on', '#icon-chat-off'] },
            'sentenceSoundToggle': { state: this.sentenceSoundEnabled, icons: ['#icon-sentence-on', '#icon-sentence-off'] },
            'toggleArticles': { state: this.showArticles },
            'toggleMorphemes': { state: this.showMorphemes },
            'toggleMorphemeTranslations': { state: this.showMorphemeTranslations },
            'toggleSentences': { state: this.showSentences }
        };
        for (const key in controls) {
            document.querySelectorAll(`[id^=${key}]`).forEach(btn => {
                btn.classList.toggle('active', controls[key].state);
                if (controls[key].icons && (btn.classList.contains('player-btn') || btn.classList.contains('sound-btn'))) {
                    btn.innerHTML = `<svg class="icon"><use xlink:href="${controls[key].state ? controls[key].icons[0] : controls[key].icons[1]}"></use></svg>`;
                }
                if (btn.classList.contains('option-btn')) {
                    btn.textContent = controls[key].state ? 'Вкл' : 'Выкл';
                }
            });
        }
        document.querySelectorAll('[id^=toggleMorphemeTranslations]').forEach(btn => btn.disabled = !this.showMorphemes);
    }

    updateToggleButton() { document.querySelectorAll('[id^=toggleButton]').forEach(btn => { btn.innerHTML = `<svg class="icon"><use xlink:href="${this.isAutoPlaying ? '#icon-pause' : '#icon-play'}"></use></svg>`; if (btn.classList.contains('play-pause')) btn.classList.toggle('playing', this.isAutoPlaying); }); const card = document.getElementById('wordCard'); if (card) card.classList.toggle('is-clickable', !this.isAutoPlaying); }

    updateNavigationButtons() {
        document.querySelectorAll('[id^=prevButton]').forEach(btn => btn.disabled = this.currentHistoryIndex <= 0);
        const hasNext = this.currentHistoryIndex < this.wordHistory.length - 1 || this.getActiveWords().length > this.wordHistory.length;
        document.querySelectorAll('[id^=nextButton]').forEach(btn => btn.disabled = !hasNext);
    }

    updateStats() { document.getElementById('totalWords').textContent = this.getActiveWords().length; document.getElementById('studiedToday').textContent = this.studiedToday; }
    updateLevelButtons() { document.querySelectorAll('.level-btn').forEach(b => b.classList.toggle('active', this.selectedLevels.includes(b.dataset.level))); }
    updateThemeButtons() { document.querySelectorAll('.block-btn[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === this.selectedTheme)); }
    updateRepeatControlsState() { document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === this.repeatMode)); }

    bindEvents() {
        const bindUniversalClick = (ids, callback) => ids.forEach(id => document.getElementById(id)?.addEventListener('click', callback));
        document.getElementById('settingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(true));
        document.getElementById('closeSettingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(false));
        document.getElementById('settings-overlay')?.addEventListener('click', () => this.toggleSettingsPanel(false));
        bindUniversalClick(['toggleButton_desktop', 'toggleButton_mobile'], () => this.toggleAutoPlay());
        bindUniversalClick(['prevButton_desktop', 'prevButton_mobile'], () => this.navigate('prev'));
        bindUniversalClick(['nextButton_desktop', 'nextButton_mobile'], () => this.navigate('next'));
        bindUniversalClick(['soundToggle_desktop', 'soundToggle_mobile'], () => this.toggleSetting('soundEnabled'));
        bindUniversalClick(['translationSoundToggle_desktop', 'translationSoundToggle_mobile'], () => this.toggleSetting('translationSoundEnabled'));
        bindUniversalClick(['sentenceSoundToggle_desktop', 'sentenceSoundToggle_mobile'], () => this.toggleSetting('sentenceSoundEnabled'));
        bindUniversalClick(['toggleArticles_desktop', 'toggleArticles_mobile'], () => this.toggleSetting('showArticles', true));
        bindUniversalClick(['toggleMorphemes_desktop', 'toggleMorphemes_mobile'], () => { this.toggleSetting('showMorphemes', true); if (!this.showMorphemes) this.toggleSetting('showMorphemeTranslations', true, false); });
        bindUniversalClick(['toggleMorphemeTranslations_desktop', 'toggleMorphemeTranslations_mobile'], () => { if (this.showMorphemes) this.toggleSetting('showMorphemeTranslations', true); });
        bindUniversalClick(['toggleSentences_desktop', 'toggleSentences_mobile'], () => this.toggleSetting('showSentences', true));
        document.querySelectorAll('.level-btn').forEach(btn => btn.addEventListener('click', e => this.toggleLevel(e.target.dataset.level)));
        document.querySelectorAll('.block-btn[data-theme]').forEach(btn => btn.addEventListener('click', e => this.setTheme(e.target.dataset.theme)));
        document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', e => this.setRepeatMode(e.target.dataset.mode)));
        bindUniversalClick(['reloadDefaultWords_desktop', 'reloadDefaultWords_mobile'], () => this.reloadDefaultWords());
        bindUniversalClick(['exportWords_desktop', 'exportWords_mobile'], () => this.exportWords());
        document.getElementById('importWords_desktop')?.addEventListener('click', () => document.getElementById('fileInput_desktop').click());
        document.getElementById('fileInput_desktop')?.addEventListener('change', e => this.importWords(e));
        document.getElementById('importWords_mobile')?.addEventListener('click', () => document.getElementById('fileInput_mobile').click());
        document.getElementById('fileInput_mobile')?.addEventListener('change', e => { this.importWords(e); this.toggleSettingsPanel(false); });
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) setTimeout(() => document.querySelector('.header-mobile')?.classList.add('collapsed'), 5000);
    }

    setupIcons() {
        const iconMap = { 'prevButton': '#icon-prev', 'nextButton': '#icon-next', 'settingsButton': '#icon-settings' };
        Object.keys(iconMap).forEach(key => {
            document.querySelectorAll(`[id^=${key}]`).forEach(btn => {
                btn.innerHTML = `<svg class="icon"><use xlink:href="${iconMap[key]}"></use></svg>`;
            });
        });
        this.updateToggleButton();
        this.updateControlButtons();
    }

    toggleSettingsPanel(show) { document.getElementById('settings-panel').classList.toggle('visible', show); document.getElementById('settings-overlay').classList.toggle('visible', show); }

    toggleSetting(key, shouldRerender = false, forceState = undefined) {
        this[key] = forceState !== undefined ? forceState : !this[key];
        this.saveStateToLocalStorage(); this.updateControlButtons();
        if (shouldRerender && this.currentWord && !this.isAutoPlaying) {
            this.runDisplaySequence(this.currentWord);
        }
    }

    toggleLevel(level) { const i = this.selectedLevels.indexOf(level); if (i > -1) { if (this.selectedLevels.length > 1) this.selectedLevels.splice(i, 1); } else { this.selectedLevels.push(level); } this.saveStateToLocalStorage(); this.handleFilterChange(); }
    setTheme(theme) { this.selectedTheme = theme; this.saveStateToLocalStorage(); this.handleFilterChange(); }
    setRepeatMode(mode) { this.repeatMode = mode; this.saveStateToLocalStorage(); this.updateUI(); }
    reloadDefaultWords() { if (confirm('Сбросить прогресс и загрузить стандартный словарь?')) { localStorage.clear(); window.location.reload(); } }

    getActiveWords() { return this.allWords ? this.allWords.filter(w => w && w.level && this.selectedLevels.includes(w.level) && (this.selectedTheme === 'all' || !w.theme || w.theme === this.selectedTheme)) : []; }

    getNextWord() {
        const activeWords = this.getActiveWords();
        if (activeWords.length === 0) return null;
        if (this.repeatMode === 'random') {
            if (activeWords.length > 1 && this.currentWord) {
                const availableWords = activeWords.filter(w => w.id !== this.currentWord.id);
                if (availableWords.length > 0) return availableWords[Math.floor(Math.random() * availableWords.length)];
            }
            return activeWords[Math.floor(Math.random() * activeWords.length)];
        }
        const currentId = this.currentWord ? this.currentWord.id : -1;
        let currentIndex = activeWords.findIndex(w => w.id === currentId);
        let nextIndex = (currentIndex + 1) % activeWords.length;
        return activeWords[nextIndex];
    }

    showNoWordsMessage() {
        const msg = this.allWords?.length > 0 ? 'Нет слов для выбранных фильтров.<br>Попробуйте изменить уровень или тему.' : 'Словарь пуст. Загрузите стандартный или импортируйте свой.';
        document.getElementById('studyArea').innerHTML = `<div class="no-words"><p>${msg}</p></div>`;
        document.querySelectorAll('[id^=toggleButton], [id^=nextButton], [id^=prevButton]').forEach(btn => btn.disabled = true);
    }

    showMessage(text) {
        const statusDiv = document.getElementById('levelStatus');
        if (statusDiv) { statusDiv.textContent = text; statusDiv.style.display = 'block'; setTimeout(() => { statusDiv.style.display = 'none'; }, 3000); }
    }

    displayMorphemesAndTranslations() { const { currentWord } = this; const mainWordElement = document.querySelector('.word .main-word'); const translationsContainer = document.getElementById('morphemeTranslations'); const wordElement = document.querySelector('.word'); if (!mainWordElement || !translationsContainer || !wordElement) { return; } const parsed = this.parseGermanWord(currentWord); mainWordElement.innerHTML = `<span class="morpheme">${parsed.mainWord}</span>`; wordElement.classList.remove('show-morphemes'); translationsContainer.innerHTML = ''; translationsContainer.classList.remove('visible'); if (currentWord.morphemes) { if (this.showMorphemes) { const separatorHTML = `<span class="morpheme-separator"><span class="morpheme-separator-desktop">-</span><span class="morpheme-separator-mobile">|</span></span>`; mainWordElement.innerHTML = currentWord.morphemes.map(item => `<span class="morpheme">${item.m || ''}</span>`).join(separatorHTML); setTimeout(() => wordElement.classList.add('show-morphemes'), 10); } if (this.showMorphemes && this.showMorphemeTranslations) { translationsContainer.innerHTML = currentWord.morphemes.map(item => `<div class="morpheme-translation-item"><span class="morpheme-part">${item.m || ''}</span><span class="translation-part">${item.t || '?'}</span></div>`).join(''); setTimeout(() => translationsContainer.classList.add('visible'), 10); } } }
    displaySentence() { const { currentWord } = this; const container = document.getElementById('sentenceContainer'); const card = document.getElementById('wordCard'); if (!container || !card) return; if (this.showSentences && currentWord.sentence) { container.innerHTML = `<div class="sentence sentence-appear">${currentWord.sentence}<div class="sentence-translation">${currentWord.sentence_ru}</div></div>`; card.classList.add('sentence-phase'); } else { container.innerHTML = ''; card.classList.remove('sentence-phase'); } }
    parseGermanWord(word) { const german = word.german || ''; const articles = ['der ', 'die ', 'das ']; for (const article of articles) { if (german.startsWith(article)) return { article: article.trim(), mainWord: german.substring(article.length), genderClass: article.trim() }; } return { article: null, mainWord: german, genderClass: 'das' }; }
    formatGermanWord(word) { const parsed = this.parseGermanWord(word); const articleClass = this.showArticles ? '' : 'hide-articles'; const mainWordHtml = `<span class="morpheme">${parsed.mainWord}</span>`; const articleHtml = parsed.article ? `<span class="article ${parsed.genderClass}">${parsed.article}</span>` : ''; return `<div class="word ${parsed.genderClass} ${articleClass}">${articleHtml}<span class="main-word">${mainWordHtml}</span></div>`; }
    exportWords() { if (this.allWords.length === 0) { alert("Словарь пуст."); return; } const blob = new Blob([JSON.stringify(this.allWords, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `german-vocabulary.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href); }
    importWords(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (e) => { try { const imported = JSON.parse(e.target.result); if (Array.isArray(imported)) { this.stopAutoPlay(); this.allWords = this.ensureWordIds(imported); this.saveWordsToLocalStorage(); this.wordHistory = []; this.currentHistoryIndex = -1; this.handleFilterChange(); alert(`Импорт завершен: ${imported.length} слов.`); } else { alert('Неверный формат файла.'); } } catch (err) { alert('Ошибка чтения файла: ' + err.message); } }; reader.readAsText(file); event.target.value = ''; }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new VocabularyApp();
        app.init();
        window.app = app;
        console.log('✅ Приложение инициализировано');
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        document.body.innerHTML = `<div style="text-align:center;padding:50px;"><h1>Произошла ошибка</h1><p>Попробуйте очистить кэш браузера.</p></div>`;
    }
});