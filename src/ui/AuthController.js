// src/ui/AuthController.js
"use strict";

// Импортируем необходимые функции из Firebase SDK
import { GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";

/**
 * Управляет всем UI и логикой, связанной с аутентификацией пользователя.
 */
export class AuthController {
    /**
     * @param {object} options
     * @param {object} options.auth - Экземпляр Firebase Auth.
     * @param {function} options.showNotification - Функция для отображения уведомлений.
     */
    constructor({ auth, showNotification }) {
        this.auth = auth;
        this.showNotification = showNotification; // Сохраняем колбэк для уведомлений
        this.elements = {};
    }

    /**
     * Находит все DOM-элементы и привязывает обработчики событий.
     */
    init() {
        this.elements = {
            // Контейнер, который перемещается между хедерами
            container: document.querySelector('.auth-container'),
            // Элементы в хедерах
            openAuthBtn: document.getElementById('openAuthBtn'),
            userProfile: document.getElementById('userProfile'),
            signOutBtn: document.getElementById('signOutBtn'),
            userAvatar: document.getElementById('userAvatar'),
            userInitials: document.getElementById('userInitials'),
            userDisplayName: document.getElementById('userDisplayName'),
            userEmail: document.getElementById('userEmail'),
            // Элементы модального окна
            modal: document.getElementById('authModal'),
            overlay: document.getElementById('authOverlay'),
            closeModalBtn: document.getElementById('closeAuthBtn'),
            googleSignInBtn: document.getElementById('googleSignInBtn'),
            googleSignUpBtn: document.getElementById('googleSignUpBtn'),
            tabs: document.querySelectorAll('.auth-tab'),
            tabContents: document.querySelectorAll('.auth-tab-content'),
            signinForm: document.getElementById('signinForm'),
            signupForm: document.getElementById('signupForm'),
            resetPasswordForm: document.getElementById('resetPasswordForm'),
            forgotPasswordBtn: document.getElementById('forgotPasswordBtn'),
            backToSigninBtn: document.getElementById('backToSigninBtn'),
        };

        this._bindEvents();
    }

    /**
     * Привязывает все обработчики событий к элементам UI.
     */
    _bindEvents() {
        this.elements.openAuthBtn?.addEventListener('click', () => this.toggleModal(true));
        this.elements.closeModalBtn?.addEventListener('click', () => this.toggleModal(false));
        this.elements.overlay?.addEventListener('click', () => this.toggleModal(false));
        this.elements.signOutBtn?.addEventListener('click', () => signOut(this.auth));
        this.elements.googleSignInBtn?.addEventListener('click', () => this._signInWithGoogle());
        this.elements.googleSignUpBtn?.addEventListener('click', () => this._signInWithGoogle());

        this.elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        this.elements.forgotPasswordBtn?.addEventListener('click', () => this.switchTab('resetPassword'));
        this.elements.backToSigninBtn?.addEventListener('click', () => this.switchTab('signin'));

        this.elements.signupForm?.addEventListener('submit', e => this._handleSignUpWithEmail(e));
        this.elements.signinForm?.addEventListener('submit', e => this._handleSignInWithEmail(e));
        this.elements.resetPasswordForm?.addEventListener('submit', e => this._handlePasswordReset(e));
    }

    /**
     * Обновляет UI в хедере в зависимости от того, вошел пользователь или нет.
     * @param {object|null} user - Объект пользователя Firebase или null.
     */
    updateAuthUI(user) {
        if (!this.elements.openAuthBtn) return;
        if (user) {
            this.elements.openAuthBtn.style.display = 'none';
            this.elements.userProfile.style.display = 'flex';
            this.elements.userDisplayName.textContent = user.displayName || 'Пользователь';
            this.elements.userEmail.textContent = user.email;

            if (user.photoURL) {
                this.elements.userAvatar.src = user.photoURL;
                this.elements.userAvatar.style.display = 'block';
                this.elements.userInitials.style.display = 'none';
            } else {
                this.elements.userAvatar.style.display = 'none';
                this.elements.userInitials.style.display = 'flex';
                this.elements.userInitials.textContent = (user.displayName || 'U').charAt(0);
            }
        } else {
            this.elements.openAuthBtn.style.display = 'flex';
            this.elements.userProfile.style.display = 'none';
        }
    }

    /**
     * Показывает или скрывает модальное окно аутентификации.
     * @param {boolean} show
     */
    toggleModal(show) {
        if (show) {
            this.elements.modal.classList.add('visible');
            this.elements.overlay.classList.add('visible');
            this.switchTab('signin');
        } else {
            this.elements.modal.classList.remove('visible');
            this.elements.overlay.classList.remove('visible');
        }
    }

    /**
     * Переключает вкладки в модальном окне (вход/регистрация/сброс).
     * @param {string} tabId
     */
    switchTab(tabId) {
        this.elements.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${tabId}Tab`);
        });
        this.elements.tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabId);
        });
    }

    // --- Приватные методы для взаимодействия с Firebase ---

    async _signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(this.auth, provider);
            this.toggleModal(false);
        } catch (error) {
            console.error("Ошибка входа через Google:", error);
            this.showNotification(`Ошибка: ${error.message}`, 'error');
        }
    }

    async _handleSignUpWithEmail(e) {
        e.preventDefault();
        const name = e.target.signupName.value;
        const email = e.target.signupEmail.value;
        const password = e.target.signupPassword.value;
        const passwordConfirm = e.target.signupPasswordConfirm.value;

        if (password !== passwordConfirm) {
            this.showNotification('Пароли не совпадают!', 'error');
            return;
        }

        try {
            const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
            await updateProfile(userCredential.user, { displayName: name });
            this.toggleModal(false);
            this.showNotification(`Добро пожаловать, ${name}!`, 'success');
        } catch (error) {
            console.error("Ошибка регистрации:", error);
            this.showNotification(this._getFirebaseAuthErrorMessage(error), 'error');
        }
    }

    async _handleSignInWithEmail(e) {
        e.preventDefault();
        const email = e.target.signinEmail.value;
        const password = e.target.signinPassword.value;
        try {
            await signInWithEmailAndPassword(this.auth, email, password);
            this.toggleModal(false);
        } catch (error) {
            console.error("Ошибка входа:", error);
            this.showNotification(this._getFirebaseAuthErrorMessage(error), 'error');
        }
    }

    async _handlePasswordReset(e) {
        e.preventDefault();
        const email = e.target.resetEmail.value;
        try {
            await sendPasswordResetEmail(this.auth, email);
            this.showNotification('Письмо для сброса пароля отправлено на ваш email.', 'success');
            this.switchTab('signin');
        } catch (error) {
            console.error("Ошибка сброса пароля:", error);
            this.showNotification(this._getFirebaseAuthErrorMessage(error), 'error');
        }
    }

    _getFirebaseAuthErrorMessage(error) {
        switch (error.code) {
            case 'auth/email-already-in-use': return 'Этот email уже зарегистрирован.';
            case 'auth/invalid-email': return 'Неверный формат email.';
            case 'auth/weak-password': return 'Пароль слишком слабый (минимум 6 символов).';
            case 'auth/user-not-found':
            case 'auth/wrong-password': return 'Неверный email или пароль.';
            default: return 'Произошла ошибка. Попробуйте снова.';
        }
    }
}