// ══════════════════════════════════════════════
// AUTH.JS — Supabase Migration
// ══════════════════════════════════════════════
import { supabase } from './lib/supabase.js';

// ── Form toggle ───────────────────────────────
function toggleForms() {
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const resetForm = document.getElementById('resetForm');
    const messageBox = document.getElementById('messageBox');
    
    loginForm.classList.remove('active');
    signupForm.classList.add('active');
    resetForm.classList.remove('active');
    
    messageBox.className = 'message-box';
    messageBox.textContent = '';
}

function toggleResetForm(show) {
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const resetForm = document.getElementById('resetForm');
    const messageBox = document.getElementById('messageBox');

    if (show) {
        loginForm.classList.remove('active');
        signupForm.classList.remove('active');
        resetForm.classList.add('active');
    } else {
        loginForm.classList.add('active');
        signupForm.classList.remove('active');
        resetForm.classList.remove('active');
    }
    
    messageBox.className = 'message-box';
    messageBox.textContent = '';
}

// ── Message display ───────────────────────────
function showMessage(message, isSuccess = true) {
    const messageBox = document.getElementById('messageBox');
    if (!messageBox) return;
    messageBox.textContent = message;
    messageBox.className = 'message-box ' + (isSuccess ? 'success' : 'error');
    if (isSuccess) setTimeout(() => { messageBox.className = 'message-box'; }, 3000);
}

// ── Phone validation ──────────────────────────
function validatePhone(phone) {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 9 && cleaned.length <= 12;
}

function normalizePhone(phone) {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('254')) return cleaned;
    if (cleaned.startsWith('0')) return '254' + cleaned.substring(1);
    return '254' + cleaned;
}

// ── Haptic feedback helper ────────────────────
function haptic(pattern = [30]) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { }
}

// ── Referral code generator ───────────────────
function generateReferralCode(phone) {
    const tail = phone.slice(-4);
    const rand = Math.random().toString(36).substring(2, 4).toUpperCase();
    return (tail + rand).toUpperCase();
}

// ══════════════════════════════════════════════
// SIGN UP
// ══════════════════════════════════════════════
async function handleSignup(e) {
    if (e) e.preventDefault();
    haptic([20]);
    const phone = document.getElementById('signupPhone').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirm = document.getElementById('signupConfirm').value;
    const referral = (document.getElementById('signupReferral')?.value || '').trim().toUpperCase();
    const termsOk = document.getElementById('termsCheckbox')?.checked;

    if (!phone || !validatePhone(phone)) { showMessage('Invalid phone number', false); return; }
    if (password.length < 6) { showMessage('Password too short', false); return; }
    if (password !== confirm) { showMessage('Passwords do not match', false); return; }
    if (!termsOk) { showMessage('Please accept Terms & Conditions', false); return; }

    const normalizedPhone = normalizePhone(phone);
    const referralCode = generateReferralCode(normalizedPhone);

    showMessage('Creating account...', true);

    // 1. Supabase Auth Signup
    const { data: authData, error: authError } = await supabase.auth.signUp({
        email: normalizedPhone + '@aerowin.ke',
        password: password,
    });

    if (authError) {
        showMessage(authError.message, false);
        return;
    }

    if (!authData.user) {
        showMessage('Error creating account', false);
        return;
    }

    // 2. Create Profile in Database
    const { error: profileError } = await supabase
        .from('profiles')
        .insert([{
            id: authData.user.id,
            phone: normalizedPhone,
            balance: 1000,
            referral_code: referralCode,
            referred_by: referral || null,
        }]);

    if (profileError) {
        console.error('Profile error:', profileError);
        // User might exist but profile creation failed
    }

    showMessage('Account created! Logging in...', true);
    setTimeout(() => { window.location.href = 'index.html'; }, 1500);
}

// ══════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════
async function handleLogin(e) {
    if (e) e.preventDefault();
    haptic([20]);
    const phone = document.getElementById('loginPhone').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!phone || !password) { showMessage('All fields required', false); return; }

    const normalizedPhone = normalizePhone(phone);
    
    showMessage('Logging in...', true);

    const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedPhone + '@aerowin.ke',
        password: password,
    });

    if (error) {
        showMessage(error.message, false);
        return;
    }

    showMessage('Login successful!', true);
    setTimeout(() => { window.location.href = 'index.html'; }, 1000);
}

// ══════════════════════════════════════════════
// RESET PASSWORD
// ══════════════════════════════════════════════
async function handleResetPassword(e) {
    if (e) e.preventDefault();
    haptic([20]);
    const phone = document.getElementById('resetPhone').value.trim();
    if (!phone || !validatePhone(phone)) { showMessage('Invalid phone number', false); return; }

    const normalizedPhone = normalizePhone(phone);
    showMessage('Sending reset link...', true);

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedPhone + '@aerowin.ke', {
        redirectTo: window.location.origin + '/auth.html#reset',
    });

    if (error) {
        showMessage(error.message, false);
        return;
    }

    showMessage('Reset link sent to your registered channel!', true);
    setTimeout(() => toggleResetForm(false), 3000);
}

// ══════════════════════════════════════════════
// EXPOSE TO WINDOW
// ══════════════════════════════════════════════
window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.handleResetPassword = handleResetPassword;
window.toggleForms = toggleForms;
window.toggleResetForm = toggleResetForm;
window.normalizePhone = normalizePhone;
window.validatePhone = validatePhone;
window.haptic = haptic;