// --- НАЧАЛО ФАЙЛА APP.JS ---

// app.js - Версия 5.1.0 (Apple Watch Control Support)
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
const APP_VERSION = '5.1.0';
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
        this.blockAudioPlayer = null; // Новый плеер для блокового трека
        this.audioContext = null;
        this.blockAudioSource = null;
        this.themeMap = {};
        this.elements = {};
        this.lastScrollY = 0;
        this.headerCollapseTimeout = null;

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

        // Создаем блоковый аудио-плеер программно
        this.blockAudioPlayer = document.createElement('audio');
        this.blockAudioPlayer.id = 'blockAudioPlayer';
        this.blockAudioPlayer.loop = true;
        document.body.appendChild(this.blockAudioPlayer);

        // Инициализируем Web Audio API для генерации тона
        this.initAudioContext();

        // Инициализируем MediaSession для управления с часов
        this.initMediaSession();

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

    // --- НОВЫЕ МЕТОДЫ ДЛЯ РАБОТЫ С AUDIO CONTEXT И MEDIASESSION ---

    initAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('✅ Audio Context инициализирован');
        } catch (e) {
            console.error('❌ Ошибка инициализации Audio Context:', e);
        }
    }

    async generateBlockAudio() {
        if (!this.audioContext) return null;

        try {
            // Создаем буфер на 30 секунд
            const duration = 30;
            const sampleRate = this.audioContext.sampleRate;
            const buffer = this.audioContext.createBuffer(1, duration * sampleRate, sampleRate);
            const data = buffer.getChannelData(0);

            // Генерируем тихий низкочастотный тон (80 Hz)
            const frequency = 80;
            const amplitude = 0.03; // Очень тихо

            for (let i = 0; i < buffer.length; i++) {
                data[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
            }

            // Конвертируем буфер в blob и создаем URL
            const audioBlob = await this.bufferToWave(buffer, buffer.length);
            const audioUrl = URL.createObjectURL(audioBlob);

            return audioUrl;
        } catch (e) {
            console.error('❌ Ошибка генерации блокового аудио:', e);
            return null;
        }
    }

    bufferToWave(abuffer, len) {
        const numOfChan = abuffer.numberOfChannels;
        const length = len * numOfChan * 2 + 44;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        const channels = [];
        let sample;
        let offset = 0;
        let pos = 0;

        // WAV header
        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8); // file length - 8
        setUint32(0x45564157); // "WAVE"
        setUint32(0x20746d66); // "fmt " chunk
        setUint32(16); // length = 16
        setUint16(1); // PCM (uncompressed)
        setUint16(numOfChan);
        setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
        setUint16(numOfChan * 2); // block-align
        setUint16(16); // 16-bit
        setUint32(0x61746164); // "data" - chunk
        setUint32(length - pos - 4); // chunk length

        // Write interleaved data
        for (let i = 0; i < abuffer.numberOfChannels; i++)
            channels.push(abuffer.getChannelData(i));

        while (pos < length) {
            for (let i = 0; i < numOfChan; i++) {
                sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++;
        }

        return new Blob([buffer], { type: "audio/wav" });

        function setUint16(data) {
            view.setUint16(pos, data, true);
            pos += 2;
        }

        function setUint32(data) {
            view.setUint32(pos, data, true);
            pos += 4;
        }
    }

    initMediaSession() {
        if (!('mediaSession' in navigator)) {
            console.log('⚠️ MediaSession API не поддерживается');
            return;
        }

        console.log('✅ Инициализация MediaSession для управления с Apple Watch');

        // Устанавливаем обработчики для кнопок на часах
        navigator.mediaSession.setActionHandler('play', () => {
            console.log('▶️ Play с часов');
            this.startAutoPlay();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            console.log('⏸️ Pause с часов');
            this.stopAutoPlay();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
            console.log('⏭️ Next с часов');
            this.nextWord();
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
            console.log('⏮️ Previous с часов');
            this.prevWord();
        });

        // Опционально: seekbackward и seekforward
        navigator.mediaSession.setActionHandler('seekbackward', () => {
            console.log('⏪ Seek backward с часов');
            this.prevWord();
        });

        navigator.mediaSession.setActionHandler('seekforward', () => {
            console.log('⏩ Seek forward с часов');
            this.nextWord();
        });
    }

    updateMediaSessionMetadata(word) {
        if (!('mediaSession' in navigator) || !word) return;

        const parsed = this.parseGermanWord(word);
        const germanWord = word.german || '';
        const translation = word.russian || '';

        navigator.mediaSession.metadata = new MediaMetadata({
            title: germanWord,
            artist: translation,
            album: `${word.level || ''} - Deutsch Lernen`,
            artwork: [
                {
                    src: 'https://via.placeholder.com/512x512.png?text=DE',
                    sizes: '512x512',
                    type: 'image/png'
                }
            ]
        });

        // Устанавливаем статус воспроизведения
        navigator.mediaSession.playbackState = this.state.isAutoPlaying ? 'playing' : 'paused';
    }

    async startBlockAudio() {
        if (!this.blockAudioPlayer) return;

        try {
            // Генерируем аудио если еще не сгенерировано
            if (!this.blockAudioPlayer.src) {
                const audioUrl = await this.generateBlockAudio();
                if (audioUrl) {
                    this.blockAudioPlayer.src = audioUrl;
                    this.blockAudioPlayer.volume = 0.05; // Очень тихо
                }
            }

            await this.blockAudioPlayer.play();
            console.log('✅ Блоковый трек запущен');
        } catch (e) {
            console.error('❌ Ошибка запуска блокового трека:', e);
        }
    }

    stopBlockAudio() {
        if (!this.blockAudioPlayer) return;

        this.blockAudioPlayer.pause();
        this.blockAudioPlayer.currentTime = 0;
        console.log('⏹️ Блоковый трек остановлен');
    }

    // --- КОНЕЦ НОВЫХ МЕТОДОВ ---

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
            this.elements.auth.modal.style.display = 'flex';
            this.elements.auth.overlay.style.display = 'block';
            setTimeout(() => {
                this.elements.auth.modal.classList.add('show');
                this.elements.auth.overlay.classList.add('show');
            }, 10);
        } else {
            this.elements.auth.modal.classList.remove('show');
            this.elements.auth.overlay.classList.remove('show');
            setTimeout(() => {
                this.elements.auth.modal.style.display = 'none';
                this.elements.auth.overlay.style.display = 'none';
            }, 300);
        }
    }

    async handleGoogleSignIn(isSignUp = false) {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await auth.signInWithPopup(provider);
            this.toggleAuthModal(false);
            this.showNotification(isSignUp ? '✅ Регистрация через Google успешна!' : '✅ Вход через Google выполнен!', 'success');
        } catch (error) {
            console.error('Ошибка Google Auth:', error);
            this.showNotification(`❌ Ошибка: ${error.message}`, 'error');
        }
    }

    async handleEmailSignIn(email, password) {
        try {
            await auth.signInWithEmailAndPassword(email, password);
            this.toggleAuthModal(false);
            this.showNotification('✅ Вход выполнен!', 'success');
        } catch (error) {
            console.error('Ошибка входа:', error);
            let message = 'Ошибка входа';
            if (error.code === 'auth/user-not-found') message = 'Пользователь не найден';
            else if (error.code === 'auth/wrong-password') message = 'Неверный пароль';
            else if (error.code === 'auth/invalid-email') message = 'Неверный формат email';
            this.showNotification(`❌ ${message}`, 'error');
        }
    }

    async handleEmailSignUp(email, password, displayName) {
        try {
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            await userCredential.user.updateProfile({ displayName: displayName || 'Пользователь' });
            this.toggleAuthModal(false);
            this.showNotification('✅ Регистрация успешна!', 'success');
        } catch (error) {
            console.error('Ошибка регистрации:', error);
            let message = 'Ошибка регистрации';
            if (error.code === 'auth/email-already-in-use') message = 'Email уже используется';
            else if (error.code === 'auth/weak-password') message = 'Слишком слабый пароль';
            else if (error.code === 'auth/invalid-email') message = 'Неверный формат email';
            this.showNotification(`❌ ${message}`, 'error');
        }
    }

    async handlePasswordReset(email) {
        try {
            await auth.sendPasswordResetEmail(email);
            this.showNotification('✅ Письмо для сброса пароля отправлено!', 'success');
            this.switchAuthTab('signin');
        } catch (error) {
            console.error('Ошибка сброса пароля:', error);
            let message = 'Ошибка сброса пароля';
            if (error.code === 'auth/user-not-found') message = 'Пользователь не найден';
            else if (error.code === 'auth/invalid-email') message = 'Неверный формат email';
            this.showNotification(`❌ ${message}`, 'error');
        }
    }

    async handleSignOut() {
        try {
            await auth.signOut();
            this.showNotification('✅ Вы вышли из аккаунта', 'success');
        } catch (error) {
            console.error('Ошибка выхода:', error);
            this.showNotification('❌ Ошибка при выходе', 'error');
        }
    }

    switchAuthTab(tabName) {
        this.elements.auth.tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        this.elements.auth.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}Tab`);
        });
    }

    bindEvents() {
        if (this.elements.auth.openAuthBtn) {
            this.elements.auth.openAuthBtn.addEventListener('click', () => this.toggleAuthModal(true));
        }
        if (this.elements.auth.closeModalBtn) {
            this.elements.auth.closeModalBtn.addEventListener('click', () => this.toggleAuthModal(false));
        }
        if (this.elements.auth.overlay) {
            this.elements.auth.overlay.addEventListener('click', () => this.toggleAuthModal(false));
        }
        if (this.elements.auth.signOutBtn) {
            this.elements.auth.signOutBtn.addEventListener('click', () => this.handleSignOut());
        }

        this.elements.auth.tabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.tab));
        });

        if (this.elements.auth.googleSignInBtn) {
            this.elements.auth.googleSignInBtn.addEventListener('click', () => this.handleGoogleSignIn(false));
        }
        if (this.elements.auth.googleSignUpBtn) {
            this.elements.auth.googleSignUpBtn.addEventListener('click', () => this.handleGoogleSignIn(true));
        }

        if (this.elements.auth.signinForm) {
            this.elements.auth.signinForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const email = e.target.querySelector('input[type="email"]').value;
                const password = e.target.querySelector('input[type="password"]').value;
                this.handleEmailSignIn(email, password);
            });
        }

        if (this.elements.auth.signupForm) {
            this.elements.auth.signupForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const name = e.target.querySelector('input[placeholder="Имя"]').value;
                const email = e.target.querySelector('input[type="email"]').value;
                const password = e.target.querySelector('input[type="password"]').value;
                this.handleEmailSignUp(email, password, name);
            });
        }

        if (this.elements.auth.resetPasswordForm) {
            this.elements.auth.resetPasswordForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const email = e.target.querySelector('input[type="email"]').value;
                this.handlePasswordReset(email);
            });
        }

        if (this.elements.auth.forgotPasswordBtn) {
            this.elements.auth.forgotPasswordBtn.addEventListener('click', () => this.switchAuthTab('reset'));
        }
        if (this.elements.auth.backToSigninBtn) {
            this.elements.auth.backToSigninBtn.addEventListener('click', () => this.switchAuthTab('signin'));
        }

        document.querySelectorAll('.level-btn').forEach(btn => {
            btn.addEventListener('click', () => this.toggleLevel(btn.dataset.level));
        });
        document.querySelectorAll('.block-btn[data-theme]').forEach(btn => {
            btn.addEventListener('click', () => this.setTheme(btn.dataset.theme));
        });
        document.querySelectorAll('.repeat-selector, .repeat-selector-mobile').forEach(btn => {
            btn.addEventListener('click', () => this.setRepeatMode(parseInt(btn.dataset.mode)));
        });
        document.querySelectorAll('.sequence-selector, .sequence-selector-mobile').forEach(btn => {
            btn.addEventListener('click', () => this.setSequenceMode(btn.dataset.mode));
        });
        document.querySelectorAll('[id^=playPauseButton]').forEach(btn => {
            btn.addEventListener('click', () => this.togglePlay());
        });
        document.querySelectorAll('[id^=prevButton]').forEach(btn => {
            btn.addEventListener('click', () => this.prevWord());
        });
        document.querySelectorAll('[id^=nextButton]').forEach(btn => {
            btn.addEventListener('click', () => this.nextWord());
        });
        document.querySelectorAll('[id^=settingsButton]').forEach(btn => {
            btn.addEventListener('click', () => this.toggleSettingsPanel(true));
        });
        document.querySelectorAll('[id^=closeSettings]').forEach(btn => {
            btn.addEventListener('click', () => this.toggleSettingsPanel(false));
        });
        if (this.elements.settingsOverlay) {
            this.elements.settingsOverlay.addEventListener('click', () => this.toggleSettingsPanel(false));
        }

        const toggles = [
            { id: 'soundToggle', key: 'soundEnabled' },
            { id: 'translationSoundToggle', key: 'translationSoundEnabled' },
            { id: 'sentenceSoundToggle', key: 'sentenceSoundEnabled' },
            { id: 'articlesToggle', key: 'showArticles' },
            { id: 'morphemesToggle', key: 'showMorphemes' },
            { id: 'morphemeTranslationsToggle', key: 'showMorphemeTranslations' },
            { id: 'sentencesToggle', key: 'showSentences' }
        ];
        toggles.forEach(({ id, key }) => {
            document.querySelectorAll(`[id^=${id}]`).forEach(toggle => {
                toggle.addEventListener('change', () => {
                    this.setState({ [key]: toggle.checked });
                    this.handleVisibilityChange();
                });
            });
        });

        document.querySelectorAll('.vocabulary-option').forEach(el => {
            el.addEventListener('click', (e) => {
                const vocabName = e.currentTarget.dataset.vocab;
                if (vocabName) this.loadAndSwitchVocabulary(vocabName);
            });
        });

        if (this.elements.headerMobile) {
            let lastY = window.scrollY;
            window.addEventListener('scroll', () => {
                const currentY = window.scrollY;
                if (!this.state.currentUser) return;
                if (currentY > lastY && currentY > 50) this.collapseMobileHeader();
                else if (currentY < lastY) this.expandMobileHeader();
                lastY = currentY;
            }, { passive: true });
        }
    }

    repositionAuthContainer() {
        const authContainer = this.elements.auth?.container;
        const headerMobile = this.elements.headerMobile;
        if (!authContainer || !headerMobile) return;
        const handleResize = () => {
            if (window.innerWidth <= 768) {
                if (authContainer.parentElement !== headerMobile) {
                    headerMobile.insertBefore(authContainer, headerMobile.firstChild);
                }
            } else {
                const headerMain = document.querySelector('.header-main');
                if (headerMain && authContainer.parentElement !== headerMain) {
                    const rightSection = headerMain.querySelector('.header-right');
                    if (rightSection) rightSection.appendChild(authContainer);
                }
            }
        };
        handleResize();
        window.addEventListener('resize', handleResize);
    }

    collapseMobileHeader() {
        if (this.elements.headerMobile) {
            this.elements.headerMobile.classList.add('collapsed');
        }
    }

    expandMobileHeader() {
        if (this.elements.headerMobile) {
            this.elements.headerMobile.classList.remove('collapsed');
        }
    }

    loadStateFromLocalStorage() {
        const saved = localStorage.getItem('vocabularyAppState');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                Object.keys(parsed).forEach(key => {
                    if (key in this.state && key !== 'currentUser' && key !== 'isAutoPlaying' && key !== 'currentWord' && key !== 'currentPhase') {
                        this.state[key] = parsed[key];
                    }
                });
            } catch (e) {
                console.error('Ошибка загрузки состояния:', e);
            }
        }
    }

    saveStateToLocalStorage() {
        try {
            const toSave = { ...this.state };
            delete toSave.currentUser;
            delete toSave.isAutoPlaying;
            delete toSave.currentWord;
            delete toSave.currentPhase;
            localStorage.setItem('vocabularyAppState', JSON.stringify(toSave));
        } catch (e) {
            console.error('Ошибка сохранения состояния:', e);
        }
    }

    runMigrations() {
        const oldVocabs = localStorage.getItem('vocabularies');
        if (oldVocabs) {
            localStorage.removeItem('vocabularies');
        }
    }

    setState(newState) {
        Object.assign(this.state, newState);
        this.saveStateToLocalStorage();
        this.updateUI();
    }

    updateUI() {
        this.updateStats();
        this.updateNavigationButtons();
        this.updateLevelButtons();
        this.updateThemeButtons();
        this.updateRepeatControlsState();
        this.updatePlayPauseButtons();
        this.syncToggles();
        this.updateVocabularyListUI();

        // Обновляем MediaSession метаданные при изменении текущего слова
        if (this.state.currentWord) {
            this.updateMediaSessionMetadata(this.state.currentWord);
        }
    }

    syncToggles() {
        const toggles = {
            soundToggle: 'soundEnabled',
            translationSoundToggle: 'translationSoundEnabled',
            sentenceSoundToggle: 'sentenceSoundEnabled',
            articlesToggle: 'showArticles',
            morphemesToggle: 'showMorphemes',
            morphemeTranslationsToggle: 'showMorphemeTranslations',
            sentencesToggle: 'showSentences'
        };
        Object.entries(toggles).forEach(([id, key]) => {
            document.querySelectorAll(`[id^=${id}]`).forEach(toggle => {
                toggle.checked = this.state[key];
            });
        });
    }

    updatePlayPauseButtons() {
        document.querySelectorAll('[id^=playPauseButton]').forEach(btn => {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = this.state.isAutoPlaying ? 'fas fa-pause' : 'fas fa-play';
            }
        });
    }

    showNotification(message, type = 'info') {
        if (!this.elements.notification) return;
        this.elements.notification.textContent = message;
        this.elements.notification.className = `notification ${type} show`;
        setTimeout(() => {
            this.elements.notification.classList.remove('show');
        }, 3000);
    }

    async loadAndSwitchVocabulary(vocabName, forceReload = false) {
        if (!this.state.currentUser) {
            console.log('⚠️ Пользователь не авторизован');
            return;
        }

        const userId = this.state.currentUser.uid;
        const cacheKey = `${userId}_${vocabName}`;

        if (!forceReload && this.vocabulariesCache[cacheKey]) {
            console.log(`📦 Загрузка словаря "${vocabName}" из кэша`);
            this.allWords = this.vocabulariesCache[cacheKey];
            this.setState({ currentVocabulary: vocabName });
            this.processVocabulary();
            return;
        }

        try {
            const docRef = db.collection('users').doc(userId).collection('vocabularies').doc(vocabName);
            const doc = await docRef.get();

            if (doc.exists) {
                const data = doc.data();
                this.allWords = data.words || [];
                this.vocabulariesCache[cacheKey] = this.allWords;
                console.log(`✅ Словарь "${vocabName}" загружен:`, this.allWords.length, 'слов');
                this.setState({ currentVocabulary: vocabName });
                this.processVocabulary();
            } else {
                console.log(`⚠️ Словарь "${vocabName}" не найден. Загружаем дефолтный.`);
                await this.loadDefaultVocabulary(vocabName);
            }
        } catch (error) {
            console.error(`❌ Ошибка загрузки словаря "${vocabName}":`, error);
            this.showNotification('Ошибка загрузки словаря', 'error');
        }
    }

    async loadDefaultVocabulary(vocabName) {
        if (!this.state.currentUser) return;
        const userId = this.state.currentUser.uid;

        try {
            const response = await fetch(`/${vocabName}.json`);
            if (!response.ok) throw new Error(`Не удалось загрузить ${vocabName}.json`);

            const data = await response.json();
            const words = data.words || [];

            const docRef = db.collection('users').doc(userId).collection('vocabularies').doc(vocabName);
            await docRef.set({ words, lastModified: firebase.firestore.FieldValue.serverTimestamp() });

            this.allWords = words;
            const cacheKey = `${userId}_${vocabName}`;
            this.vocabulariesCache[cacheKey] = words;
            console.log(`✅ Дефолтный словарь "${vocabName}" загружен и сохранен:`, words.length, 'слов');
            this.setState({ currentVocabulary: vocabName });
            this.processVocabulary();
        } catch (error) {
            console.error(`❌ Ошибка загрузки дефолтного словаря "${vocabName}":`, error);
            this.showNotification('Ошибка загрузки словаря', 'error');
        }
    }

    async loadAvailableVocabularies() {
        if (!this.state.currentUser) return;
        const userId = this.state.currentUser.uid;

        try {
            const snapshot = await db.collection('users').doc(userId).collection('vocabularies').get();
            const vocabNames = snapshot.docs.map(doc => doc.id);
            this.setState({ availableVocabularies: vocabNames });
            console.log('✅ Доступные словари:', vocabNames);
        } catch (error) {
            console.error('❌ Ошибка загрузки списка словарей:', error);
        }
    }

    updateVocabularyListUI() {
        const containers = document.querySelectorAll('.vocabulary-list');
        containers.forEach(container => {
            container.innerHTML = '';
            this.state.availableVocabularies.forEach(vocabName => {
                const div = document.createElement('div');
                div.className = `vocabulary-option ${vocabName === this.state.currentVocabulary ? 'active' : ''}`;
                div.dataset.vocab = vocabName;
                div.innerHTML = `<span>${vocabName}</span>`;
                div.addEventListener('click', () => this.loadAndSwitchVocabulary(vocabName));
                container.appendChild(div);
            });
        });
    }

    processVocabulary() {
        this.extractLevelsAndThemes();
        this.updateUI();
        this.wordHistory = [];
        this.currentHistoryIndex = -1;
        this.showFirstWord();
    }

    extractLevelsAndThemes() {
        const levelsSet = new Set();
        const themesSet = new Set();
        this.themeMap = {};

        this.allWords.forEach(word => {
            if (word.level) levelsSet.add(word.level);
            if (word.theme) {
                themesSet.add(word.theme);
                this.themeMap[word.theme] = (this.themeMap[word.theme] || 0) + 1;
            }
        });

        const levelOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
        const sortedLevels = Array.from(levelsSet).sort((a, b) => levelOrder.indexOf(a) - levelOrder.indexOf(b));
        const sortedThemes = Array.from(themesSet).sort();

        this.setState({
            availableLevels: sortedLevels,
            availableThemes: sortedThemes
        });

        this.renderThemeButtons();
    }

    renderThemeButtons() {
        if (!this.elements.themeButtonsContainer) return;
        this.elements.themeButtonsContainer.innerHTML = '';

        const allBtn = document.createElement('button');
        allBtn.className = `block-btn ${this.state.selectedTheme === 'all' ? 'active' : ''}`;
        allBtn.dataset.theme = 'all';
        allBtn.textContent = 'Все темы';
        allBtn.addEventListener('click', () => this.setTheme('all'));
        this.elements.themeButtonsContainer.appendChild(allBtn);

        this.state.availableThemes.forEach(theme => {
            const count = this.themeMap[theme] || 0;
            const btn = document.createElement('button');
            btn.className = `block-btn ${this.state.selectedTheme === theme ? 'active' : ''}`;
            btn.dataset.theme = theme;
            btn.innerHTML = `${theme} <span class="theme-count">(${count})</span>`;
            btn.addEventListener('click', () => this.setTheme(theme));
            this.elements.themeButtonsContainer.appendChild(btn);
        });
    }

    showFirstWord() {
        const activeWords = this.getActiveWords();
        if (activeWords.length === 0) {
            this.showNoWordsMessage();
            return;
        }
        const firstWord = activeWords[0];
        this.addToHistory(firstWord);
        this.displayWord(firstWord);
    }

    showLoginMessage() {
        this.elements.studyArea.innerHTML = `
            <div class="no-words">
                <p>👋 Пожалуйста, войдите в аккаунт, чтобы начать изучение слов</p>
            </div>`;
    }

    handleFilterChange() {
        this.stopAutoPlay();
        const activeWords = this.getActiveWords();
        if (activeWords.length === 0) {
            this.showNoWordsMessage();
            return;
        }
        const currentWord = this.state.currentWord;
        if (currentWord && activeWords.some(w => w.id === currentWord.id)) {
            this.displayWord(currentWord);
        } else {
            const firstWord = activeWords[0];
            this.addToHistory(firstWord);
            this.displayWord(firstWord);
        }
    }

    handleVisibilityChange() {
        const currentWord = this.state.currentWord;
        if (!currentWord) return;
        const card = document.getElementById('wordCard');
        if (!card) return;
        this.displayMorphemesAndTranslations(currentWord);
        this.displaySentence(currentWord);
        this.displayFinalTranslation(currentWord, false);
    }

    addToHistory(word) {
        if (!word) return;
        if (this.currentHistoryIndex < this.wordHistory.length - 1) {
            this.wordHistory = this.wordHistory.slice(0, this.currentHistoryIndex + 1);
        }
        if (this.wordHistory.length === 0 || this.wordHistory[this.wordHistory.length - 1].id !== word.id) {
            this.wordHistory.push(word);
        }
        this.currentHistoryIndex = this.wordHistory.length - 1;
        this.updateNavigationButtons();
    }

    async displayWord(word) {
        if (!word) return;
        this.setState({ currentWord: word, currentPhase: 'initial' });
        await this.fadeOutCard();
        this.renderInitialCard(word);
        await this.fadeInCard();
        this.displayMorphemesAndTranslations(word);
        this.displaySentence(word);
        this.displayFinalTranslation(word, false);

        // Обновляем MediaSession для нового слова
        this.updateMediaSessionMetadata(word);
    }

    async fadeOutCard() {
        const card = document.getElementById('wordCard');
        if (card) {
            card.style.transition = `opacity ${DELAYS.CARD_FADE_OUT}ms ease-out`;
            card.style.opacity = '0';
            await delay(DELAYS.CARD_FADE_OUT);
            card.remove();
        }
    }

    async fadeInCard() {
        await delay(50);
        const card = document.getElementById('wordCard');
        if (card) {
            card.style.opacity = '0';
            card.style.transition = `opacity ${DELAYS.CARD_FADE_IN}ms ease-in`;
            await delay(10);
            card.style.opacity = '1';
            await delay(DELAYS.CARD_FADE_IN);
        }
    }

    togglePlay() {
        if (this.state.isAutoPlaying) {
            this.stopAutoPlay();
        } else {
            this.startAutoPlay();
        }
    }

    async startAutoPlay() {
        if (this.state.isAutoPlaying) return;
        const word = this.state.currentWord;
        if (!word) {
            const activeWords = this.getActiveWords();
            if (activeWords.length === 0) return;
            const firstWord = activeWords[0];
            this.addToHistory(firstWord);
            await this.displayWord(firstWord);
        }

        this.setState({ isAutoPlaying: true });

        // ЗАПУСКАЕМ БЛОКОВЫЙ ТРЕК
        await this.startBlockAudio();

        // Обновляем MediaSession статус
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }

        this.runAutoPlaySequence();
    }

    stopAutoPlay() {
        this.setState({ isAutoPlaying: false });

        // ОСТАНАВЛИВАЕМ БЛОКОВЫЙ ТРЕК
        this.stopBlockAudio();

        // Обновляем MediaSession статус
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }

        if (this.sequenceController) {
            this.sequenceController.abort();
            this.sequenceController = null;
        }
        if (this.audioPlayer) {
            this.audioPlayer.pause();
            this.audioPlayer.currentTime = 0;
        }
    }

    async runAutoPlaySequence() {
        this.sequenceController = new AbortController();
        const signal = this.sequenceController.signal;

        const checkAbort = () => {
            if (signal.aborted) throw new Error('Sequence aborted');
        };

        try {
            while (this.state.isAutoPlaying) {
                checkAbort();
                const word = this.state.currentWord;
                if (!word) break;

                await delay(DELAYS.INITIAL_WORD);
                checkAbort();

                const repeatCount = this.state.repeatMode;
                for (let i = 0; i < repeatCount; i++) {
                    checkAbort();
                    if (this.state.soundEnabled) await this.playAudio(word.audioUrl);
                    checkAbort();
                    if (i < repeatCount - 1) await delay(DELAYS.BETWEEN_REPEATS);
                }

                if (this.state.showMorphemes && word.morphemes && word.morphemes.length > 0) {
                    await delay(DELAYS.BEFORE_MORPHEMES);
                    checkAbort();
                    this.setState({ currentPhase: 'morphemes' });
                    this.displayMorphemesAndTranslations(word);
                }

                if (this.state.showSentences && word.sentence) {
                    await delay(DELAYS.BEFORE_SENTENCE);
                    checkAbort();
                    this.setState({ currentPhase: 'sentence' });
                    this.displaySentence(word);
                    if (this.state.sentenceSoundEnabled && word.sentenceAudioUrl) {
                        await this.playAudio(word.sentenceAudioUrl);
                        checkAbort();
                    }
                }

                await delay(DELAYS.BEFORE_TRANSLATION);
                checkAbort();
                this.setState({ currentPhase: 'translation' });
                this.displayFinalTranslation(word, true);

                if (this.state.translationSoundEnabled && word.translationAudioUrl) {
                    await this.playAudio(word.translationAudioUrl);
                    checkAbort();
                }

                await delay(DELAYS.BEFORE_NEXT_WORD);
                checkAbort();

                this.incrementStudiedToday();
                await this.nextWord();
                checkAbort();
            }
        } catch (err) {
            if (err.message !== 'Sequence aborted') {
                console.error('Ошибка в последовательности:', err);
            }
        } finally {
            if (this.state.isAutoPlaying) {
                this.stopAutoPlay();
            }
        }
    }

    playAudio(url) {
        return new Promise((resolve, reject) => {
            if (!url || !this.audioPlayer) {
                resolve();
                return;
            }
            this.audioPlayer.src = url;
            this.audioPlayer.play().catch(e => {
                console.error('Ошибка воспроизведения:', e);
                resolve();
            });
            this.audioPlayer.onended = () => resolve();
            this.audioPlayer.onerror = () => {
                console.error('Ошибка загрузки аудио:', url);
                resolve();
            };
        });
    }

    incrementStudiedToday() {
        const today = new Date().toDateString();
        if (this.state.lastStudyDate !== today) {
            this.setState({ studiedToday: 1, lastStudyDate: today });
        } else {
            this.setState({ studiedToday: this.state.studiedToday + 1 });
        }
    }

    async nextWord() {
        const hasNextInHistory = this.currentHistoryIndex < this.wordHistory.length - 1;
        if (hasNextInHistory) {
            this.currentHistoryIndex++;
            const word = this.wordHistory[this.currentHistoryIndex];
            await this.displayWord(word);
        } else {
            const nextWord = this.getNextWord();
            if (nextWord) {
                this.addToHistory(nextWord);
                await this.displayWord(nextWord);
            }
        }
        this.updateNavigationButtons();
    }

    async prevWord() {
        if (this.currentHistoryIndex > 0) {
            this.currentHistoryIndex--;
            const word = this.wordHistory[this.currentHistoryIndex];
            await this.displayWord(word);
            this.updateNavigationButtons();
        }
    }

    async restartCurrentWord() {
        const wasAutoPlaying = this.state.isAutoPlaying;
        if (wasAutoPlaying) this.stopAutoPlay();
        const word = this.state.currentWord;
        if (word) await this.displayWord(word);
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
        document.body.innerHTML = `<div style="text-align:center;padding:50px;"><h1>Произошла ошибка</h1><p>Попробуйте очистить кэш браузера.</p></div>`;
    }
});