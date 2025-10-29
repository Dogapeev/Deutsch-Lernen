// src/utils/constants.js
"use strict";

// Версия приложения
export const APP_VERSION = '5.4.6';

// Базовый URL для TTS API
export const TTS_API_BASE_URL = 'https://deutsch-lernen-sandbox.onrender.com';

// Конфигурация задержек в миллисекундах
export const DELAYS = {
    INITIAL_WORD: 500,
    BETWEEN_REPEATS: 1000,
    BEFORE_MORPHEMES: 1000,
    BEFORE_SENTENCE: 2000,
    BEFORE_TRANSLATION: 1000,
    BEFORE_NEXT_WORD: 1500,
    CARD_FADE_OUT: 750,
    CARD_FADE_IN: 300
};

// Конфигурация Firebase
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBWkVK2-gnHLDk2XBxenqsSm4Dp8Ey9kcY",
    authDomain: "deutsch-lernen-aiweb.firebaseapp.com",
    projectId: "deutsch-lernen-aiweb",
    storageBucket: "deutsch-lernen-aiweb.appspot.com",
    messagingSenderId: "495823275301",
    appId: "1:495823275301:web:f724cdedce75a1538946cc",
    measurementId: "G-DV24PZW6R3"
};