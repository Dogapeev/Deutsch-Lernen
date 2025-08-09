// --- START OF FILE app.js ---
class VocabularyApp {
    constructor(containerId) {
        this.appContainer = document.getElementById(containerId);
        this.allWords = []; // Будет хранить все записи из JSON
        this.history = []; // Для кнопки "назад"
        this.loadVocabulary();
    }

    async loadVocabulary() {
        try {
            const response = await fetch('vocabulary.json');
            if (!response.ok) throw new Error('Network response was not ok');
            this.allWords = await response.json();
            this.start();
        } catch (error) {
            this.appContainer.innerHTML = `<div class="card"><p>Ошибка загрузки словаря: ${error.message}</p></div>`;
        }
    }

    start() {
        this.bindEvents();
        // Начинаем с показа первой карточки в словаре (наш чанк)
        if (this.allWords.length > 0) {
            this.showCardById(this.allWords[0].id);
        }
    }

    bindEvents() {
        // Используем делегирование событий для обработки кликов внутри карточек
        this.appContainer.addEventListener('click', (event) => {
            const wordTarget = event.target.closest('.clickable-word');
            const backTarget = event.target.closest('.back-button');

            if (wordTarget && wordTarget.dataset.wordId) {
                event.preventDefault();
                this.showCardById(wordTarget.dataset.wordId, true); // true - значит, это переход с другой карточки
            } else if (backTarget) {
                event.preventDefault();
                this.goBack();
            }
        });
    }

    showCardById(cardId, isDrillDown = false) {
        const cardData = this.allWords.find(item => item.id === cardId);
        if (!cardData) {
            console.error(`Карточка с ID ${cardId} не найдена!`);
            return;
        }

        // Управление историей для кнопки "назад"
        if (isDrillDown) {
            // Если мы "проваливаемся" в слово, запоминаем, откуда пришли
            const previousCardId = this.history.length > 0 ? this.history[this.history.length - 1] : null;
            if (previousCardId !== cardId) { // чтобы не дублировать
                 this.history.push(this.appContainer.dataset.currentCardId);
            }
        } else {
            // Если это основной показ (не "проваливание"), история сбрасывается
            this.history = [];
        }
        this.appContainer.dataset.currentCardId = cardId;
        
        // Рендерим карточку в зависимости от ее типа
        let cardHtml = '';
        if (cardData.type === 'chunk') {
            cardHtml = this.renderChunkCard(cardData);
        } else if (cardData.type === 'word') {
            cardHtml = this.renderWordCard(cardData);
        }
        
        this.appContainer.innerHTML = cardHtml;
    }

    goBack() {
        const previousCardId = this.history.pop();
        if (previousCardId) {
            this.showCardById(previousCardId, false); // false - мы не "проваливаемся", а возвращаемся
        }
    }

    // --- РЕНДЕРЕРЫ ---

    renderChunkCard(cardData) {
        const phraseComponent = cardData.components.find(c => c.type === 'phrase');
        const noteComponent = cardData.components.find(c => c.type === 'usage_note');

        // Превращаем ссылки в data-атрибуты
        let displayHtml = phraseComponent.german_display;
        if (phraseComponent.german_template) {
             displayHtml = phraseComponent.german_template.replace(
                /\{word:(.*?)\}/g,
                (match, wordId) => `<strong class="clickable-word" data-word-id="${wordId}">${this.getWordById(wordId).components[0].german}</strong>`
            );
        }

        return `
            <div class="card chunk-card">
                <div class="phrase">${displayHtml}</div>
                <div class="phrase-translation">${phraseComponent.russian}</div>
                ${noteComponent ? `<div class="usage-note">${noteComponent.note}</div>` : ''}
            </div>
        `;
    }

    renderWordCard(cardData) {
        let componentsHtml = cardData.components.map(component => this.getComponentHTML(component)).join('');
        
        // Добавляем кнопку "назад", если мы пришли с другой карточки
        const backButtonHtml = this.history.length > 0 ? `<div class="back-button">&larr; Назад к фразе</div>` : '';

        return `<div class="card word-card">${componentsHtml}${backButtonHtml}</div>`;
    }

    // --- ХЕЛПЕРЫ ---

    getComponentHTML(component) {
        // Этот "мини-рендерер" собирает HTML для каждого компонента слова
        switch (component.type) {
            case 'word_display':
                return `<div class="word-display">${component.german}</div><div class="pronunciation">${component.pronunciation || ''}</div>`;
            case 'translation':
                return `<div class="translation">${component.russian}</div>`;
            case 'morpheme_breakdown':
                const morphemes = component.morphemes.map(m => `<span>${m.m} <small>(${m.t})</small></span>`).join(' - ');
                return `<div><h3>Морфемы</h3><div>${morphemes}</div></div>`;
            case 'verb_forms':
                 const forms = component.forms;
                 return `<div><h3>Формы</h3><p>Perfekt: <strong>${forms.hilfsverb} ${forms.partizip_ii}</strong></p></div>`;
            default:
                return '';
        }
    }
    
    getWordById(wordId) {
        return this.allWords.find(w => w.id === wordId);
    }
}

// Запускаем приложение
new VocabularyApp('app');
// --- END OF FILE app.js ---
