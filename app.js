class VocabularyApp {
    constructor(containerId) {
        this.appContainer = document.getElementById(containerId);
        if (!this.appContainer) { console.error(`Контейнер с id "${containerId}" не найден!`); return; }
        this.allData = [];
        this.currentCardIndex = 0;
        this.isNavigating = false;
        this.speechSynth = window.speechSynthesis;
        this.germanVoice = null;
        this.initSpeechSynthesis();
        this.loadVocabulary();
    }

    initSpeechSynthesis() {
        const setVoice = () => { this.germanVoice = this.speechSynth.getVoices().find(voice => voice.lang === 'de-DE'); };
        if (this.speechSynth.getVoices().length) { setVoice(); } else { this.speechSynth.onvoiceschanged = setVoice; }
    }

    speak(text) {
        if (!this.speechSynth || !text) return;
        this.speechSynth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'de-DE';
        if (this.germanVoice) { utterance.voice = this.germanVoice; }
        utterance.rate = 0.9;
        this.speechSynth.speak(utterance);
    }

    async loadVocabulary() {
        try {
            const response = await fetch('vocabulary.json');
            if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
            this.allData = await response.json();
            this.start();
        } catch (error) { this.appContainer.innerHTML = `<div class="card"><p>Ошибка загрузки словаря: ${error.message}</p></div>`; }
    }

    start() {
        this.bindEvents();
        this.showCurrentCard();
    }

    getMainCards() { return this.allData.filter(c => c.type === 'chunk'); }

    showCurrentCard() {
        const mainCards = this.getMainCards();
        if (mainCards.length > 0) {
            const cardData = mainCards[this.currentCardIndex];
            this.appContainer.innerHTML = this.renderPhraseCard(cardData);
            const phraseComponent = cardData.components.find(c => c.type === 'phrase');
            const textToSpeak = phraseComponent.german_display.replace(/<[^>]+>/g, '').trim();
            this.speak(textToSpeak);
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
        document.addEventListener('keydown', (event) => { if (event.key === 'ArrowRight') this.navigate(1); else if (event.key === 'ArrowLeft') this.navigate(-1); });
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

    toggleDetails(targetElement) {
        const cardElement = targetElement.closest('.card');
        const detailsContainer = cardElement.querySelector('.details-container');
        const chunkId = targetElement.dataset.chunkId;

        if (cardElement.classList.contains('expanded')) {
            cardElement.classList.remove('expanded');
        } else {
            const chunkData = this.allData.find(item => item.id === chunkId);
            const morphemeComponent = chunkData.components.find(c => c.type === 'morpheme_breakdown');

            if (morphemeComponent) {
                detailsContainer.innerHTML = `<div class="details-content">${this.getMorphemeHTML(morphemeComponent)}</div>`;
                cardElement.classList.add('expanded');
            }
        }
    }

    renderPhraseCard(cardData) {
        const phraseComponent = cardData.components.find(c => c.type === 'phrase');
        return `<div class="card chunk-card" data-id="${cardData.id}"><button class="nav-arrow nav-prev">‹</button><div class="phrase-container"><div class="phrase">${phraseComponent.german_display}</div><div class="phrase-translation">– ${phraseComponent.russian}</div></div><div class="details-container"></div><button class="nav-arrow nav-next">›</button></div>`;
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
}

new VocabularyApp('app');