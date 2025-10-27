// --- НАЧАЛО ФАЙЛА APP.JS ---

// app.js - Версия 5.0.3 (Fix Email/Password Auth & Add Notifications)
"use strict";

// --- ИНИЦИАЛИЗАЦИЯ FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyBWkVK2-gnHLDk2XBxenqsSm4Dp8Ey9kcY",
    authDomain: "deutsch-lernen-aiweb.firebaseapp.com",
    projectId: "deutsch-lernen-aiweb",
    storageBucket: "deutsch-lernen-aiweb.appspot.com",
    messagingSenderId: "495823275301",
    appId: "1:495823275301:web:f724cdedce75a1538946cc",
    measurementId: "G-DV24PZW6R3"
};

// Инициализируем Firebase и создаем константы для доступа к сервисам
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --- КОНФИГУРАЦИЯ И КОНСТАНТЫ ---
const APP_VERSION = '5.0.3';
const TTS_API_BASE_URL = 'https://deutsch-lernen-sandbox.onrender.com';

const DELAYS = {
    INITIAL_WORD: 500,
    BETWEEN_REPEATS: 1000,
    BEFORE_MORPHEMES: 1000,
    BEFORE_SENTENCE: 2000,
    BEFORE_TRANSLATION: 1000,
    BEFORE_NEXT_WORD: 1500,
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
        this.audioPlayer = null;
        this.themeMap = {};
        this.elements = {};
        this.lastScrollY = 0;
        this.headerCollapseTimeout = null;
        this.playbackStateKeeper = null; // Интервал для удержания playbackState

        this.state = {
            currentUser: null,
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

        this.loadStateFromLocalStorage();
        this.runMigrations();
    }

    init() {
        this.audioPlayer = document.getElementById('audioPlayer');

        // Добавляем обработчики для принудительного контроля playbackState
        // Предотвращаем автоматическое изменение состояния браузером
        if (this.audioPlayer) {
            this.audioPlayer.addEventListener('play', () => {
                if (this.state.isAutoPlaying && 'mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'playing';
                }
            });

            this.audioPlayer.addEventListener('pause', () => {
                if (this.state.isAutoPlaying && 'mediaSession' in navigator) {
                    // Если блок играет, принудительно возвращаем playbackState в playing
                    navigator.mediaSession.playbackState = 'playing';
                }
            });

            this.audioPlayer.addEventListener('ended', () => {
                if (this.state.isAutoPlaying && 'mediaSession' in navigator) {
                    // Если блок играет, принудительно возвращаем playbackState в playing
                    navigator.mediaSession.playbackState = 'playing';
                }
            });
        }

        // Устанавливаем обработчики Media Session один раз
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => {
                if (!this.state.isAutoPlaying) {
                    this.startAutoPlay();
                }
            });

            navigator.mediaSession.setActionHandler('pause', () => {
                if (this.state.isAutoPlaying) {
                    this.stopAutoPlay();
                }
            });

            navigator.mediaSession.setActionHandler('previoustrack', () => {
                this.showPreviousWord();
            });

            navigator.mediaSession.setActionHandler('nexttrack', () => {
                this.showNextWordManually();
            });

            // Отключаем перемотку
            try {
                navigator.mediaSession.setActionHandler('seekbackward', null);
                navigator.mediaSession.setActionHandler('seekforward', null);
                navigator.mediaSession.setActionHandler('seekto', null);
            } catch (e) {
                // Игнорируем ошибки
            }
        }

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
            headerMobile: document.querySelector('.header-mobile'),
            notification: document.getElementById('notification'),
            auth: {
                container: document.querySelector('.auth-container'),
                openAuthBtn: document.getElementById('openAuthBtn'),
                userProfile: document.getElementById('userProfile'),
                signOutBtn: document.getElementById('signOutBtn'),
                userAvatar: document.getElementById('userAvatar'),
                userInitials: document.getElementById('userInitials'),
                userDisplayName: document.getElementById('userDisplayName'),
                userEmail: document.getElementById('userEmail'),
                modal: document.getElementById('authModal'),
                overlay: document.getElementById('authOverlay'),
                closeModalBtn: document.getElementById('closeAuthBtn'),
                googleSignInBtn: document.getElementById('googleSignInBtn'),
                googleSignUpBtn: document.getElementById('googleSignUpBtn'),
                tabs: document.querySelectorAll('.auth-tab'),
                tabContents: document.querySelectorAll('.auth-tab-content'),
                signinForm: document.getElementById('signinForm'),
                signupForm: document.getElementById('signupForm'),
                resetPasswordForm: document.getElementById('resetPasswordForm'),
                forgotPasswordBtn: document.getElementById('forgotPasswordBtn'),
                backToSigninBtn: document.getElementById('backToSigninBtn'),
            }
        };

        this.bindEvents();
        this.repositionAuthContainer();
        auth.onAuthStateChanged(user => this.handleAuthStateChanged(user));
    }

    handleAuthStateChanged(user) {
        clearTimeout(this.headerCollapseTimeout);
        if (user) {
            this.setState({ currentUser: user });
            this.updateAuthUI(user);
            console.log("✅ Пользователь вошел:", user.displayName);
            this.loadAndSwitchVocabulary(this.state.currentVocabulary, true);
            this.headerCollapseTimeout = setTimeout(() => this.collapseMobileHeader(), 3000);
        } else {
            this.setState({ currentUser: null });
            this.updateAuthUI(null);
            this.allWords = [];
            this.showLoginMessage();
            console.log("🔴 Пользователь вышел.");
            this.expandMobileHeader();
        }
    }

    updateAuthUI(user) {
        if (!this.elements.auth || !this.elements.auth.openAuthBtn) return;
        if (user) {
            this.elements.auth.openAuthBtn.style.display = 'none';
            this.elements.auth.userProfile.style.display = 'flex';
            this.elements.auth.userDisplayName.textContent = user.displayName || 'Пользователь';
            this.elements.auth.userEmail.textContent = user.email;

            if (user.photoURL) {
                this.elements.auth.userAvatar.src = user.photoURL;
                this.elements.auth.userAvatar.style.display = 'block';
                this.elements.auth.userInitials.style.display = 'none';
            } else {
                this.elements.auth.userAvatar.style.display = 'none';
                this.elements.auth.userInitials.style.display = 'flex';
                this.elements.auth.userInitials.textContent = (user.displayName || 'U').charAt(0);
            }
        } else {
            this.elements.auth.openAuthBtn.style.display = 'flex';
            this.elements.auth.userProfile.style.display = 'none';
        }
    }

    toggleAuthModal(show) {
        if (show) {
            this.elements.auth.modal.classList.add('visible');
            this.elements.auth.overlay.classList.add('visible');
            this.switchAuthTab('signin'); // Сбрасываем на вкладку входа при открытии
        } else {
            this.elements.auth.modal.classList.remove('visible');
            this.elements.auth.overlay.classList.remove('visible');
        }
    }

    async signInWithGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await auth.signInWithPopup(provider);
            this.toggleAuthModal(false);
        } catch (error) {
            console.error("Ошибка входа через Google:", error);
            this.showNotification(`Ошибка: ${error.message}`, 'error');
        }
    }

    bindEvents() {
        document.getElementById('settingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(true));
        document.getElementById('closeSettingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(false));
        this.elements.settingsOverlay.addEventListener('click', () => this.toggleSettingsPanel(false));
        document.querySelectorAll('[id^=toggleButton]').forEach(b => b.addEventListener('click', (event) => {
            event.stopPropagation();
            this.toggleAutoPlay();
        }));
        document.querySelectorAll('[id^=prevButton]').forEach(b => b.addEventListener('click', (event) => {
            event.stopPropagation();
            this.showPreviousWord();
        }));
        document.querySelectorAll('[id^=nextButton]').forEach(b => b.addEventListener('click', (event) => {
            event.stopPropagation();
            this.showNextWordManually();
        }));
        document.querySelectorAll('[id^=soundToggle]').forEach(b => b.addEventListener('click', (event) => {
            event.stopPropagation();
            this.toggleSetting('soundEnabled');
        }));
        document.querySelectorAll('[id^=translationSoundToggle]').forEach(b => b.addEventListener('click', (event) => {
            event.stopPropagation();
            this.toggleSetting('translationSoundEnabled');
        }));
        document.querySelectorAll('[id^=sentenceSoundToggle]').forEach(b => b.addEventListener('click', (event) => {
            event.stopPropagation();
            this.toggleSetting('sentenceSoundEnabled');
        }));
        document.querySelectorAll('[id^=toggleArticles]').forEach(b => b.addEventListener('click', (event) => {
            event.stopPropagation();
            this.toggleSetting('showArticles');
        }));
        document.querySelectorAll('[id^=toggleMorphemes]').forEach(b => b.addEventListener('click', (event) => {
            event.stopPropagation();
            this.toggleSetting('showMorphemes');
        }));
        document.querySelectorAll('[id^=toggleMorphemeTranslations]').forEach(b => b.addEventListener('click', (event) => {
            event.stopPropagation();
            this.toggleSetting('showMorphemeTranslations');
        }));
        document.querySelectorAll('[id^=toggleSentences]').forEach(b => b.addEventListener('click', (event) => {
            event.stopPropagation();
            this.toggleSetting('showSentences');
        }));
        document.querySelectorAll('.level-btn').forEach(btn => btn.addEventListener('click', e => {
            e.stopPropagation();
            this.toggleLevel(e.target.dataset.level);
        }));
        document.querySelectorAll('.repeat-selector, .repeat-selector-mobile').forEach(btn => btn.addEventListener('click', e => {
            e.stopPropagation();
            this.setRepeatMode(parseInt(e.currentTarget.dataset.mode));
        }));
        document.querySelectorAll('.sequence-selector, .sequence-selector-mobile').forEach(btn => btn.addEventListener('click', e => {
            e.stopPropagation();
            this.setSequenceMode(e.currentTarget.dataset.mode);
        }));
        document.querySelectorAll('[id^=vocabularySelector]').forEach(sel => sel.addEventListener('change', (e) => this.loadAndSwitchVocabulary(e.target.value)));

        // --- AUTH EVENTS ---
        this.elements.auth.openAuthBtn.addEventListener('click', () => this.toggleAuthModal(true));
        this.elements.auth.closeModalBtn.addEventListener('click', () => this.toggleAuthModal(false));
        this.elements.auth.overlay.addEventListener('click', () => this.toggleAuthModal(false));
        this.elements.auth.signOutBtn.addEventListener('click', () => auth.signOut());
        this.elements.auth.googleSignInBtn.addEventListener('click', () => this.signInWithGoogle());
        this.elements.auth.googleSignUpBtn.addEventListener('click', () => this.signInWithGoogle());

        this.elements.auth.tabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.tab));
        });
        this.elements.auth.forgotPasswordBtn.addEventListener('click', () => this.switchAuthTab('resetPassword'));
        this.elements.auth.backToSigninBtn.addEventListener('click', () => this.switchAuthTab('signin'));

        this.elements.auth.signupForm.addEventListener('submit', e => this.handleSignUpWithEmail(e));
        this.elements.auth.signinForm.addEventListener('submit', e => this.handleSignInWithEmail(e));
        this.elements.auth.resetPasswordForm.addEventListener('submit', e => this.handlePasswordReset(e));

        // --- WINDOW EVENTS ---
        window.addEventListener('resize', () => this.repositionAuthContainer());
        window.addEventListener('scroll', () => this.handleScroll());

        this.elements.mainContent.addEventListener('click', () => this.toggleAutoPlay());
    }

    // --- AUTH HANDLERS ---
    async handleSignUpWithEmail(e) {
        e.preventDefault();
        const name = e.target.signupName.value;
        const email = e.target.signupEmail.value;
        const password = e.target.signupPassword.value;
        const passwordConfirm = e.target.signupPasswordConfirm.value;

        if (password !== passwordConfirm) {
            this.showNotification('Пароли не совпадают!', 'error');
            return;
        }

        try {
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            await userCredential.user.updateProfile({ displayName: name });
            this.toggleAuthModal(false);
            this.showNotification(`Добро пожаловать, ${name}!`, 'success');
        } catch (error) {
            console.error("Ошибка регистрации:", error);
            this.showNotification(this.getFirebaseAuthErrorMessage(error), 'error');
        }
    }

    async handleSignInWithEmail(e) {
        e.preventDefault();
        const email = e.target.signinEmail.value;
        const password = e.target.signinPassword.value;

        try {
            await auth.signInWithEmailAndPassword(email, password);
            this.toggleAuthModal(false);
        } catch (error) {
            console.error("Ошибка входа:", error);
            this.showNotification(this.getFirebaseAuthErrorMessage(error), 'error');
        }
    }

    async handlePasswordReset(e) {
        e.preventDefault();
        const email = e.target.resetEmail.value;

        try {
            await auth.sendPasswordResetEmail(email);
            this.showNotification('Письмо для сброса пароля отправлено на ваш email.', 'success');
            this.switchAuthTab('signin');
        } catch (error) {
            console.error("Ошибка сброса пароля:", error);
            this.showNotification(this.getFirebaseAuthErrorMessage(error), 'error');
        }
    }

    switchAuthTab(tabId) {
        this.elements.auth.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${tabId}Tab`);
        });
        this.elements.auth.tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabId);
        });
    }

    getFirebaseAuthErrorMessage(error) {
        switch (error.code) {
            case 'auth/email-already-in-use':
                return 'Этот email уже зарегистрирован.';
            case 'auth/invalid-email':
                return 'Неверный формат email.';
            case 'auth/weak-password':
                return 'Пароль слишком слабый (минимум 6 символов).';
            case 'auth/user-not-found':
            case 'auth/wrong-password':
                return 'Неверный email или пароль.';
            default:
                return 'Произошла ошибка. Попробуйте снова.';
        }
    }

    showNotification(message, type = 'info') {
        const notification = this.elements.notification;
        if (!notification) return;
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('visible');
        setTimeout(() => {
            notification.classList.remove('visible');
        }, 4000);
    }

    // --- UI/UX HANDLERS ---
    repositionAuthContainer() {
        const isMobile = window.innerWidth <= 768;
        const authContainer = this.elements.auth.container;
        if (!authContainer) return;
        const mobileHeader = this.elements.headerMobile;
        const desktopHeader = document.querySelector('.header');
        if (isMobile) {
            if (authContainer.parentElement !== mobileHeader) {
                mobileHeader.appendChild(authContainer);
            }
        } else {
            if (authContainer.parentElement !== desktopHeader) {
                desktopHeader.appendChild(authContainer);
            }
        }
    }

    handleScroll() {
        if (window.innerWidth > 768) return;
        const currentScrollY = window.scrollY;
        if (currentScrollY === 0) {
            this.expandMobileHeader();
        } else if (currentScrollY > this.lastScrollY && currentScrollY > 50) {
            this.collapseMobileHeader();
        }
        this.lastScrollY = currentScrollY;
    }

    collapseMobileHeader() {
        this.elements.headerMobile?.classList.add('collapsed');
    }

    expandMobileHeader() {
        this.elements.headerMobile?.classList.remove('collapsed');
    }

    showLoginMessage() {
        this.stopAutoPlay();
        const msg = 'Войдите в аккаунт, чтобы создавать свои словари и отслеживать прогресс.';
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${msg}</p></div>`;
        this.setState({ currentWord: null });
        this.updateUI();
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };
        this.updateUI();
        this.saveStateToLocalStorage();
        // Обновляем Media Session если изменилось текущее слово
        if (newState.hasOwnProperty('currentWord')) {
            this.updateMediaSession(newState.currentWord);
        }
    }
    updateMediaSession(word) {
        if ('mediaSession' in navigator) {
            if (word && word.german && word.russian) {
                // Обновляем только метаданные при смене слова
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: word.german,
                    artist: word.russian,
                    album: word.level || 'A1',
                });
            } else {
                // Очищаем Media Session если нет слова
                navigator.mediaSession.metadata = null;
            }
        }
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
            // Обновляем Media Session playback state
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
                // Запускаем агрессивный keeper - проверяем каждые 100ms
                this.playbackStateKeeper = setInterval(() => {
                    if (this.state.isAutoPlaying && navigator.mediaSession.playbackState !== 'playing') {
                        navigator.mediaSession.playbackState = 'playing';
                    }
                }, 100);
            }
            this.runDisplaySequence(wordToShow);
        } else {
            this.showNoWordsMessage();
        }
    }
    stopAutoPlay() {
        if (this.sequenceController) {
            this.sequenceController.abort();
        }
        // Останавливаем текущее аудио
        if (this.audioPlayer) {
            this.audioPlayer.pause();
        }
        // Останавливаем keeper интервал
        if (this.playbackStateKeeper) {
            clearInterval(this.playbackStateKeeper);
            this.playbackStateKeeper = null;
        }
        this.setState({ isAutoPlaying: false });
        // Обновляем Media Session playback state
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }
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
        if (!this.elements.mainContent) return; // Защита от ошибок, если элементы еще не найдены
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
            prevButton: '#icon-prev', nextButton: '#icon-next',
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
        this.elements.mainContent.classList.toggle('is-clickable', !this.state.isAutoPlaying);
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
    renderInitialCard(word) {
        if (!word) {
            this.showNoWordsMessage();
            return;
        }
        this.elements.mainContent.querySelector('.level-indicator')?.remove();
        if (word.level) {
            const levelHtml = `<div class="level-indicator ${word.level.toLowerCase()}">${word.level}</div>`;
            this.elements.mainContent.insertAdjacentHTML('afterbegin', levelHtml);
        }
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
        this.elements.studyArea.innerHTML = cardHtml;
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
        document.querySelectorAll('.repeat-selector, .repeat-selector-mobile').forEach(button => {
            button.classList.toggle('active', parseInt(button.dataset.mode) === this.state.repeatMode);
        });
        document.querySelectorAll('.sequence-selector, .sequence-selector-mobile').forEach(button => {
            button.classList.toggle('active', button.dataset.mode === this.state.sequenceMode);
        });
    }
    toggleSettingsPanel(show) {
        this.elements.settingsPanel.classList.toggle('visible', show);
        this.elements.settingsOverlay.classList.toggle('visible', show);
    }
    toggleLevel(level) {
        if (!this.state.availableLevels.includes(level)) return;
        const newLevels = this.state.selectedLevels.includes(level) ? (this.state.selectedLevels.length > 1 ? this.state.selectedLevels.filter(l => l !== level) : this.state.selectedLevels) : [...this.state.selectedLevels, level];
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
        const msg = customMessage || (this.allWords && this.allWords.length > 0 ? 'Нет слов для выбранных фильтров.<br>Попробуйте изменить уровень или тему.' : 'Загрузка словаря...');
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${msg}</p></div>`;
        this.setState({ currentWord: null });
    }

} // Конец класса VocabularyApp

document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new VocabularyApp();
        app.init();
        window.app = app;
        console.log('✅ Приложение инициализировано. Версия:', APP_VERSION);
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        // Просто показываем простое сообщение, не ломая всю страницу
        document.body.innerHTML = `<div style="text-align:center;padding:50px;"><h1>Произошла ошибка</h1><p>Попробуйте очистить кэш браузера.</p></div>`;
    }
});