// src/services/ApiClient.js
"use strict";

import { TTS_API_BASE_URL } from '../utils/constants.js';

/**
 * Низкоуровневый клиент для выполнения запросов к API.
 */
export class ApiClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * Выполняет GET-запрос.
     * @param {string} endpoint - Конечная точка API (например, '/api/vocabularies/list').
     * @returns {Promise<any>} - Распарсенные JSON-данные.
     */
    async get(endpoint) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`);

            if (!response.ok) {
                // Обрабатываем HTTP-ошибки
                throw new Error(`Ошибка сети: ${response.status} ${response.statusText}`);
            }

            return await response.json(); // Автоматически парсим JSON

        } catch (error) {
            console.error(`Ошибка при выполнении GET-запроса к ${endpoint}:`, error);
            // Пробрасываем ошибку выше, чтобы сервисы могли ее обработать
            throw error;
        }
    }

    // В будущем здесь можно добавить методы post, put, delete и т.д.
    // async post(endpoint, data) { ... }
}

// Создаем и экспортируем единственный экземпляр клиента для всего приложения
export const apiClient = new ApiClient(TTS_API_BASE_URL);