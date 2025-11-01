// app.js - Версия 6.3.0 (Финальная архитектура)
"use strict";

// --- ИМПОРТЫ МОДУЛЕЙ ---
import { APP_VERSION } from './utils/constants.js';
import { AudioEngine } from './core/AudioEngine.js';
import { StateManager } from './core/StateManager.js';
import { LessonEngine } from './core/LessonEngine.js';
import { UIController } from './ui/UIController.js';
import { VocabularyService } from './services/VocabularyService.js';
import { AuthController } from './ui/AuthController.js';


// --- ИНИЦИАЛИЗАЦИЯ FIREBASE ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";
import { FIREBASE_CONFIG } from './utils/constants.js';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

class VocabularyApp {

    constructor() {
        this.appVersion = APP_VERSION;
        this.allWords = [];
        this.themeMap = {};
        this.headerCollapseTimeout = null;

        // --- ИНИЦИАЛИЗАЦИЯ ОСНОВНЫХ МОДУЛЕЙ ---
        this.stateManager = new StateManager();
        this.audioEngine = new AudioEngine({ stateManager: this.stateManager });
        this.vocabularyService = new VocabularyService({ stateManager: this.stateManager });

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

        this.authController = new AuthController({
            auth: auth,
            showNotification: (msg, type) => this.uiController.showNotification(msg, type)
        });

        // ИЗМЕНЕНО: "Мост" стал намного проще. Он просто перенаправляет вызовы в uiController.
        const uiBridge = {
            fadeInNewCard: (...args) => this.uiController.fadeInNewCard(...args),
            revealMorphemesPhase: (...args) => this.uiController.revealMorphemesPhase(...args),
            revealSentencePhase: (...args) => this.uiController.revealSentencePhase(...args),
            revealTranslationPhase: (...args) => this.uiController.revealTranslationPhase(...args),
            prepareNextWord: (...args) => this.uiController.prepareNextWord(...args),
            // Эти методы уже были здесь, но теперь они часть единой концепции
            showNoWordsMessage: (...args) => this.uiController.showNoWordsMessage(...args, this.allWords.length > 0),
            updateCardViewToPhase: (...args) => this.uiController.updateCardViewToPhase(...args)
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
        this.authController.init();

        // ИЗМЕНЕНО: Делегируем repositionAuthContainer в uiController
        this.uiController.repositionAuthContainer();
        window.addEventListener('resize', () => this.uiController.repositionAuthContainer());

        this.setupMediaSessionHandlers();
        onAuthStateChanged(auth, user => this.handleAuthStateChanged(user));
    }

    handleStateUpdate() {
        const activeWords = this.vocabularyService.filterWords(this.allWords);
        const canNavigate = this.lessonEngine.playbackSequence.length > 1;
        this.uiController.updateUI(activeWords.length, canNavigate);
    }

    handleAuthStateChanged(user) {
        clearTimeout(this.headerCollapseTimeout);
        this.authController.updateAuthUI(user);

        if (user) {
            this.stateManager.setState({ currentUser: user });
            console.log("✅ Пользователь вошел:", user.displayName);
            this.loadAndSwitchVocabulary(this.stateManager.getState().currentVocabulary, true);
            this.headerCollapseTimeout = setTimeout(() => this.uiController.collapseMobileHeader(), 3000);
        } else {
            this.stateManager.setState({ currentUser: null });
            this.allWords = [];
            this.uiController.showLoginMessage();
            this.handleStateUpdate();
            console.log("🔴 Пользователь вышел.");
            this.uiController.expandMobileHeader();
        }
    }

    // --- МЕТОДЫ-КОНТРОЛЛЕРЫ (КООРДИНАЦИЯ) ---

    toggleSetting(key) {
        if (this.stateManager.getState().isAutoPlaying) this.lessonEngine.stop();

        let newState = { [key]: !this.stateManager.getState()[key] };
        if (key === 'showMorphemes' && !newState[key]) {
            newState.showMorphemeTranslations = false;
        }
        this.stateManager.setState(newState);

        // После изменения настройки, нужно перерисовать текущую карточку
        const word = this.stateManager.getState().currentWord;
        if (word && document.getElementById('wordCard')) {
            this.uiController.renderInitialCard(word);
            this.uiController.updateCardViewToPhase(word, this.stateManager.getState().currentPhaseIndex, this.lessonEngine.playbackSequence);
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

    // --- УПРАВЛЕНИЕ ДАННЫМИ (КООРДИНАЦИЯ) ---

    handleFilterChange(isInitialLoad = false) {
        this.lessonEngine.stop();
        const activeWords = this.vocabularyService.filterWords(this.allWords);
        this.lessonEngine.generatePlaybackSequence(activeWords);
        const { playbackSequence } = this.lessonEngine;

        if (playbackSequence.length > 0) {
            const firstWord = playbackSequence[0];
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

    async loadAndSwitchVocabulary(vocabNameToLoad, isInitialLoad = false) {
        this.lessonEngine.stop();
        this.uiController.showLoadingMessage();
        try {
            const vocabs = await this.vocabularyService.getList();
            this.stateManager.setState({ availableVocabularies: vocabs });
            let finalVocabName = vocabNameToLoad;
            if (!vocabs.some(v => v.name === finalVocabName)) {
                finalVocabName = vocabs[0]?.name;
                if (!finalVocabName) { throw new Error("Не найдено ни одного словаря."); }
            }
            const vocabularyData = await this.vocabularyService.getVocabulary(finalVocabName);
            this.allWords = vocabularyData.words;
            this.themeMap = vocabularyData.meta.themes || {};
            this.stateManager.setState({ currentVocabulary: finalVocabName });
            this.updateDynamicFilters();
            this.uiController.renderVocabularySelector();
            this.handleFilterChange(isInitialLoad);
        } catch (error) {
            console.error(error);
            this.handleLoadingError(error.message);
        }
    }

    // --- ВНУТРЕННИЕ МЕТОДЫ (КООРДИНАЦИЯ) ---

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