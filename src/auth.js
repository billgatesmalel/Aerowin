/**
 * auth.js  (ES Module)
 *
 * All auth logic lives here as a proper ES module.
 * Functions are explicitly attached to `window` so the event listeners
 * wired up in auth.html's inline <script> can call them.
 *
 * Fix #4: No inline onsubmit/onclick attributes needed — everything is
 * wired via addEventListener in the HTML's DOMContentLoaded block.
 */

import { supabase } from './lib/supabase.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function showMessage(msg, type = 'info') {
    const box = document.getElementById('messageBox');
    if (!box) return;
    box.textContent = msg;
    box.className = `message-box ${type}`;
    box.style.display = 'block';
    setTimeout(() => { box.style.display = 'none'; }, 5000);
}

/** Normalise Kenyan phone to +2547XXXXXXXX format */
function normalisePhone(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('254')) return '+' + digits;
    if (digits.startsWith('0')) return '+254' + digits.slice(1);
    if (digits.startsWith('7') || digits.startsWith('1')) return '+254' + digits;
    return '+' + digits;
}

// ─── Form Toggles ─────────────────────────────────────────────────────────

window.toggleForms = function () {
    const login = document.getElementById('loginForm');
    const signup = document.getElementById('signupForm');
    login.classList.toggle('active');
    signup.classList.toggle('active');
};

window.toggleResetForm = function (show) {
    const login = document.getElementById('loginForm');
    const reset = document.getElementById('resetForm');
    login.classList.toggle('active', !show);
    reset.classList.toggle('active', show);
};

// ─── Login ────────────────────────────────────────────────────────────────

window.handleLogin = async function (e) {
    e.preventDefault();
    const phone = normalisePhone(document.getElementById('loginPhone').value.trim());
    const password = document.getElementById('loginPassword').value;
    const email = phone + '@aerowin.app'; // Supabase requires email format

    showMessage('Logging in…', 'info');

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        showMessage(error.message || 'Login failed. Check your credentials.', 'error');
    } else {
        showMessage('Login successful! Redirecting…', 'success');
        setTimeout(() => window.location.replace('index.html'), 800);
    }
};

// ─── Sign Up ──────────────────────────────────────────────────────────────

window.handleSignup = async function (e) {
    e.preventDefault();

    const phone = normalisePhone(document.getElementById('signupPhone').value.trim());
    const password = document.getElementById('signupPassword').value;
    const confirm = document.getElementById('signupConfirm').value;
    const referral = document.getElementById('signupReferral').value.trim().toUpperCase();
    const terms = document.getElementById('termsCheckbox').checked;

    if (!terms) { showMessage('Please accept the Terms & Conditions.', 'error'); return; }
    if (password.length < 6) { showMessage('Password must be at least 6 characters.', 'error'); return; }
    if (password !== confirm) { showMessage('Passwords do not match.', 'error'); return; }

    const email = phone + '@aerowin.app';
    showMessage('Creating account…', 'info');

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { phone, referral_code: referral || null } },
    });

    if (error) {
        showMessage(error.message || 'Sign-up failed. Try again.', 'error');
        return;
    }

    // Insert profile row
    if (data?.user) {
        const { error: profileErr } = await supabase.from('profiles').upsert({
            id: data.user.id,
            phone,
            referred_by: referral || null,
            balance: 1000,
        });
        if (profileErr) console.error('Profile insert error:', profileErr);
    }

    showMessage('Account created! Redirecting…', 'success');
    setTimeout(() => window.location.replace('index.html'), 800);
};

// ─── Password Reset ───────────────────────────────────────────────────────

window.handleResetPassword = async function (e) {
    e.preventDefault();
    const phone = normalisePhone(document.getElementById('resetPhone').value.trim());
    const email = phone + '@aerowin.app';

    showMessage('Sending reset link…', 'info');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/auth.html',
    });

    if (error) {
        showMessage(error.message || 'Reset failed. Try again.', 'error');
    } else {
        showMessage('Reset link sent! Check your registered email/SMS.', 'success');
    }
};