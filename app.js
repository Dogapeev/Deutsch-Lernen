// БЫСТРЫЙ РЕФАКТОРИНГ: Добавляем EventBus в существующий код
// Замените ваш текущий app.js этим улучшенным вариантом

// Добавляем EventBus прямо в начало
class EventBus {
    constructor() {
        this.events = new Map();
    }

    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(callback);
    }

    emit(event, data) {
        if (this.events.has(event)) {
            this.events.get(event).forEach(callback => callback(data));
        }
    }

    off(event, callback) {
        if (this.events.has(event)) {
            const callbacks = this.events.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
        }
    }
}

// Улучшенная версия вашего VocabularyApp
class VocabularyApp {
    constructor(containerId) {
        this.appContainer = document.getElementById(containerId);
        if (!this.appContainer) {
            console.error(`Контейнер с id "${containerId}" не найден!`);
            return;
        }

        // Добавляем EventBus
        this.eventBus = new EventBus();

        // Ваши существующие свойства
        this.allData = [];
        this.currentCardIndex = 0;
        this.isNavigating = false;
        this.speechSynth = window.speechSynthesis;
        this.germanVoice = null;

        // Инициализация
        this.setupEventHandlers();
        this.initSpeechSynthesis();
        this.loadVocabulary();
    }

    // Новый метод: настройка событий
    setupEventHandlers() {
        this.eventBus.on('card:navigate', (direction) => this.navigate(direction));
        this.eventBus.on('card:details', (data) => this.toggleDetails(data.element));
        this.eventBus.on('speech:speak', (text) => this.speak(text));
        this.eventBus.on('vocabulary:reload', () => this.loadVocabulary());
    }

    initSpeechSynthesis() {
        const setVoice = () => {
            this.germanVoice = this.speechSynth.getVoices().find(voice => voice.lang === 'de-DE');
        };
        if (this.speechSynth.getVoices().length) {
            setVoice();
        } else {
            this.speechSynth.onvoiceschanged = setVoice;
        }
    }

    speak(text) {
        if (!this.speechSynth || !text) return;
        this.speechSynth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'de-DE';
        if (this.germanVoice) { utterance.voice = this.germanVoice; }
        utterance.rate = 0.9;
        this.speechSynth.speak(utterance);

        // Уведомляем о произношении
        this.eventBus.emit('speech:started', text);
    }

    async loadVocabulary() {
        try {
            this.eventBus.emit('vocabulary:loading');

            const response = await fetch('vocabulary.json');
            if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);

            this.allData = await response.json();
            this.eventBus.emit('vocabulary:loaded', { data: this.allData, count: this.allData.length });

            this.start();
        } catch (error) {
            this.eventBus.emit('vocabulary:error', error);
            this.appContainer.innerHTML = `<div class="card"><p>Ошибка загрузки словаря: ${error.message}</p></div>`;
        }
    }

    start() {
        this.bindEvents();
        this.showCurrentCard();
        this.eventBus.emit('app:started');
    }

    getMainCards() {
        return this.allData.filter(c => c.type === 'chunk');
    }

    showCurrentCard() {
        const mainCards = this.getMainCards();
        if (mainCards.length > 0) {
            const cardData = mainCards[this.currentCardIndex];
            this.renderCard(cardData);

            // Автоматическое произношение
            const phraseComponent = cardData.components.find(c => c.type === 'phrase');
            if (phraseComponent) {
                const textToSpeak = phraseComponent.german_display.replace(/<[^>]+>/g, '').trim();
                this.speak(textToSpeak);
            }

            // Уведомляем о смене карточки
            this.eventBus.emit('card:changed', {
                card: cardData,
                index: this.currentCardIndex,
                total: mainCards.length
            });
        }
    }

    // Разделяем логику отображения
    renderCard(cardData) {
        this.appContainer.innerHTML = this.renderPhraseCard(cardData);
    }

    bindEvents() {
        // Улучшенная обработка событий через делегирование
        this.appContainer.addEventListener('click', (event) => {
            const wordTarget = event.target.closest('.clickable-word');
            const prevArrow = event.target.closest('.nav-prev');
            const nextArrow = event.target.closest('.nav-next');

            if (wordTarget && wordTarget.dataset.chunkId) {
                this.eventBus.emit('card:details', { element: wordTarget });
            }
            else if (prevArrow) {
                this.eventBus.emit('card:navigate', -1);
            }
            else if (nextArrow) {
                this.eventBus.emit('card:navigate', 1);
            }
        });

        // Клавиатурная навигация
        document.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowRight') this.eventBus.emit('card:navigate', 1);
            else if (event.key === 'ArrowLeft') this.eventBus.emit('card:navigate', -1);
        });
    }

    navigate(direction) {
        if (this.isNavigating) return;

        this.isNavigating = true;
        const cardElement = this.appContainer.querySelector('.card');

        const switchCard = () => {
            const mainCards = this.getMainCards();
            if (mainCards.length === 0) return;

            const oldIndex = this.currentCardIndex;
            this.currentCardIndex = (this.currentCardIndex + direction + mainCards.length) % mainCards.length;

            this.showCurrentCard();

            // Уведомляем о навигации
            this.eventBus.emit('navigation:completed', {
                from: oldIndex,
                to: this.currentCardIndex,
                direction
            });

            setTimeout(() => { this.isNavigating = false; }, 50);
        };

        if (cardElement) {
            cardElement.classList.add('card-fade-out');
            setTimeout(switchCard, 200);
        } else {
            switchCard();
        }
    }

    toggleDetails(targetElement) {
        const cardElement = targetElement.closest('.card');
        const detailsContainer = cardElement.querySelector('.details-container');
        const chunkId = targetElement.dataset.chunkId;

        if (cardElement.classList.contains('expanded')) {
            cardElement.classList.remove('expanded');
            this.eventBus.emit('details:hidden', { chunkId });
        } else {
            const chunkData = this.allData.find(item => item.id === chunkId);
            const morphemeComponent = chunkData?.components.find(c => c.type === 'morpheme_breakdown');

            if (morphemeComponent) {
                detailsContainer.innerHTML = `<div class="details-content">${this.getMorphemeHTML(morphemeComponent)}</div>`;
                cardElement.classList.add('expanded');
                this.eventBus.emit('details:shown', { chunkId, morphemes: morphemeComponent.morphemes });
            }
        }
    }

    renderPhraseCard(cardData) {
        const phraseComponent = cardData.components.find(c => c.type === 'phrase');
        return `
            <div class="card chunk-card" data-id="${cardData.id}">
                <button class="nav-arrow nav-prev" title="Предыдущая карточка">‹</button>
                <div class="phrase-container">
                    <div class="phrase">${phraseComponent.german_display}</div>
                    <div class="phrase-translation">– ${phraseComponent.russian}</div>
                </div>
                <div class="details-container"></div>
                <button class="nav-arrow nav-next" title="Следующая карточка">›</button>
            </div>
        `;
    }

    getMorphemeHTML(component) {
        const morphemesHtml = component.morphemes.map(m => `
            <div class="morpheme-item">
                <span class="morpheme-german">${m.m}</span>
                <span class="morpheme-russian">${m.t}</span>
            </div>
        `).join('<span class="morpheme-separator">+</span>');
        return `<div class="morpheme-container">${morphemesHtml}</div>`;
    }

    // Новые методы для расширения функциональности
    addEventListenter(event, callback) {
        this.eventBus.on(event, callback);
    }

    getProgress() {
        const mainCards = this.getMainCards();
        return {
            current: this.currentCardIndex + 1,
            total: mainCards.length,
            percentage: mainCards.length > 0 ? Math.round(((this.currentCardIndex + 1) / mainCards.length) * 100) : 0
        };
    }

    getCurrentCard() {
        const mainCards = this.getMainCards();
        return mainCards[this.currentCardIndex] || null;
    }

    // Методы для внешнего управления
    goToCard(index) {
        const mainCards = this.getMainCards();
        if (index >= 0 && index < mainCards.length) {
            this.currentCardIndex = index;
            this.showCurrentCard();
        }
    }

    // Деструктор для очистки
    destroy() {
        this.eventBus.off();
        this.speechSynth.cancel();
        this.appContainer.innerHTML = '';
    }
}

// Создаем экземпляр с улучшенной функциональностью
const app = new VocabularyApp('app');

// Добавляем глобальные обработчики для расширенной функциональности
app.addEventListenter('vocabulary:loaded', (data) => {
    console.log(`📚 Словарь загружен: ${data.count} элементов`);
});

app.addEventListenter('card:changed', (data) => {
    console.log(`📄 Карточка ${data.index + 1} из ${data.total}`);

    // Можно добавить прогресс-бар
    const progress = (data.index + 1) / data.total * 100;
    document.title = `Deutsch Lernen - ${Math.round(progress)}%`;
});

app.addEventListenter('details:shown', (data) => {
    console.log(`🔍 Показаны детали для ${data.chunkId}:`, data.morphemes);
});

// Делаем доступным для консоли разработчика
window.vocabularyApp = app;