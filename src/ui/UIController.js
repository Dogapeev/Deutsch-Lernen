// src/ui/UIController.js
"use strict";

import { DELAYS } from '../utils/constants.js';
import { delay } from '../utils/helpers.js';

export class UIController {
    constructor({ stateManager, handlers }) {
        this.stateManager = stateManager;
        this.handlers = handlers; // Объект с колбэками из app.js
        this.elements = {};
        this.lastScrollY = 0;
    }

    /**
     * Находит все необходимые DOM-элементы и сохраняет ссылки на них.
     * Вызывается один раз при инициализации приложения.
     */
    init() {
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
        };
        this._bindEvents();
    }

    /**
     * Привязывает обработчики событий к элементам DOM.
     * Использует колбэки из this.handlers, переданные из app.js.
     */
    _bindEvents() {
        document.getElementById('settingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(true));
        document.getElementById('closeSettingsButton')?.addEventListener('click', () => this.toggleSettingsPanel(false));
        this.elements.settingsOverlay?.addEventListener('click', () => this.toggleSettingsPanel(false));

        document.querySelectorAll('[id^=toggleButton]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.handlers.onTogglePlay(); }));
        document.querySelectorAll('[id^=prevButton]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.handlers.onPreviousWord(); }));
        document.querySelectorAll('[id^=nextButton]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.handlers.onNextWord(); }));

        const settingsMap = {
            'soundToggle': 'soundEnabled', 'translationSoundToggle': 'translationSoundEnabled',
            'sentenceSoundToggle': 'sentenceSoundEnabled', 'toggleArticles': 'showArticles',
            'toggleMorphemes': 'showMorphemes', 'toggleMorphemeTranslations': 'showMorphemeTranslations',
            'toggleSentences': 'showSentences'
        };
        for (const [idPrefix, stateKey] of Object.entries(settingsMap)) {
            document.querySelectorAll(`[id^=${idPrefix}]`).forEach(b => b.addEventListener('click', e => {
                e.stopPropagation();
                this.handlers.onToggleSetting(stateKey);
            }));
        }

        document.querySelectorAll('.level-btn').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); this.handlers.onLevelToggle(e.target.dataset.level); }));
        document.querySelectorAll('.repeat-selector, .repeat-selector-mobile').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); this.handlers.onRepeatModeChange(parseInt(e.currentTarget.dataset.mode)); }));
        document.querySelectorAll('.sequence-selector, .sequence-selector-mobile').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); this.handlers.onSequenceModeChange(e.currentTarget.dataset.mode); }));
        document.querySelectorAll('[id^=vocabularySelector]').forEach(sel => sel.addEventListener('change', e => this.handlers.onVocabularyChange(e.target.value)));

        window.addEventListener('scroll', () => this.handleScroll());
        this.elements.mainContent?.addEventListener('click', () => this.handlers.onTogglePlay());
    }

    // --- Методы отображения карточки ---

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
                    ${this._formatGermanWord(word)}
                    <div class="pronunciation">${word.pronunciation || ''}</div>
                    <div class="swappable-area">
                        <div id="morphemeTranslations" class="morpheme-translations"></div>
                        <div id="translationContainer" class="translation-container"></div>
                    </div>
                    <div id="sentenceContainer" class="sentence-container"></div>
                </div>
            </div>`;
        this.elements.studyArea.innerHTML = cardHtml;
    }

    updateCardViewToPhase(word, phaseIndex, phases) {
        if (!document.getElementById('wordCard')) { this.renderInitialCard(word); }
        const card = document.getElementById('wordCard');
        if (!card || !phases || phases.length === 0) return;

        // Определяем, какие фазы уже должны быть видимы
        let morphemesRevealed = false;
        let sentenceRevealed = false;

        // Проверяем по имени фазы, а не по содержимому функции
        for (let i = 0; i < phaseIndex; i++) {
            const phaseName = phases[i]?.name;
            if (phaseName === 'revealMorphemes') morphemesRevealed = true;
            if (phaseName === 'playSentence') sentenceRevealed = true; // Имя фазы из LessonEngine
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
        const { showMorphemes, showMorphemeTranslations } = this.stateManager.getState();
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
        const { showSentences } = this.stateManager.getState();
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

    // --- Методы обновления UI ---

    updateUI(activeWordsCount, canNavigate) {
        if (!this.elements.mainContent) return;
        this._setupIcons();
        this._updateStats(activeWordsCount);
        this._updateControlButtons();
        this._updateNavigationButtons(canNavigate);
        this._updateLevelButtons();
        this._updateThemeButtons();
        this._updateRepeatControlsState();
    }

    _updateStats(activeWordsCount) {
        const state = this.stateManager.getState();
        if (this.elements.totalWords) this.elements.totalWords.textContent = activeWordsCount;
        if (this.elements.studiedToday) this.elements.studiedToday.textContent = state.studiedToday;
    }

    _setupIcons() {
        const state = this.stateManager.getState();
        const iconMap = {
            prevButton: '#icon-prev', nextButton: '#icon-next',
            soundToggle: state.soundEnabled ? '#icon-sound-on' : '#icon-sound-off',
            translationSoundToggle: state.translationSoundEnabled ? '#icon-chat-on' : '#icon-chat-off',
            sentenceSoundToggle: state.sentenceSoundEnabled ? '#icon-sentence-on' : '#icon-sentence-off',
            toggleButton: state.isAutoPlaying ? '#icon-pause' : '#icon-play'
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

    _updateControlButtons() {
        const state = this.stateManager.getState();
        this._setupIcons();
        this._updateToggleButton();
        const controls = {
            toggleArticles: state.showArticles,
            toggleMorphemes: state.showMorphemes,
            toggleMorphemeTranslations: state.showMorphemeTranslations,
            toggleSentences: state.showSentences,
            soundToggle: state.soundEnabled,
            translationSoundToggle: state.translationSoundEnabled,
            sentenceSoundToggle: state.sentenceSoundEnabled
        };
        for (const [key, stateValue] of Object.entries(controls)) {
            document.querySelectorAll(`[id^=${key}]`).forEach(btn => {
                btn.classList.toggle('active', stateValue);
                if (btn.classList.contains('option-btn') || (btn.classList.contains('repeat-selector') && !btn.dataset.mode)) {
                    btn.textContent = stateValue ? 'Вкл' : 'Выкл';
                }
            });
        }
        document.querySelectorAll('[id^=toggleMorphemeTranslations]').forEach(btn => {
            btn.disabled = !state.showMorphemes;
        });
    }

    _updateToggleButton() {
        const state = this.stateManager.getState();
        document.querySelectorAll('[id^=toggleButton]').forEach(btn => {
            btn.classList.toggle('playing', state.isAutoPlaying);
        });
        this.elements.mainContent.classList.toggle('is-clickable', !state.isAutoPlaying);
    }

    _updateNavigationButtons(canNavigate) {
        document.querySelectorAll('[id^=prevButton]').forEach(btn => btn.disabled = !canNavigate);
        document.querySelectorAll('[id^=nextButton]').forEach(btn => btn.disabled = !canNavigate);
    }

    _updateLevelButtons() {
        const state = this.stateManager.getState();
        document.querySelectorAll('.level-btn').forEach(b => {
            const level = b.dataset.level;
            const isAvailable = state.availableLevels.includes(level);
            b.disabled = !isAvailable;
            b.classList.toggle('active', isAvailable && state.selectedLevels.includes(level));
        });
    }

    _updateThemeButtons() {
        const state = this.stateManager.getState();
        document.querySelectorAll('.block-btn[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === state.selectedTheme));
    }

    renderThemeButtons(themeMap) {
        const state = this.stateManager.getState();
        if (!this.elements.themeButtonsContainer) return;
        const wrapper = this.elements.themeButtonsContainer;
        wrapper.innerHTML = `<span class="block-label"><svg class="icon"><use xlink:href="#icon-category"></use></svg>Темы</span>`;

        const createBtn = (theme, text) => {
            const btn = document.createElement('button');
            btn.className = 'block-btn';
            btn.dataset.theme = theme;
            btn.textContent = text;
            btn.addEventListener('click', () => this.handlers.onThemeChange(theme));
            return btn;
        };

        if (state.availableThemes.length > 0) {
            wrapper.appendChild(createBtn('all', 'Все темы'));
            state.availableThemes.forEach(theme => {
                const themeName = themeMap[theme] || theme.charAt(0).toUpperCase() + theme.slice(1);
                wrapper.appendChild(createBtn(theme, themeName));
            });
        }
        this._updateThemeButtons();
    }


    _updateRepeatControlsState() {
        const state = this.stateManager.getState();
        document.querySelectorAll('.repeat-selector, .repeat-selector-mobile').forEach(button => {
            button.classList.toggle('active', parseInt(button.dataset.mode) === state.repeatMode);
        });
        document.querySelectorAll('.sequence-selector, .sequence-selector-mobile').forEach(button => {
            button.classList.toggle('active', button.dataset.mode === state.sequenceMode);
        });
    }

    renderVocabularySelector() {
        const state = this.stateManager.getState();
        const vocabs = state.availableVocabularies;
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
                if (vocab.name === state.currentVocabulary) {
                    option.selected = true;
                }
                selectEl.appendChild(option);
            });
        };
        document.querySelectorAll('[id^=vocabularySelector]').forEach(createOptions);
    }

    // --- Сообщения и состояния ---

    showNoWordsMessage(customMessage = '', allWordsLoaded = false) {
        const msg = customMessage || (allWordsLoaded ? 'Нет слов для выбранных фильтров.' : 'Загрузка словаря...');
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${msg}</p></div>`;
    }

    showLoadingMessage(message = 'Загрузка...') {
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${message}</p></div>`;
    }

    showLoginMessage() {
        const msg = 'Войдите в аккаунт, чтобы создавать свои словари и отслеживать прогресс.';
        this.elements.studyArea.innerHTML = `<div class="no-words"><p>${msg}</p></div>`;
    }

    showNotification(message, type = 'info') {
        const notification = this.elements.notification;
        if (!notification) return;
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('visible');
        setTimeout(() => { notification.classList.remove('visible'); }, 4000);
    }

    // --- Вспомогательные и прочие UI-методы ---

    toggleSettingsPanel(show) {
        this.elements.settingsPanel.classList.toggle('visible', show);
        this.elements.settingsOverlay.classList.toggle('visible', show);
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

    _parseGermanWord(word) {
        const german = word.german || '';
        const articles = ['der ', 'die ', 'das '];
        for (const article of articles) {
            if (german.startsWith(article)) return { article: article.trim(), mainWord: german.substring(article.length), genderClass: article.trim() };
        }
        return { article: null, mainWord: german, genderClass: 'das' };
    }

    _formatGermanWord(word) {
        const state = this.stateManager.getState();
        const parsed = this._parseGermanWord(word);
        const articleClass = state.showArticles ? '' : 'hide-articles';
        const mainWordHtml = parsed.mainWord;
        const articleHtml = parsed.article ? `<span class="article ${parsed.genderClass}">${parsed.article}</span>` : '';
        return `<div class="word ${parsed.genderClass} ${articleClass}">${articleHtml}<span class="main-word">${mainWordHtml}</span></div>`;
    }

    // =======================================================================
    // НОВЫЕ МЕТОДЫ, ПЕРЕНЕСЕННЫЕ ИЗ APP.JS
    // =======================================================================

    /**
     * Управляет анимацией появления новой карточки.
     * @param {object} word - Объект слова для рендера.
     * @param {function} checkAborted - Функция для проверки прерывания.
     */
    async fadeInNewCard(word, checkAborted) {
        const oldCard = document.getElementById('wordCard');
        if (oldCard) {
            oldCard.classList.add('word-crossfade', 'word-fade-out');
            await delay(DELAYS.CARD_FADE_OUT);
            checkAborted();
        }
        this.renderInitialCard(word);
    }

    /**
     * Управляет анимацией и отображением морфем.
     * @param {object} word - Объект слова.
     * @param {function} checkAborted - Функция для проверки прерывания.
     */
    async revealMorphemesPhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_MORPHEMES);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-morphemes');
        this.displayMorphemesAndTranslations(word);
    }

    /**
     * Управляет анимацией и отображением предложения.
     * @param {object} word - Объект слова.
     * @param {function} checkAborted - Функция для проверки прерывания.
     */
    async revealSentencePhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_SENTENCE);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-sentence');
        this.displaySentence(word);
    }

    /**
     * Управляет анимацией и отображением перевода.
     * @param {object} word - Объект слова.
     * @param {function} checkAborted - Функция для проверки прерывания.
     */
    async revealTranslationPhase(word, checkAborted) {
        await delay(DELAYS.BEFORE_TRANSLATION);
        checkAborted();
        document.getElementById('wordCard')?.classList.add('phase-translation');
        this.displayFinalTranslation(word);
    }

    /**
     * Управляет анимацией исчезновения карточки перед появлением следующей.
     * @param {function} checkAborted - Функция для проверки прерывания.
     */
    async prepareNextWord(checkAborted) {
        await delay(DELAYS.BEFORE_NEXT_WORD);
        checkAborted();
        const card = document.getElementById('wordCard');
        if (card) {
            card.classList.add('word-crossfade', 'word-fade-out');
            await delay(DELAYS.CARD_FADE_OUT);
            checkAborted();
        }
    }

    /**
     * Перемещает контейнер аутентификации между мобильным и десктопным хедерами.
     */
    repositionAuthContainer() {
        const isMobile = window.innerWidth <= 768;
        const authContainer = document.querySelector('.auth-container');
        if (!authContainer) return;
        const mobileHeader = document.querySelector('.header-mobile');
        const desktopHeader = document.querySelector('.header');
        if (isMobile) {
            if (authContainer.parentElement !== mobileHeader) mobileHeader.appendChild(authContainer);
        } else {
            if (authContainer.parentElement !== desktopHeader) desktopHeader.appendChild(authContainer);
        }
    }
}