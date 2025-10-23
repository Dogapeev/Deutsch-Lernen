/// app.js - Версия 5.0.0 (Firebase Auth Integration)
"use strict";

// --- ИНИЦИАЛИЗАЦИЯ FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyBWkVK2-gnHLDk2XBxenqsSm4Dp8Ey9kcY",
    authDomain: "deutsch-lernen-aiweb.firebaseapp.com",
    projectId: "deutsch-lernen-aiweb",
    storageBucket: "deutsch-lernen-aiweb.firebasestorage.app",
    messagingSenderId: "495823275301",
    appId: "1:495823275301:web:f724cdedce75a1538946cc",
    measurementId: "G-DV24PZW6R3"
};

// Инициализируем Firebase и создаем константы для доступа к сервисам
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --- КОНФИГУРАЦИЯ И КОНСТАНТЫ ---
const APP_VERSION = '5.0.0';
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
        this.audioPlayer = document.getElementById('audioPlayer');
        this.themeMap = {};

        // --- ИЗМЕНЕНИЕ 1: Добавляем состояние для пользователя ---
        this.state = {
            currentUser: null, // Здесь будет храниться объект пользователя
            isAutoPlaying: false,
            currentWord: null,
            currentPhase: 'initial',
            // ... (остальные state-свойства без изменений)
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

        // --- ИЗМЕНЕНИЕ 2: Добавляем элементы UI для аутентификации ---
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

            // Новые элементы
            auth: {
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
                googleSignUpBtn: document.getElementById('googleSignUpBtn')
            }
        };
        this.loadStateFromLocalStorage();
        this.runMigrations();
    }

    // --- ИЗМЕНЕНИЕ 3: Полностью новый метод для обработки состояния входа пользователя ---
    handleAuthStateChanged(user) {
        if (user) {
            // Пользователь вошел в систему
            this.setState({ currentUser: user });
            this.updateAuthUI(user);
            console.log("✅ Пользователь вошел:", user.displayName);

            // TODO: В будущем здесь будет загрузка персональных словарей из Firestore.
            // А пока, чтобы приложение работало, загружаем дефолтный словарь.
            this.loadAndSwitchVocabulary(this.state.currentVocabulary, true);

        } else {
            // Пользователь вышел
            this.setState({ currentUser: null });
            this.updateAuthUI(null);
            this.allWords = []; // Очищаем слова
            this.showLoginMessage(); // Показываем приглашение войти
            console.log("🔴 Пользователь вышел.");
        }
    }

    // --- ИЗМЕНЕНИЕ 4: Новый метод для обновления UI в зависимости от статуса входа ---
    updateAuthUI(user) {
        if (user) {
            // Показываем профиль, скрываем кнопку "Войти"
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
            // Показываем кнопку "Войти", скрываем профиль
            this.elements.auth.openAuthBtn.style.display = 'flex';
            this.elements.auth.userProfile.style.display = 'none';
        }
    }

    // --- ИЗМЕНЕНИЕ 5: Новый метод для управления модальным окном ---
    toggleAuthModal(show) {
        if (show) {
            this.elements.auth.modal.classList.add('visible');
            this.elements.auth.overlay.classList.add('visible');
        } else {
            this.elements.auth.modal.classList.remove('visible');
            this.elements.auth.overlay.classList.remove('visible');
        }
    }

    // --- ИЗМЕНЕНИЕ 6: Новый метод для входа через Google ---
    async signInWithGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await auth.signInWithPopup(provider);
            this.toggleAuthModal(false); // Закрываем модальное окно после успешного входа
        } catch (error) {
            console.error("Ошибка входа через Google:", error);
            // Здесь можно показать уведомление об ошибке
        }
    }

    // --- ИЗМЕНЕНИЕ 7: Переработанный метод init() ---
    init() {
        this.bindEvents(); // Сначала привязываем все события

        // Главный слушатель состояния аутентификации.
        // Он сработает один раз при загрузке страницы и каждый раз, когда пользователь входит или выходит.
        auth.onAuthStateChanged(user => this.handleAuthStateChanged(user));

        setTimeout(() => {
            document.querySelector('.header-mobile')?.classList.add('collapsed');
        }, 3000);
    }

    // --- ИЗМЕНЕНИЕ 8: Добавляем привязку событий для аутентификации ---
    bindEvents() {
        // Старые события
        document.getElementById('settingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(true));
        document.getElementById('closeSettingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(false));
        this.elements.settingsOverlay.addEventListener('click', () => this.toggleSettingsPanel(false));
        // ... и все остальные ваши старые .addEventListener ...
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


        // Новые события для аутентификации
        this.elements.auth.openAuthBtn.addEventListener('click', () => this.toggleAuthModal(true));
        this.elements.auth.closeModalBtn.addEventListener('click', () => this.toggleAuthModal(false));
        this.elements.auth.overlay.addEventListener('click', () => this.toggleAuthModal(false));
        this.elements.auth.signOutBtn.addEventListener('click', () => auth.signOut());

        // Вход через Google (на обеих вкладках)
        this.elements.auth.googleSignInBtn.addEventListener('click', () => this.signInWithGoogle());
        this.elements.auth.googleSignUpBtn.addEventListener('click', () => this.signInWithGoogle());
    }

    // --- ИЗМЕНЕНИЕ 9: Новый метод для отображения сообщения о входе ---
    showLoginMessage() {
        this.stopAutoPlay();
        const msg = 'Войдите в аккаунт, чтобы создавать свои словари и отслеживать прогресс.';
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${msg}</p></div>`;
        this.setState({ currentWord: null });
        this.updateUI(); // Обновляем UI, чтобы скрыть лишние кнопки
    }

    // =============================================================
    // ВЕСЬ ОСТАЛЬНОЙ КОД КЛАССА ОСТАЕТСЯ БЕЗ ИЗМЕНЕНИЙ
    // (setState, loadAndSwitchVocabulary, fetchVocabularyData, и т.д.)
    // =============================================================

    // Просто для примера, я оставлю несколько методов без изменений, 
    // чтобы показать, что они остаются на месте.

    setState(newState) {
        // Этот метод не меняется
        this.state = { ...this.state, ...newState };
        this.updateUI();
        this.saveStateToLocalStorage();
    }

    async loadAndSwitchVocabulary(vocabNameToLoad, isInitialLoad = false) {
        // Этот метод пока не меняется. Он все еще нужен для загрузки дефолтных словарей.
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

    // ... и так далее, все остальные ваши методы остаются на месте ...
    // Я их удалил из этого примера для краткости

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