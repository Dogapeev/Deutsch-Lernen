// app.js - Версия 5.4.7 (рефакторинг LessonEngine)
"use strict";

// --- ИМПОРТЫ МОДУЛЕЙ ---
import { APP_VERSION, TTS_API_BASE_URL, DELAYS, FIREBASE_CONFIG } from './utils/constants.js';
import { delay } from './utils/helpers.js';
import { AudioEngine } from './core/AudioEngine.js';
import { StateManager } from './core/StateManager.js';
import { LessonEngine } from './core/LessonEngine.js';

// --- НОВАЯ МОДУЛЬНАЯ ИНИЦИАЛИЗАЦИЯ FIREBASE ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

// Инициализируем Firebase и получаем доступ к сервисам
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

class VocabularyApp {

    constructor() {
        this.appVersion = APP_VERSION;
        this.allWords = [];
        this.vocabulariesCache = {};
        this.themeMap = {};
        this.elements = {};
        this.lastScrollY = 0;
        this.headerCollapseTimeout = null;

        // --- ИНИЦИАЛИЗАЦИЯ ОСНОВНЫХ МОДУЛЕЙ ---
        this.audioEngine = new AudioEngine();
        this.stateManager = new StateManager();

        const uiBridge = {
            renderInitialCard: (...args) => this.renderInitialCard(...args),
            showNoWordsMessage: (...args) => this.showNoWordsMessage(...args),
            updateCardViewToPhase: (...args) => this.updateCardViewToPhase(...args),
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

        this.state = this.stateManager.getState();
        this.stateManager.subscribe(newState => this.handleStateUpdate(newState));
    }

    init() {
        this.stateManager.init();
        this.state = this.stateManager.getState();

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
        this.setupMediaSessionHandlers();
        onAuthStateChanged(auth, user => this.handleAuthStateChanged(user));
    }

    handleStateUpdate(newState) {
        this.state = newState;
        this.updateUI();
    }

    setupMediaSessionHandlers() {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.setActionHandler('play', () => this.lessonEngine.start());
        navigator.mediaSession.setActionHandler('pause', () => this.lessonEngine.stop());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.lessonEngine.next());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.lessonEngine.previous());
        navigator.mediaSession.setActionHandler('seekforward', () => this.lessonEngine.next());
        navigator.mediaSession.setActionHandler('seekbackward', () => this.lessonEngine.previous());
    }

    bindEvents() {
        document.getElementById('settingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(true));
        document.getElementById('closeSettingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(false));
        this.elements.settingsOverlay.addEventListener('click', () => this.toggleSettingsPanel(false));

        document.querySelectorAll('[id^=toggleButton]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.lessonEngine.toggle(); }));
        document.querySelectorAll('[id^=prevButton]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.lessonEngine.previous(); }));
        document.querySelectorAll('[id^=nextButton]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.lessonEngine.next(); }));

        document.querySelectorAll('[id^=soundToggle]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.toggleSetting('soundEnabled'); }));
        document.querySelectorAll('[id^=translationSoundToggle]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.toggleSetting('translationSoundEnabled'); }));
        document.querySelectorAll('[id^=sentenceSoundToggle]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.toggleSetting('sentenceSoundEnabled'); }));
        document.querySelectorAll('[id^=toggleArticles]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.toggleSetting('showArticles'); }));
        document.querySelectorAll('[id^=toggleMorphemes]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.toggleSetting('showMorphemes'); }));
        document.querySelectorAll('[id^=toggleMorphemeTranslations]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.toggleSetting('showMorphemeTranslations'); }));
        document.querySelectorAll('[id^=toggleSentences]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.toggleSetting('showSentences'); }));

        document.querySelectorAll('.level-btn').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); this.toggleLevel(e.target.dataset.level); }));
        document.querySelectorAll('.repeat-selector, .repeat-selector-mobile').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); this.setRepeatMode(parseInt(e.currentTarget.dataset.mode)); }));
        document.querySelectorAll('.sequence-selector, .sequence-selector-mobile').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); this.setSequenceMode(e.currentTarget.dataset.mode); }));
        document.querySelectorAll('[id^=vocabularySelector]').forEach(sel => sel.addEventListener('change', e => this.loadAndSwitchVocabulary(e.target.value)));

        this.elements.auth.openAuthBtn.addEventListener('click', () => this.toggleAuthModal(true));
        this.elements.auth.closeModalBtn.addEventListener('click', () => this.toggleAuthModal(false));
        this.elements.auth.overlay.addEventListener('click', () => this.toggleAuthModal(false));
        this.elements.auth.signOutBtn.addEventListener('click', () => signOut(auth));
        this.elements.auth.googleSignInBtn.addEventListener('click', () => this.signInWithGoogle());
        this.elements.auth.googleSignUpBtn.addEventListener('click', () => this.signInWithGoogle());
        this.elements.auth.tabs.forEach(tab => tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.tab)));
        this.elements.auth.forgotPasswordBtn.addEventListener('click', () => this.switchAuthTab('resetPassword'));
        this.elements.auth.backToSigninBtn.addEventListener('click', () => this.switchAuthTab('signin'));
        this.elements.auth.signupForm.addEventListener('submit', e => this.handleSignUpWithEmail(e));
        this.elements.auth.signinForm.addEventListener('submit', e => this.handleSignInWithEmail(e));
        this.elements.auth.resetPasswordForm.addEventListener('submit', e => this.handlePasswordReset(e));

        window.addEventListener('resize', () => this.repositionAuthContainer());
        window.addEventListener('scroll', () => this.handleScroll());
        this.elements.mainContent.addEventListener('click', () => this.lessonEngine.toggle());
    }

    // --- МЕТОДЫ-КОНТРОЛЛЕРЫ НАСТРОЕК ---

    toggleSetting(key) {
        if (this.state.isAutoPlaying) this.lessonEngine.stop();

        let newState = { [key]: !this.state[key] };
        if (key === 'showMorphemes' && !newState[key]) {
            newState.showMorphemeTranslations = false;
        }
        this.stateManager.setState(newState);

        const word = this.state.currentWord;
        if (word && document.getElementById('wordCard')) {
            this.renderInitialCard(word);
            // Восстанавливаем визуальное состояние карточки до текущей фазы
            const phases = this.lessonEngine.playbackSequence; // Это не совсем верно, но для простоты пока оставим
            this.updateCardViewToPhase(word, this.state.currentPhaseIndex, phases);
        }
    }

    toggleLevel(level) {
        if (!this.state.availableLevels.includes(level)) return;
        const newLevels = this.state.selectedLevels.includes(level)
            ? (this.state.selectedLevels.length > 1 ? this.state.selectedLevels.filter(l => l !== level) : this.state.selectedLevels)
            : [...this.state.selectedLevels, level];
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

    handleFilterChange(isInitialLoad = false) {
        this.lessonEngine.stop();
        this.lessonEngine.generatePlaybackSequence(this.allWords);

        const { playbackSequence } = this.lessonEngine;

        if (playbackSequence.length > 0) {
            const firstWord = playbackSequence[0];
            this.stateManager.setState({ currentWord: firstWord, currentPhase: 'initial', currentPhaseIndex: 0 });
            this.renderInitialCard(firstWord);
        } else {
            this.stateManager.setState({ currentWord: null });
            this.showNoWordsMessage();
        }
        this.updateNavigationButtons();
    }

    async loadAndSwitchVocabulary(vocabNameToLoad, isInitialLoad = false) {
        this.lessonEngine.stop();
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>Загрузка...</p></div>`;
        if (this.state.availableVocabularies.length === 0) {
            try {
                const response = await fetch(`${TTS_API_BASE_URL}/api/vocabularies/list`);
                if (!response.ok) throw new Error('Сервер не отвечает.');
                const vocabs = await response.json();
                if (!vocabs || vocabs.length === 0) throw new Error('На сервере нет словарей.');
                this.stateManager.setState({ availableVocabularies: vocabs });
            } catch (error) {
                console.error(error); this.handleLoadingError(error.message); return;
            }
        }
        let finalVocabName = vocabNameToLoad;
        const vocabExists = this.state.availableVocabularies.some(v => v.name === finalVocabName);
        if (!vocabExists) {
            finalVocabName = this.state.availableVocabularies[0]?.name;
            if (!finalVocabName) { this.handleLoadingError("Не найдено ни одного словаря."); return; }
        }
        try {
            await this.fetchVocabularyData(finalVocabName);
            const vocabularyData = this.vocabulariesCache[finalVocabName];
            if (!vocabularyData) throw new Error("Кэш не найден.");
            this.allWords = vocabularyData.words;
            this.themeMap = vocabularyData.meta.themes || {};
        } catch (error) {
            console.error(`Ошибка загрузки словаря "${finalVocabName}":`, error);
            this.handleLoadingError(`Не удалось загрузить словарь: ${finalVocabName}.`);
            return;
        }
        this.stateManager.setState({ currentVocabulary: finalVocabName });
        this.updateDynamicFilters();
        this.renderVocabularySelector();
        this.handleFilterChange(isInitialLoad);
    }

    async fetchVocabularyData(vocabName) {
        if (this.vocabulariesCache[vocabName]) return;
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>Загружаю: ${vocabName}...</p></div>`;
        const response = await fetch(`${TTS_API_BASE_URL}/api/vocabulary/${vocabName}`);
        if (!response.ok) throw new Error(`Ошибка сервера ${response.status}`);
        const data = await response.json();
        const words = Array.isArray(data) ? data : data.words;
        if (!words) throw new Error(`Неверный формат словаря "${vocabName}"`);
        this.vocabulariesCache[vocabName] = {
            words: words.map((w, i) => ({ ...w, id: w.id || `${vocabName}_word_${Date.now()}_${i}` })),
            meta: data.meta || { themes: {} }
        };
    }

    handleLoadingError(errorMessage) {
        this.allWords = []; this.themeMap = {};
        this.stateManager.setState({ currentWord: null, availableLevels: [], availableThemes: [] });
        this.renderThemeButtons();
        this.showNoWordsMessage(errorMessage);
        this.renderVocabularySelector();
        this.updateUI();
    }

    // --- АВТОРИЗАЦИЯ И UI --- (Без изменений)
    handleAuthStateChanged(user) {
        clearTimeout(this.headerCollapseTimeout);
        if (user) {
            this.stateManager.setState({ currentUser: user });
            this.updateAuthUI(user);
            console.log("✅ Пользователь вошел:", user.displayName);
            this.loadAndSwitchVocabulary(this.state.currentVocabulary, true);
            this.headerCollapseTimeout = setTimeout(() => this.collapseMobileHeader(), 3000);
        } else {
            this.stateManager.setState({ currentUser: null });
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
            this.switchAuthTab('signin');
        } else {
            this.elements.auth.modal.classList.remove('visible');
            this.elements.auth.overlay.classList.remove('visible');
        }
    }

    async signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
            this.toggleAuthModal(false);
        } catch (error) {
            console.error("Ошибка входа через Google:", error);
            this.showNotification(`Ошибка: ${error.message}`, 'error');
        }
    }

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
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, { displayName: name });
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
            await signInWithEmailAndPassword(auth, email, password);
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
            await sendPasswordResetEmail(auth, email);
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
            case 'auth/email-already-in-use': return 'Этот email уже зарегистрирован.';
            case 'auth/invalid-email': return 'Неверный формат email.';
            case 'auth/weak-password': return 'Пароль слишком слабый (минимум 6 символов).';
            case 'auth/user-not-found':
            case 'auth/wrong-password': return 'Неверный email или пароль.';
            default: return 'Произошла ошибка. Попробуйте снова.';
        }
    }

    showNotification(message, type = 'info') {
        const notification = this.elements.notification;
        if (!notification) return;
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('visible');
        setTimeout(() => { notification.classList.remove('visible'); }, 4000);
    }

    repositionAuthContainer() {
        const isMobile = window.innerWidth <= 768;
        const authContainer = this.elements.auth.container;
        if (!authContainer) return;
        const mobileHeader = this.elements.headerMobile;
        const desktopHeader = document.querySelector('.header');
        if (isMobile) {
            if (authContainer.parentElement !== mobileHeader) mobileHeader.appendChild(authContainer);
        } else {
            if (authContainer.parentElement !== desktopHeader) desktopHeader.appendChild(authContainer);
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

    collapseMobileHeader() { this.elements.headerMobile?.classList.add('collapsed'); }
    expandMobileHeader() { this.elements.headerMobile?.classList.remove('collapsed'); }

    showLoginMessage() {
        this.lessonEngine.stop();
        const msg = 'Войдите в аккаунт, чтобы создавать свои словари и отслеживать прогресс.';
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${msg}</p></div>`;
        this.stateManager.setState({ currentWord: null });
        this.updateUI();
    }

    // --- UI-МЕТОДЫ (Останутся здесь до создания UIController) ---

    async _fadeInNewCard(word, checkAborted) {
        const oldCard = document.getElementById('wordCard');
        if (oldCard) {
            oldCard.classList.add('word-crossfade', 'word-fade-out');
            await delay(DELAYS.CARD_FADE_IN);
            checkAborted();
        }
        this.renderInitialCard(word);
    }

    async _revealMorphemesPhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_MORPHEMES);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-morphemes');
        this.displayMorphemesAndTranslations(word);
    }

    async _revealSentencePhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_SENTENCE);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-sentence');
        this.displaySentence(word);
    }

    async _revealTranslationPhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_TRANSLATION);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-translation');
        this.displayFinalTranslation(word);
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

    updateUI() {
        if (!this.elements.mainContent) return;
        this.setupIcons(); this.updateStats(); this.updateControlButtons();
        this.updateNavigationButtons(); this.updateLevelButtons();
        this.updateThemeButtons(); this.updateRepeatControlsState();
    }

    renderInitialCard(word) {
        if (!word) { this.showNoWordsMessage(); return; }
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
        // this.updateUI(); // Вызывается из handleStateUpdate, здесь может быть лишним
    }

    showNoWordsMessage(customMessage = '') {
        const msg = customMessage || (this.allWords.length > 0 ? 'Нет слов для выбранных фильтров.' : 'Загрузка словаря...');
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${msg}</p></div>`;
    }

    updateDynamicFilters() {
        const words = this.allWords;
        const availableLevels = [...new Set(words.map(w => w.level).filter(Boolean))].sort();
        let newSelectedLevels = this.state.selectedLevels.filter(l => availableLevels.includes(l));
        if (newSelectedLevels.length === 0 && availableLevels.length > 0) {
            newSelectedLevels = [...availableLevels];
        }
        const availableThemes = [...new Set(words.map(w => w.theme).filter(Boolean))].sort();

        let newSelectedTheme = this.state.selectedTheme;
        if (newSelectedTheme !== 'all' && !availableThemes.includes(newSelectedTheme)) {
            newSelectedTheme = 'all';
        }

        this.stateManager.setState({
            availableLevels,
            selectedLevels: newSelectedLevels,
            availableThemes,
            selectedTheme: newSelectedTheme
        });

        this.renderThemeButtons();
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

    updateCardViewToPhase(word, phaseIndex, phases) {
        if (!document.getElementById('wordCard')) { this.renderInitialCard(word); }
        const card = document.getElementById('wordCard');
        if (!card || !phases || phases.length === 0) return;

        let morphemesRevealed = false;
        let sentenceRevealed = false;

        for (let i = 0; i < phaseIndex; i++) {
            const taskName = phases[i].task.toString();
            if (taskName.includes('revealMorphemesPhase')) morphemesRevealed = true;
            if (taskName.includes('revealSentencePhase')) sentenceRevealed = true;
        }

        if (morphemesRevealed) {
            card.classList.add('phase-morphemes');
            this.displayMorphemesAndTranslations(word);
        }
        if (sentenceRevealed) {
            card.classList.add('phase-sentence');
            this.displaySentence(word);
        }
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

    updateStats() {
        if (this.elements.totalWords) this.elements.totalWords.textContent = this.getActiveWords().length;
        if (this.elements.studiedToday) this.elements.studiedToday.textContent = this.state.studiedToday;
    }

    updateNavigationButtons() {
        const canNavigate = this.lessonEngine.playbackSequence.length > 1;
        document.querySelectorAll('[id^=prevButton]').forEach(btn => btn.disabled = !canNavigate);
        document.querySelectorAll('[id^=nextButton]').forEach(btn => btn.disabled = !canNavigate);
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

    getActiveWords() {
        const { selectedLevels, selectedTheme } = this.state;
        if (!this.allWords || this.allWords.length === 0) return [];
        return this.allWords.filter(w => w?.level && selectedLevels.includes(w.level) && (selectedTheme === 'all' || w.theme === selectedTheme));
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