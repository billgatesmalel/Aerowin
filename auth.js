// ══════════════════════════════════════════════

// AUTH.JS — Fixed & Hardened

// ══════════════════════════════════════════════



const SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours



// Simple but better than btoa: FNV-1a hash + salt

function hashPassword(password, salt) {

    const str = salt + password + 'aerowin_aviator_2024';

    let hash = 2166136261;

    for (let i = 0; i < str.length; i++) {

        hash ^= str.charCodeAt(i);

        hash = (hash * 16777619) >>> 0;

    }

    return hash.toString(16) + '_' + salt;

}



function generateSalt() {

    return Math.random().toString(36).substring(2, 10) +

        Math.random().toString(36).substring(2, 10);

}



function toggleForms() {

    const loginForm = document.getElementById('loginForm');

    const signupForm = document.getElementById('signupForm');

    const messageBox = document.getElementById('messageBox');



    loginForm.classList.toggle('active');

    signupForm.classList.toggle('active');

    messageBox.className = 'message-box';

    messageBox.textContent = '';

}



function showMessage(message, isSuccess = true) {

    const messageBox = document.getElementById('messageBox');

    messageBox.textContent = message;

    messageBox.className = 'message-box ' + (isSuccess ? 'success' : 'error');



    if (isSuccess) {

        setTimeout(() => { messageBox.className = 'message-box'; }, 3000);

    }

}



function validatePhone(phone) {

    const cleaned = phone.replace(/\D/g, '');

    if (cleaned.startsWith('254') && cleaned.length === 12) return true;

    if (cleaned.startsWith('7') && cleaned.length === 9) return true;

    if (cleaned.length === 10) return true;

    return false;

}



function normalizePhone(phone) {

    const cleaned = phone.replace(/\D/g, '');

    if (cleaned.startsWith('254')) return cleaned;

    if (cleaned.startsWith('0')) return '254' + cleaned.substring(1);

    return '254' + cleaned;

}



function handleSignup() {

    const phone = document.getElementById('signupPhone').value.trim();

    const password = document.getElementById('signupPassword').value;

    const confirm = document.getElementById('signupConfirm').value;



    if (!phone) { showMessage('Please enter a phone number', false); return; }

    if (!validatePhone(phone)) { showMessage('Invalid phone number format', false); return; }

    if (!password) { showMessage('Please enter a password', false); return; }

    if (password.length < 6) { showMessage('Password must be at least 6 characters', false); return; }

    if (password !== confirm) { showMessage('Passwords do not match', false); return; }



    const users = JSON.parse(localStorage.getItem('aviatorUsers')) || {};

    const normalizedPhone = normalizePhone(phone);



    if (users[normalizedPhone]) {

        showMessage('Account already exists with this number', false);

        return;

    }



    const salt = generateSalt();

    // Referral bonus: KES 20 each for new user and referrer
    const REFERRAL_BONUS = 20;
    const referralInput = document.getElementById('signupReferral');
    const referralRaw = referralInput ? referralInput.value.trim() : '';
    const referralPhone = referralRaw ? normalizePhone(referralRaw) : null;

    let newBalance = 1000;
    let referralMsg = '';

    if (referralPhone && referralPhone !== normalizedPhone && users[referralPhone]) {
        // Credit new user
        newBalance += REFERRAL_BONUS;
        // Credit referrer
        users[referralPhone].balance = (users[referralPhone].balance || 0) + REFERRAL_BONUS;
        referralMsg = ` +KES ${REFERRAL_BONUS} referral bonus!`;
    } else if (referralPhone && referralPhone !== normalizedPhone && !users[referralPhone]) {
        referralMsg = ' (Referral code not found – no bonus applied)';
    }

    users[normalizedPhone] = {

        phone: normalizedPhone,

        passwordHash: hashPassword(password, salt),

        balance: newBalance,

        createdAt: new Date().toISOString()

    };



    localStorage.setItem('aviatorUsers', JSON.stringify(users));

    showMessage('Account created!' + referralMsg + ' Logging in...', true);

    setTimeout(() => { loginUser(normalizedPhone); }, 1800);

}



function handleLogin() {

    const phone = document.getElementById('loginPhone').value.trim();

    const password = document.getElementById('loginPassword').value;



    if (!phone) { showMessage('Please enter a phone number', false); return; }

    if (!password) { showMessage('Please enter a password', false); return; }



    const users = JSON.parse(localStorage.getItem('aviatorUsers')) || {};

    const normalizedPhone = normalizePhone(phone);



    if (!users[normalizedPhone]) { showMessage('Account not found', false); return; }



    const user = users[normalizedPhone];



    // Support old btoa accounts and new hashed accounts

    let valid = false;

    if (user.passwordHash) {

        const salt = user.passwordHash.split('_')[1];

        valid = hashPassword(password, salt) === user.passwordHash;

    } else if (user.password) {

        // Migrate old btoa account

        valid = user.password === btoa(password);

        if (valid) {

            const salt = generateSalt();

            user.passwordHash = hashPassword(password, salt);

            delete user.password;

            localStorage.setItem('aviatorUsers', JSON.stringify(users));

        }

    }



    if (!valid) { showMessage('Incorrect password', false); return; }

    loginUser(normalizedPhone);

}



function loginUser(phoneNumber) {

    const users = JSON.parse(localStorage.getItem('aviatorUsers')) || {};

    const user = users[phoneNumber];

    if (!user) return;



    localStorage.setItem('currentUser', JSON.stringify({

        phone: user.phone,

        balance: user.balance,

        loginTime: new Date().toISOString(),

        expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),

        createdAt: user.createdAt

    }));



    showMessage('Login successful! Redirecting...', true);

    setTimeout(() => { window.location.href = 'index.html'; }, 1000);

}



// Check if already logged in with valid session

window.addEventListener('load', () => {

    const stored = localStorage.getItem('currentUser');

    if (stored) {

        try {

            const user = JSON.parse(stored);

            if (user.expiresAt && new Date(user.expiresAt) > new Date()) {

                window.location.href = 'index.html';

            } else {

                // Expired — clear it

                localStorage.removeItem('currentUser');

            }

        } catch (e) {

            localStorage.removeItem('currentUser');

        }

    }

});