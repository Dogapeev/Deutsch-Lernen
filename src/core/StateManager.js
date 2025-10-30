// src/core/StateManager.js
"use strict";

import { APP_VERSION } from '../utils/constants.js';

/**
 * Управляет состоянием приложения, включая загрузку, сохранение и уведомление об изменениях.
 */
export class StateManager {
    constructor() {
        // Начальное состояние приложения по умолчанию
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

        // Внутреннее хранилище состояния
        this._state = { ...this.initialState };

        // Список "слушателей", которые будут уведомлены об изменении состояния
        this._listeners = [];
    }

    /**
     * Инициализирует состояние: загружает из localStorage и запускает миграции.
     */
    init() {
        this._runMigrations();
        const loadedState = this._loadStateFromLocalStorage();
        // Сливаем загруженное состояние с начальным, чтобы новые поля не терялись
        this._state = { ...this.initialState, ...loadedState };
        console.log('✅ StateManager инициализирован.');
    }

    /**
     * Возвращает текущее состояние.
     * @returns {object}
     */
    getState() {
        return this._state;
    }

    /**
     * Обновляет состояние и уведомляет всех подписчиков.
     * @param {object} newState - Объект с новыми значениями состояния.
     */
    setState(newState) {
        // Обновляем внутреннее состояние
        this._state = { ...this._state, ...newState };
        // Сохраняем в localStorage
        this._saveStateToLocalStorage();
        // Уведомляем всех подписчиков
        this._notifyListeners();
    }

    /**
     * Позволяет подписаться на изменения состояния.
     * @param {function} listener - Функция обратного вызова, которая будет вызвана с новым состоянием.
     * @returns {function} - Функция для отписки.
     */
    subscribe(listener) {
        this._listeners.push(listener);
        // Возвращаем функцию для отписки, чтобы избежать утечек памяти
        return () => {
            this._listeners = this._listeners.filter(l => l !== listener);
        };
    }

    /**
     * Уведомляет всех подписчиков о том, что состояние изменилось.
     */
    _notifyListeners() {
        for (const listener of this._listeners) {
            listener(this._state);
        }
    }

    // --- Приватные методы для работы с localStorage и миграциями ---

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

        // Миграция старого `repeatMode` на новую систему `sequenceMode` + `repeatMode`
        const oldRepeatMode = safeJsonParse('repeatMode', 2);
        if (oldRepeatMode === 'random') {
            loadedState.sequenceMode = 'random';
            loadedState.repeatMode = 2;
        } else {
            loadedState.sequenceMode = safeJsonParse('sequenceMode', 'sequential');
            loadedState.repeatMode = typeof oldRepeatMode === 'string' ? parseInt(oldRepeatMode, 10) : oldRepeatMode;
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
            localStorage.setItem('appVersion', APP_VERSION); // Обновляем версию после миграции
            console.log('Миграция данных < 2.8 выполнена.');
        }
    }
}