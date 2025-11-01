// src/services/VocabularyService.js
"use strict";

// ИЗМЕНЕНО: Импортируем готовый apiClient, а не константу
import { apiClient } from './ApiClient.js';

/**
 * Управляет загрузкой, кэшированием и фильтрацией словарных данных.
 */
export class VocabularyService {
    constructor({ stateManager }) {
        this.stateManager = stateManager;
        this.vocabulariesCache = {};
        this.vocabularyListCache = null;
        // ИЗМЕНЕНО: Сервис теперь использует ApiClient
        this.api = apiClient;
    }

    /**
     * Получает список доступных словарей с сервера, используя кэш.
     * @returns {Promise<Array>}
     */
    async getList() {
        if (this.vocabularyListCache) {
            return this.vocabularyListCache;
        }

        // ИЗМЕНЕНО: Используем apiClient вместо fetch
        const vocabs = await this.api.get('/api/vocabularies/list');

        if (!vocabs || vocabs.length === 0) throw new Error('На сервере нет словарей.');

        this.vocabularyListCache = vocabs;
        return vocabs;
    }

    /**
     * Загружает данные конкретного словаря с сервера, используя кэш.
     * @param {string} name - Имя словаря.
     * @returns {Promise<Object>} - Объект с полями { words, meta }.
     */
    async getVocabulary(name) {
        if (this.vocabulariesCache[name]) {
            return this.vocabulariesCache[name];
        }

        // ИЗМЕНЕНО: Используем apiClient вместо fetch
        const data = await this.api.get(`/api/vocabulary/${name}`);

        const words = Array.isArray(data) ? data : data.words;
        if (!words) throw new Error(`Неверный формат словаря "${name}"`);

        const vocabularyData = {
            words: words.map((w, i) => ({ ...w, id: w.id || `${name}_word_${Date.now()}_${i}` })),
            meta: data.meta || { themes: {} }
        };

        this.vocabulariesCache[name] = vocabularyData;
        return vocabularyData;
    }

    /**
     * Фильтрует переданный массив слов на основе текущих настроек в StateManager.
     * @param {Array} allWords - Полный массив слов для фильтрации.
     * @returns {Array} - Отфильтрованный массив слов.
     */
    filterWords(allWords) {
        const state = this.stateManager.getState();
        const { selectedLevels, selectedTheme } = state;
        if (!allWords || allWords.length === 0) return [];

        if (selectedLevels.length === 0) return [];

        return allWords.filter(w =>
            w?.level &&
            selectedLevels.includes(w.level) &&
            (selectedTheme === 'all' || w.theme === selectedTheme)
        );
    }
}