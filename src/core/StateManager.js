// src/core/StateManager.js
"use strict";

import { APP_VERSION } from '../utils/constants.js';

export class StateManager {
    constructor() {
        this.initialState = {
            currentUser: null,
            isAutoPlaying: false,
            currentWord: null,
            currentPhase: 'initial',
            currentPhaseIndex: 0,
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

        this._state = { ...this.initialState };
        this._listeners = [];
    }

    init() {
        this._runMigrations();
        const loadedState = this._loadStateFromLocalStorage();
        this._state = { ...this.initialState, ...loadedState };
        console.log('✅ StateManager инициализирован.');
    }

    getState() {
        return this._state;
    }

    setState(newState) {
        this._state = { ...this._state, ...newState };
        this._saveStateToLocalStorage();
        this._notifyListeners();
    }

    subscribe(listener) {
        this._listeners.push(listener);
        return () => {
            this._listeners = this._listeners.filter(l => l !== listener);
        };
    }

    _notifyListeners() {
        for (const listener of this._listeners) {
            listener(this._state);
        }
    }

    _loadStateFromLocalStorage() {
        const safeJsonParse = (k, d) => { try { const i = localStorage.getItem(k); return i ? JSON.parse(i) : d; } catch { return d; } };
        const today = new Date().toDateString();
        const lastStudyDate = localStorage.getItem('lastStudyDate');

        const loadedState = {
            lastStudyDate: today,
            studiedToday: (lastStudyDate === today) ? (parseInt(localStorage.getItem('studiedToday')) || 0) : 0,
            soundEnabled: safeJsonParse('soundEnabled', true),
            translationSoundEnabled: safeJsonParse('translationSoundEnabled', true),
            sentenceSoundEnabled: safeJsonParse('sentenceSoundEnabled', true),
            selectedLevels: safeJsonParse('selectedLevels', ['A1', 'A2', 'B1', 'B2']),
            selectedTheme: localStorage.getItem('selectedTheme') || 'all',
            showArticles: safeJsonParse('showArticles', true),
            showMorphemes: safeJsonParse('showMorphemes', true),
            showMorphemeTranslations: safeJsonParse('showMorphemeTranslations', true),
            showSentences: safeJsonParse('showSentences', true),
            currentVocabulary: localStorage.getItem('currentVocabulary') || 'vocabulary',
        };

        const oldRepeatMode = safeJsonParse('repeatMode', 2);
        if (oldRepeatMode === 'random') {
            loadedState.sequenceMode = 'random';
            loadedState.repeatMode = 2;
        } else {
            loadedState.sequenceMode = safeJsonParse('sequenceMode', 'sequential');
            // ✅ ИСПРАВЛЕНО: Добавлена валидация для repeatMode
            let parsedRepeatMode = typeof oldRepeatMode === 'string' ? parseInt(oldRepeatMode, 10) : oldRepeatMode;
            if (isNaN(parsedRepeatMode) || parsedRepeatMode < 1 || parsedRepeatMode > 5) {
                parsedRepeatMode = 2; // Значение по умолчанию
            }
            loadedState.repeatMode = parsedRepeatMode;
        }

        return loadedState;
    }

    _saveStateToLocalStorage() {
        const stateToSave = this._state;
        localStorage.setItem('appVersion', APP_VERSION);
        localStorage.setItem('lastStudyDate', stateToSave.lastStudyDate);
        localStorage.setItem('studiedToday', stateToSave.studiedToday);
        localStorage.setItem('soundEnabled', JSON.stringify(stateToSave.soundEnabled));
        localStorage.setItem('translationSoundEnabled', JSON.stringify(stateToSave.translationSoundEnabled));
        localStorage.setItem('sentenceSoundEnabled', JSON.stringify(stateToSave.sentenceSoundEnabled));
        localStorage.setItem('sequenceMode', stateToSave.sequenceMode);
        localStorage.setItem('repeatMode', JSON.stringify(stateToSave.repeatMode));
        localStorage.setItem('selectedLevels', JSON.stringify(stateToSave.selectedLevels));
        localStorage.setItem('selectedTheme', stateToSave.selectedTheme);
        localStorage.setItem('showArticles', JSON.stringify(stateToSave.showArticles));
        localStorage.setItem('showMorphemes', JSON.stringify(stateToSave.showMorphemes));
        localStorage.setItem('showMorphemeTranslations', JSON.stringify(stateToSave.showMorphemeTranslations));
        localStorage.setItem('showSentences', JSON.stringify(stateToSave.showSentences));
        localStorage.setItem('currentVocabulary', stateToSave.currentVocabulary);
    }

    _runMigrations() {
        const savedVersion = localStorage.getItem('appVersion') || '1.0';
        if (parseFloat(savedVersion) < 2.8) {
            localStorage.removeItem('germanWords');
            localStorage.setItem('appVersion', APP_VERSION);
            console.log('Миграция данных < 2.8 выполнена.');
        }
    }
}