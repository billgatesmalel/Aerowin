/**
 * chat.js  — Plain script (NOT an ES module)
 *
 * Fix #5: This file must NOT use import/export.
 * It exposes toggleChat() and sendChatMessage() as globals.
 * Event listeners are wired in the HTML via addEventListener (not onclick).
 */

(function () {
    'use strict';

    // ─── State ───────────────────────────────────────────────────────────────
    let isOpen = false;

    // ─── Public API ──────────────────────────────────────────────────────────

    window.toggleChat = function () {
        const win = document.getElementById('chatWindow');
        if (!win) return;
        isOpen = !isOpen;
        win.classList.toggle('open', isOpen);
        if (isOpen) {
            const input = document.getElementById('chatInput');
            if (input) input.focus();
            scrollToBottom();
        }
    };

    window.sendChatMessage = function () {
        const input = document.getElementById('chatInput');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;

        appendMessage(text, 'user');
        input.value = '';

        // Auto-reply after short delay
        setTimeout(() => {
            appendMessage(
                '✅ Got your message! Our support team will respond shortly. ' +
                'For urgent issues please email support@aerowin.app',
                'assistant'
            );
        }, 900);
    };

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function appendMessage(text, role) {
        const body = document.getElementById('chatBody');
        if (!body) return;

        const now = new Date();
        const time = now.getHours().toString().padStart(2, '0') + ':' +
            now.getMinutes().toString().padStart(2, '0');

        const wrapper = document.createElement('div');
        wrapper.className = 'message ' + role;

        if (role === 'assistant') {
            wrapper.innerHTML = `
                <div class="avatar">🤖</div>
                <div class="msg-content">
                    <div class="sender-name">Assistant</div>
                    <p>${escHtml(text)}</p>
                    <span class="msg-time">${time}</span>
                </div>`;
        } else {
            wrapper.innerHTML = `
                <div class="msg-content user-msg">
                    <p>${escHtml(text)}</p>
                    <span class="msg-time">${time}</span>
                </div>`;
        }

        body.appendChild(wrapper);
        scrollToBottom();
    }

    function scrollToBottom() {
        const body = document.getElementById('chatBody');
        if (body) body.scrollTop = body.scrollHeight;
    }

    function escHtml(str) {
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

})();