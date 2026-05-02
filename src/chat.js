// ── CHAT WIDGET LOGIC ──
function toggleChat() {
    const chatWindow = document.getElementById('chatWindow');
    if (!chatWindow) return;
    chatWindow.classList.toggle('open');
    if (chatWindow.classList.contains('open')) {
        const input = document.getElementById('chatInput');
        if (input) input.focus();
    }
}

function handleChatKey(e) {
    if (e.key === 'Enter') sendChatMessage();
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const message = input.value.trim();
    if (!message) return;

    // 1. Add User Message to UI
    addMessageToUI('user', message);
    input.value = '';

    // 2. Simulate Bot Response or logic
    // In a real app, you would send this to a backend/Supabase
    setTimeout(() => {
        addMessageToUI('assistant', "Thanks for your message! Our admin will get back to you shortly. You can also reach us directly at <a href='tel:0799289214' style='color:#25d366;font-weight:bold;'>0799289214</a>. 😊");
    }, 1200);
}

function addMessageToUI(type, text) {
    const chatBody = document.getElementById('chatBody');
    if (!chatBody) return;
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;
    
    let avatar = (type === 'assistant') ? '🤖' : '👤';
    let name = (type === 'assistant') ? 'Assistant' : 'You';

    msgDiv.innerHTML = `
        <div class="avatar">${avatar}</div>
        <div class="msg-content">
            <div class="sender-name">${name}</div>
            <p>${text}</p>
            <span class="msg-time">${timeStr}</span>
        </div>
    `;

    chatBody.appendChild(msgDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
}

// Expose to window for inline onclick handlers
window.toggleChat = toggleChat;
window.handleChatKey = handleChatKey;
window.sendChatMessage = sendChatMessage;
