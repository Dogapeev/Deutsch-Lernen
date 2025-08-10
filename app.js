class EventBus {
    constructor() { this.events = new Map(); }
    on(event, callback) { if (!this.events.has(event)) { this.events.set(event, []); } this.events.get(event).push(callback); }
    emit(event, data) { if (this.events.has(event)) { this.events.get(event).forEach(callback => callback(data)); } }
    off(event, callback) { if (this.events.has(event)) { const callbacks = this.events.get(event); const index = callbacks.indexOf(callback); if (index > -1) { callbacks.splice(index, 1); } } }
}

class VocabularyApp {
    constructor(containerId) {
        this.appContainer = document.getElementById(containerId);
        if (!this.appContainer) { console.error(`Контейнер с id "${containerId}" не найден!`); return; }

        this.allData = [];
        this.currentCardIndex = 0;
        this.isNavigating = false;

        // ИСПРАВЛЕНИЕ 1: Добавляем недостающие свойства
        this.speechSynth = window.speechSynthesis;
        this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this.speechReady = false;
        this.germanVoice = null;
        this.voicesLoading = false;

        // ИСПРАВЛЕНИЕ 2: Возвращаем EventBus архитектуру
        this.eventBus = new EventBus();
        this.setupEventHandlers();

        this.initSpeechSynthesis();
        this.loadVocabulary();
    }

    // ИСПРАВЛЕНИЕ 2: Возвращаем EventBus обработчики
    setupEventHandlers() {
        this.eventBus.on('card:changed', (data) => {
            const phraseComponent = data.card.components.find(c => c.type === 'phrase');
            if (phraseComponent) {
                const textToSpeak = phraseComponent.german_display.replace(/<[^>]+>/g, '').trim();
                this.speak(textToSpeak);
            }
        });
    }

    initSpeechSynthesis() {
        if (!('speechSynthesis' in window)) { console.warn('Speech Synthesis не поддерживается'); return; }
        const initSpeech = () => {
            if (this.speechReady) return;
            if (this.isMobile) { const wakeUtterance = new SpeechSynthesisUtterance(''); this.speechSynth.speak(wakeUtterance); }
            this.speechReady = true;
            this.loadVoices();
            console.log('✅ Speech готов к работе');
            if (/iPad|iPhone|iPod/.test(navigator.userAgent)) { setInterval(() => { if (this.speechSynth.paused) { this.speechSynth.resume(); } }, 1500); }
            if (/Android/i.test(navigator.userAgent)) { document.addEventListener('visibilitychange', () => { if (document.hidden && this.speechSynth.speaking) { this.speechSynth.pause(); } else if (!document.hidden && this.speechSynth.paused) { this.speechSynth.resume(); } }); }
        };
        document.addEventListener('click', initSpeech, { once: true });
        if (!this.isMobile) { setTimeout(initSpeech, 100); }
    }

    loadVoices() {
        const voices = this.speechSynth.getVoices();
        if (voices.length === 0) {
            if (!this.voicesLoading) { this.voicesLoading = true; this.speechSynth.onvoiceschanged = () => { this.voicesLoading = false; this.loadVoices(); }; }
            return;
        }
        this.germanVoice = voices.find(v => v.lang === 'de-DE') || voices.find(v => v.lang.startsWith('de'));
        if (this.germanVoice) { console.log('✅ Немецкий голос:', this.germanVoice.name); } else { console.warn('⚠️ Немецкий голос не найден'); }
    }

    speak(text, lang = 'de-DE', rate = 0.9) {
        if (!this.speechReady || !text || !this.speechSynth) return;
        const cleanText = text.replace(/<[^>]*>/g, '').trim();
        if (!cleanText) return;
        this.speechSynth.cancel();
        setTimeout(() => {
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = lang;
            utterance.rate = rate;
            if (lang.startsWith('de') && this.germanVoice) { utterance.voice = this.germanVoice; }
            utterance.onerror = (e) => console.warn('Ошибка речи:', e.error);
            const timeoutId = setTimeout(() => { if (this.speechSynth.speaking) { this.speechSynth.cancel(); console.warn('Speech timeout - принудительная остановка'); } }, cleanText.length * 100 + 3000);
            utterance.onend = () => clearTimeout(timeoutId);
            this.speechSynth.speak(utterance);
        }, this.isMobile ? 50 : 0);
    }

    async loadVocabulary() {
        try {
            const response = await fetch('vocabulary.json');
            if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
            this.allData = await response.json();
            this.start();
        } catch (error) {
            this.appContainer.innerHTML = `<div class="card"><p>Ошибка загрузки словаря: ${error.message}</p></div>`;
        }
    }

    start() {
        this.bindEvents();
        this.showCurrentCard();
    }

    getMainCards() {
        return this.allData.filter(c => c.type === 'chunk');
    }

    showCurrentCard() {
        const mainCards = this.getMainCards();
        if (mainCards.length > 0) {
            const cardData = mainCards[this.currentCardIndex];
            this.appContainer.innerHTML = this.renderPhraseCard(cardData);

            // ИСПРАВЛЕНИЕ 2: Используем EventBus вместо прямого вызова
            this.eventBus.emit('card:changed', {
                card: cardData,
                index: this.currentCardIndex,
                total: mainCards.length
            });
        }
    }

    bindEvents() {
        this.appContainer.addEventListener('click', (event) => {
            const wordTarget = event.target.closest('.clickable-word');
            const prevArrow = event.target.closest('.nav-prev');
            const nextArrow = event.target.closest('.nav-next');
            if (wordTarget && wordTarget.dataset.chunkId) { this.toggleDetails(wordTarget); }
            else if (prevArrow) { this.navigate(-1); }
            else if (nextArrow) { this.navigate(1); }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowRight') this.navigate(1);
            else if (event.key === 'ArrowLeft') this.navigate(-1);
        });
    }

    navigate(direction) {
        if (this.isNavigating) return;
        this.isNavigating = true;
        const cardElement = this.appContainer.querySelector('.card');
        const switchCard = () => {
            const mainCards = this.getMainCards();
            if (mainCards.length === 0) return;
            this.currentCardIndex = (this.currentCardIndex + direction + mainCards.length) % mainCards.length;
            this.showCurrentCard();
            setTimeout(() => { this.isNavigating = false; }, 50);
        };
        if (cardElement) {
            cardElement.classList.add('card-fade-out');
            setTimeout(switchCard, 200);
        } else {
            switchCard();
        }
    }

    // ИСПРАВЛЕНИЕ 3: Возвращаем простую логику морфем
    toggleDetails(targetElement) {
        const cardElement = targetElement.closest('.card');
        const detailsContainer = cardElement.querySelector('.details-container');
        const chunkId = targetElement.dataset.chunkId;

        if (cardElement.classList.contains('expanded')) {
            cardElement.classList.remove('expanded');
        } else {
            const chunkData = this.allData.find(item => item.id === chunkId);
            const morphemeComponent = chunkData?.components.find(c => c.type === 'morpheme_breakdown');

            if (morphemeComponent) {
                detailsContainer.innerHTML = `<div class="details-content">${this.getMorphemeHTML(morphemeComponent)}</div>`;
                cardElement.classList.add('expanded');
            }
        }
    }

    renderPhraseCard(cardData) {
        const phraseComponent = cardData.components.find(c => c.type === 'phrase');
        return `
            <div class="card chunk-card" data-id="${cardData.id}">
                <button class="nav-arrow nav-prev">‹</button>
                <div class="phrase-container">
                    <div class="phrase">${phraseComponent.german_display}</div>
                    <div class="phrase-translation">– ${phraseComponent.russian}</div>
                </div>
                <div class="details-container"></div>
                <button class="nav-arrow nav-next">›</button>
            </div>
        `;
    }

    // ИСПРАВЛЕНИЕ 4: Возвращаем метод getMorphemeHTML
    getMorphemeHTML(component) {
        const morphemesHtml = component.morphemes.map(m => `
            <div class="morpheme-item">
                <span class="morpheme-german">${m.m}</span>
                <span class="morpheme-russian">${m.t}</span>
            </div>
        `).join('<span class="morpheme-separator">+</span>');
        return `<div class="morpheme-container">${morphemesHtml}</div>`;
    }
}

new VocabularyApp('app');