// app.js - Версия 6.1.0 (с VocabularyService)
"use strict";

// --- ИМПОРТЫ МОДУЛЕЙ ---
import { APP_VERSION } from './utils/constants.js';
import { delay } from './utils/helpers.js';
import { AudioEngine } from './core/AudioEngine.js';
import { StateManager } from './core/StateManager.js';
import { LessonEngine } from './core/LessonEngine.js';
import { UIController } from './ui/UIController.js';
// ДОБАВЛЕНО: Импортируем новый сервис
import { VocabularyService } from './services/VocabularyService.js';

// --- ИНИЦИАЛИЗАЦИЯ FIREBASE ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";
import { FIREBASE_CONFIG } from './utils/constants.js';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

class VocabularyApp {

    constructor() {
        this.appVersion = APP_VERSION;
        this.allWords = []; // Весь набор слов текущего словаря
        this.themeMap = {};
        this.headerCollapseTimeout = null;

        // --- ИНИЦИАЛИЗАЦИЯ ОСНОВНЫХ МОДУЛЕЙ ---
        this.stateManager = new StateManager();
        this.audioEngine = new AudioEngine({ stateManager: this.stateManager });

        // ДОБАВЛЕНО: Создаем экземпляр сервиса
        this.vocabularyService = new VocabularyService({ stateManager: this.stateManager });

        // Обработчики для UIController (пульт управления для UI)
        const handlers = {
            onTogglePlay: () => this.lessonEngine.toggle(),
            onNextWord: () => this.lessonEngine.next(),
            onPreviousWord: () => this.lessonEngine.previous(),
            onToggleSetting: (key) => this.toggleSetting(key),
            onLevelToggle: (level) => this.toggleLevel(level),
            onThemeChange: (theme) => this.setTheme(theme),
            onRepeatModeChange: (mode) => this.setRepeatMode(mode),
            onSequenceModeChange: (mode) => this.setSequenceMode(mode),
            onVocabularyChange: (name) => this.loadAndSwitchVocabulary(name)
        };

        this.uiController = new UIController({
            stateManager: this.stateManager,
            handlers: handlers
        });

        // "Мост" между LessonEngine и UIController
        const uiBridge = {
            renderInitialCard: (...args) => this.uiController.renderInitialCard(...args),
            showNoWordsMessage: (...args) => this.uiController.showNoWordsMessage(...args, this.allWords.length > 0),
            updateCardViewToPhase: (...args) => this.uiController.updateCardViewToPhase(...args),
            displayMorphemesAndTranslations: (...args) => this.uiController.displayMorphemesAndTranslations(...args),
            displaySentence: (...args) => this.uiController.displaySentence(...args),
            displayFinalTranslation: (...args) => this.uiController.displayFinalTranslation(...args),
            fadeInNewCard: (...args) => this._fadeInNewCard(...args),
            revealMorphemesPhase: (...args) => this._revealMorphemesPhase(...args),
            revealSentencePhase: (...args) => this._revealSentencePhase(...args),
            revealTranslationPhase: (...args) => this._revealTranslationPhase(...args),
            prepareNextWord: (...args) => this._prepareNextWord(...args),
        };

        this.lessonEngine = new LessonEngine({
            stateManager: this.stateManager,
            audioEngine: this.audioEngine,
            ui: uiBridge
        });

        this.stateManager.subscribe(() => this.handleStateUpdate());
    }

    init() {
        this.stateManager.init();
        this.uiController.init();

        // ВРЕМЕННО: Логика авторизации остаётся здесь до создания AuthController
        this.bindAuthEvents();
        this.repositionAuthContainer();
        window.addEventListener('resize', () => this.repositionAuthContainer());

        this.setupMediaSessionHandlers();
        onAuthStateChanged(auth, user => this.handleAuthStateChanged(user));
    }

    // ИЗМЕНЕНО: Обновляем UI, передавая ему отфильтрованное количество слов
    handleStateUpdate() {
        const activeWords = this.vocabularyService.filterWords(this.allWords);
        const canNavigate = this.lessonEngine.playbackSequence.length > 1;
        this.uiController.updateUI(activeWords.length, canNavigate);
    }

    // --- УПРАВЛЕНИЕ АВТОРИЗАЦИЕЙ (будет перенесено в AuthController) ---
    bindAuthEvents() {
        const authElements = {
            openAuthBtn: document.getElementById('openAuthBtn'),
            signOutBtn: document.getElementById('signOutBtn'),
            modal: document.getElementById('authModal'),
            overlay: document.getElementById('authOverlay'),
            closeModalBtn: document.getElementById('closeAuthBtn'),
            googleSignInBtn: document.getElementById('googleSignInBtn'),
            googleSignUpBtn: document.getElementById('googleSignUpBtn'),
            tabs: document.querySelectorAll('.auth-tab'),
            signinForm: document.getElementById('signinForm'),
            signupForm: document.getElementById('signupForm'),
            resetPasswordForm: document.getElementById('resetPasswordForm'),
            forgotPasswordBtn: document.getElementById('forgotPasswordBtn'),
            backToSigninBtn: document.getElementById('backToSigninBtn'),
        };

        authElements.openAuthBtn.addEventListener('click', () => this.toggleAuthModal(true));
        authElements.closeModalBtn.addEventListener('click', () => this.toggleAuthModal(false));
        authElements.overlay.addEventListener('click', () => this.toggleAuthModal(false));
        authElements.signOutBtn.addEventListener('click', () => signOut(auth));
        authElements.googleSignInBtn.addEventListener('click', () => this.signInWithGoogle());
        authElements.googleSignUpBtn.addEventListener('click', () => this.signInWithGoogle());
        authElements.tabs.forEach(tab => tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.tab)));
        authElements.forgotPasswordBtn.addEventListener('click', () => this.switchAuthTab('resetPassword'));
        authElements.backToSigninBtn.addEventListener('click', () => this.switchAuthTab('signin'));
        authElements.signupForm.addEventListener('submit', e => this.handleSignUpWithEmail(e));
        authElements.signinForm.addEventListener('submit', e => this.handleSignInWithEmail(e));
        authElements.resetPasswordForm.addEventListener('submit', e => this.handlePasswordReset(e));
    }

    handleAuthStateChanged(user) {
        clearTimeout(this.headerCollapseTimeout);
        if (user) {
            this.stateManager.setState({ currentUser: user });
            this.updateAuthUI(user);
            console.log("✅ Пользователь вошел:", user.displayName);
            this.loadAndSwitchVocabulary(this.stateManager.getState().currentVocabulary, true);
            this.headerCollapseTimeout = setTimeout(() => this.uiController.collapseMobileHeader(), 3000);
        } else {
            this.stateManager.setState({ currentUser: null });
            this.updateAuthUI(null);
            this.allWords = [];
            this.uiController.showLoginMessage();
            this.handleStateUpdate(); // Обновить UI для неавторизованного состояния
            console.log("🔴 Пользователь вышел.");
            this.uiController.expandMobileHeader();
        }
    }

    // --- МЕТОДЫ-КОНТРОЛЛЕРЫ (логика, вызываемая из UI) ---

    toggleSetting(key) {
        if (this.stateManager.getState().isAutoPlaying) this.lessonEngine.stop();

        let newState = { [key]: !this.stateManager.getState()[key] };
        if (key === 'showMorphemes' && !newState[key]) {
            newState.showMorphemeTranslations = false;
        }
        this.stateManager.setState(newState);

        const word = this.stateManager.getState().currentWord;
        if (word && document.getElementById('wordCard')) {
            this.uiController.renderInitialCard(word);
            const phases = this.lessonEngine.playbackSequence;
            this.uiController.updateCardViewToPhase(word, this.stateManager.getState().currentPhaseIndex, phases);
        }
    }

    toggleLevel(level) {
        const state = this.stateManager.getState();
        if (!state.availableLevels.includes(level)) return;
        const newLevels = state.selectedLevels.includes(level)
            ? (state.selectedLevels.length > 1 ? state.selectedLevels.filter(l => l !== level) : state.selectedLevels)
            : [...state.selectedLevels, level];
        this.stateManager.setState({ selectedLevels: newLevels });
        this.handleFilterChange();
    }

    setTheme(theme) {
        this.stateManager.setState({ selectedTheme: theme });
        this.handleFilterChange();
    }

    setRepeatMode(mode) {
        this.stateManager.setState({ repeatMode: mode });
    }

    setSequenceMode(mode) {
        this.lessonEngine.stop();
        this.stateManager.setState({ sequenceMode: mode });
        this.handleFilterChange();
    }

    // --- УПРАВЛЕНИЕ СЛОВАРЯМИ И ФИЛЬТРАМИ ---

    // ИЗМЕНЕНО: Логика фильтрации теперь использует сервис
    handleFilterChange(isInitialLoad = false) {
        this.lessonEngine.stop();

        // 1. Получаем отфильтрованные слова от сервиса
        const activeWords = this.vocabularyService.filterWords(this.allWords);

        // 2. Передаем готовый список в движок урока
        this.lessonEngine.generatePlaybackSequence(activeWords);

        const { playbackSequence } = this.lessonEngine;

        if (playbackSequence.length > 0) {
            const firstWord = playbackSequence[0];
            // Устанавливаем первое слово в state, lessonEngine начнет с него
            this.stateManager.setState({ currentWord: firstWord, currentPhase: 'initial', currentPhaseIndex: 0 });
            if (isInitialLoad) {
                this.uiController.renderInitialCard(firstWord);
            }
        } else {
            this.stateManager.setState({ currentWord: null });
            this.uiController.showNoWordsMessage('', this.allWords.length > 0);
        }
        this.handleStateUpdate();
    }

    // ИЗМЕНЕНО: Метод полностью переписан для использования VocabularyService
    async loadAndSwitchVocabulary(vocabNameToLoad, isInitialLoad = false) {
        this.lessonEngine.stop();
        this.uiController.showLoadingMessage();

        try {
            // 1. Получаем список словарей через сервис
            const vocabs = await this.vocabularyService.getList();
            this.stateManager.setState({ availableVocabularies: vocabs });

            // 2. Определяем, какой словарь загружать
            let finalVocabName = vocabNameToLoad;
            if (!vocabs.some(v => v.name === finalVocabName)) {
                finalVocabName = vocabs[0]?.name;
                if (!finalVocabName) { throw new Error("Не найдено ни одного словаря."); }
            }

            // 3. Получаем данные словаря через сервис (он сам позаботится о кэше)
            const vocabularyData = await this.vocabularyService.getVocabulary(finalVocabName);

            // 4. Сохраняем данные локально в app.js для дальнейшей работы
            this.allWords = vocabularyData.words;
            this.themeMap = vocabularyData.meta.themes || {};

            // 5. Обновляем состояние и UI
            this.stateManager.setState({ currentVocabulary: finalVocabName });
            this.updateDynamicFilters();
            this.uiController.renderVocabularySelector();
            this.handleFilterChange(isInitialLoad);

        } catch (error) {
            console.error(error);
            this.handleLoadingError(error.message);
        }
    }

    // --- Анимации и UI-процессы, управляемые LessonEngine ---

    async _fadeInNewCard(word, checkAborted) {
        const oldCard = document.getElementById('wordCard');
        if (oldCard) {
            oldCard.classList.add('word-crossfade', 'word-fade-out');
            await delay(DELAYS.CARD_FADE_IN);
            checkAborted();
        }
        this.uiController.renderInitialCard(word);
    }

    async _revealMorphemesPhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_MORPHEMES);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-morphemes');
        this.uiController.displayMorphemesAndTranslations(word);
    }

    async _revealSentencePhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_SENTENCE);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-sentence');
        this.uiController.displaySentence(word);
    }

    async _revealTranslationPhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_TRANSLATION);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-translation');
        this.uiController.displayFinalTranslation(word);
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

    // --- Внутренние методы и утилиты ---

    setupMediaSessionHandlers() {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.setActionHandler('play', () => this.lessonEngine.start());
        navigator.mediaSession.setActionHandler('pause', () => this.lessonEngine.stop());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.lessonEngine.next());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.lessonEngine.previous());
        navigator.mediaSession.setActionHandler('seekforward', () => this.lessonEngine.next());
        navigator.mediaSession.setActionHandler('seekbackward', () => this.lessonEngine.previous());
    }

    handleLoadingError(errorMessage) {
        this.allWords = []; this.themeMap = {};
        this.stateManager.setState({ currentWord: null, availableLevels: [], availableThemes: [] });
        this.uiController.renderThemeButtons(this.themeMap);
        this.uiController.showNoWordsMessage(errorMessage);
        this.uiController.renderVocabularySelector();
        this.handleStateUpdate();
    }

    updateDynamicFilters() {
        const words = this.allWords;
        const availableLevels = [...new Set(words.map(w => w.level).filter(Boolean))].sort();
        let newSelectedLevels = this.stateManager.getState().selectedLevels.filter(l => availableLevels.includes(l));
        if (newSelectedLevels.length === 0 && availableLevels.length > 0) {
            newSelectedLevels = [...availableLevels];
        }
        const availableThemes = [...new Set(words.map(w => w.theme).filter(Boolean))].sort();

        let newSelectedTheme = this.stateManager.getState().selectedTheme;
        if (newSelectedTheme !== 'all' && !availableThemes.includes(newSelectedTheme)) {
            newSelectedTheme = 'all';
        }

        this.stateManager.setState({
            availableLevels,
            selectedLevels: newSelectedLevels,
            availableThemes,
            selectedTheme: newSelectedTheme
        });

        this.uiController.renderThemeButtons(this.themeMap);
    }

    // ВРЕМЕННЫЕ МЕТОДЫ АВТОРИЗАЦИИ
    updateAuthUI(user) {
        const openAuthBtn = document.getElementById('openAuthBtn');
        const userProfile = document.getElementById('userProfile');
        const userDisplayName = document.getElementById('userDisplayName');
        const userEmail = document.getElementById('userEmail');
        const userAvatar = document.getElementById('userAvatar');
        const userInitials = document.getElementById('userInitials');

        if (user) {
            openAuthBtn.style.display = 'none';
            userProfile.style.display = 'flex';
            userDisplayName.textContent = user.displayName || 'Пользователь';
            userEmail.textContent = user.email;

            if (user.photoURL) {
                userAvatar.src = user.photoURL;
                userAvatar.style.display = 'block';
                userInitials.style.display = 'none';
            } else {
                userAvatar.style.display = 'none';
                userInitials.style.display = 'flex';
                userInitials.textContent = (user.displayName || 'U').charAt(0);
            }
        } else {
            openAuthBtn.style.display = 'flex';
            userProfile.style.display = 'none';
        }
    }

    toggleAuthModal(show) {
        const modal = document.getElementById('authModal');
        const overlay = document.getElementById('authOverlay');
        if (show) {
            modal.classList.add('visible');
            overlay.classList.add('visible');
            this.switchAuthTab('signin');
        } else {
            modal.classList.remove('visible');
            overlay.classList.remove('visible');
        }
    }

    async signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
            this.toggleAuthModal(false);
        } catch (error) {
            console.error("Ошибка входа через Google:", error);
            this.uiController.showNotification(`Ошибка: ${error.message}`, 'error');
        }
    }

    async handleSignUpWithEmail(e) {
        e.preventDefault();
        const name = e.target.signupName.value;
        const email = e.target.signupEmail.value;
        const password = e.target.signupPassword.value;
        const passwordConfirm = e.target.signupPasswordConfirm.value;

        if (password !== passwordConfirm) {
            this.uiController.showNotification('Пароли не совпадают!', 'error');
            return;
        }

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, { displayName: name });
            this.toggleAuthModal(false);
            this.uiController.showNotification(`Добро пожаловать, ${name}!`, 'success');
        } catch (error) {
            console.error("Ошибка регистрации:", error);
            this.uiController.showNotification(this.getFirebaseAuthErrorMessage(error), 'error');
        }
    }

    async handleSignInWithEmail(e) {
        e.preventDefault();
        const email = e.target.signinEmail.value;
        const password = e.target.signinPassword.value;

        try {
            await signInWithEmailAndPassword(auth, email, password);
            this.toggleAuthModal(false);
        } catch (error) {
            console.error("Ошибка входа:", error);
            this.uiController.showNotification(this.getFirebaseAuthErrorMessage(error), 'error');
        }
    }

    async handlePasswordReset(e) {
        e.preventDefault();
        const email = e.target.resetEmail.value;
        try {
            await sendPasswordResetEmail(auth, email);
            this.uiController.showNotification('Письмо для сброса пароля отправлено на ваш email.', 'success');
            this.switchAuthTab('signin');
        } catch (error) {
            console.error("Ошибка сброса пароля:", error);
            this.uiController.showNotification(this.getFirebaseAuthErrorMessage(error), 'error');
        }
    }

    switchAuthTab(tabId) {
        document.querySelectorAll('.auth-tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tabId}Tab`);
        });
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabId);
        });
    }

    getFirebaseAuthErrorMessage(error) {
        switch (error.code) {
            case 'auth/email-already-in-use': return 'Этот email уже зарегистрирован.';
            case 'auth/invalid-email': return 'Неверный формат email.';
            case 'auth/weak-password': return 'Пароль слишком слабый (минимум 6 символов).';
            case 'auth/user-not-found':
            case 'auth/wrong-password': return 'Неверный email или пароль.';
            default: return 'Произошла ошибка. Попробуйте снова.';
        }
    }

    repositionAuthContainer() {
        const isMobile = window.innerWidth <= 768;
        const authContainer = document.querySelector('.auth-container');
        if (!authContainer) return;
        const mobileHeader = document.querySelector('.header-mobile');
        const desktopHeader = document.querySelector('.header');
        if (isMobile) {
            if (authContainer.parentElement !== mobileHeader) mobileHeader.appendChild(authContainer);
        } else {
            if (authContainer.parentElement !== desktopHeader) desktopHeader.appendChild(authContainer);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new VocabularyApp();
        app.init();
        window.app = app; // для отладки
        console.log('✅ Приложение инициализировано. Версия:', app.appVersion);
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        document.body.innerHTML = `<div style="text-align:center;padding:50px;"><h1>Произошла ошибка</h1><p>Попробуйте очистить кэш браузера.</p></div>`;
    }
});