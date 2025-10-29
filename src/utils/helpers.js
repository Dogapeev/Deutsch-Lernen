// src/utils/helpers.js
"use strict";

/**
 * Создает промис, который разрешается через указанное количество миллисекунд.
 * @param {number} ms - Время задержки в миллисекундах.
 * @returns {Promise<void>}
 */
export const delay = ms => new Promise(res => setTimeout(res, ms));