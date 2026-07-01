/**
 * auth.js  (ES Module)
 *
 * Pure phone-number + password authentication.
 * Zero OTP. Zero SMS. Supabase handles password hashing (bcrypt).
 *
 * Security features:
 *  - Client-side rate limiting (brute-force protection)
 *  - Password strength scoring
 *  - Generic error messages (no phone enumeration)
 *  - Session persistence via Supabase
 *  - Input sanitization
 */

import { supabase } from './lib/supabase.js';

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
// Prevents brute-force from the client side; server RLS + Supabase Auth also
// enforces its own rate limits server-side.

const _attempts = { count: 0, lockedUntil: 0 };
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 60_000; // 1 minute

function checkRateLimit() {
    const now = Date.now();
    if (_attempts.lockedUntil > now) {
        const secs = Math.ceil((_attempts.lockedUntil - now) / 1000);
        showMessage(`Too many attempts. Try again in ${secs}s.`, 'error');
        return false;
    }
    return true;
}

function recordAttempt(success) {
    if (success) {
        _attempts.count = 0;
        _attempts.lockedUntil = 0;
        return;
    }
    _attempts.count++;
    if (_attempts.count >= MAX_ATTEMPTS) {
        _attempts.lockedUntil = Date.now() + LOCKOUT_MS;
        _attempts.count = 0;
    }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function showMessage(msg, type = 'info') {
    const box = document.getElementById('messageBox');
    if (!box) return;
    box.textContent = msg;
    box.className = `message-box ${type}`;
    box.style.display = 'block';
    clearTimeout(box._timer);
    box._timer = setTimeout(() => { box.style.display = 'none'; }, 6000);
}

function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    const text    = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.btn-spinner');
    if (text)    text.style.opacity  = loading ? '0.5' : '1';
    if (spinner) spinner.classList.toggle('hidden', !loading);
}

/** Normalise Kenyan phone → +2547XXXXXXXX */
function normalisePhone(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('254')) return '+' + digits;
    if (digits.startsWith('0'))   return '+254' + digits.slice(1);
    if (digits.startsWith('7') || digits.startsWith('1')) return '+254' + digits;
    return '+' + digits;
}

/** Sanitize string input — strip HTML/script chars */
function sanitize(str) {
    return String(str).replace(/[<>"'`]/g, '').trim();
}

function validatePhone(phone) {
    return /^\+254[17]\d{8}$/.test(phone);
}

// ─── Password Strength ────────────────────────────────────────────────────────

window.updateStrength = function (pw) {
    const fill  = document.getElementById('strengthFill');
    const label = document.getElementById('strengthLabel');
    if (!fill || !label) return;

    let score = 0;
    if (pw.length >= 8)                          score++;
    if (pw.length >= 12)                         score++;
    if (/[A-Z]/.test(pw))                        score++;
    if (/[0-9]/.test(pw))                        score++;
    if (/[^A-Za-z0-9]/.test(pw))                score++;

    const levels = [
        { pct: '0%',   color: 'transparent',         text: '' },
        { pct: '25%',  color: '#e21d48',              text: '⚠ Weak' },
        { pct: '50%',  color: '#f59e0b',              text: '◑ Fair' },
        { pct: '75%',  color: '#3b82f6',              text: '◕ Good' },
        { pct: '90%',  color: '#10b981',              text: '✓ Strong' },
        { pct: '100%', color: '#10b981',              text: '✓✓ Very Strong' },
    ];

    const lvl = levels[Math.min(score, 5)];
    fill.style.width           = pw.length === 0 ? '0%' : lvl.pct;
    fill.style.backgroundColor = lvl.color;
    label.textContent          = pw.length === 0 ? '' : lvl.text;
    label.style.color          = lvl.color;
};

// ─── Show/Hide Password ───────────────────────────────────────────────────────

window.togglePassword = function (inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    // Swap icon: open eye vs crossed-out eye
    btn.innerHTML = isHidden
        ? `<svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
        : `<svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
};

// ─── Panel Navigation ─────────────────────────────────────────────────────────

window.toggleForms = function () {
    const login  = document.getElementById('loginForm');
    const signup = document.getElementById('signupForm');
    const isLoginActive = login.classList.contains('active');
    login.classList.toggle('active',  !isLoginActive);
    signup.classList.toggle('active',  isLoginActive);
    showMessage('', 'info');          // clear message on switch
};

window.showForgotForm = function () {
    document.getElementById('loginForm').classList.remove('active');
    document.getElementById('forgotForm').classList.add('active');
    showMessage('', 'info');
};

window.showLoginForm = function () {
    document.getElementById('forgotForm').classList.remove('active');
    document.getElementById('loginForm').classList.add('active');
    showMessage('', 'info');
};

// ─── Login ────────────────────────────────────────────────────────────────────

window.handleLogin = async function (e) {
    e.preventDefault();
    if (!checkRateLimit()) return;

    const rawPhone = sanitize(document.getElementById('loginPhone').value);
    const password = document.getElementById('loginPassword').value;
    const phone    = normalisePhone(rawPhone);

    if (!validatePhone(phone)) {
        showMessage('Enter a valid Kenyan phone number (e.g. 0712345678).', 'error');
        return;
    }
    if (!password) {
        showMessage('Please enter your password.', 'error');
        return;
    }

    // Use a synthetic email (Supabase requires email format)
    const email = phone + '@metricwin.app';

    setLoading('loginBtn', true);
    showMessage('Authenticating…', 'info');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading('loginBtn', false);

    if (error) {
        recordAttempt(false);
        // Generic message — never reveal if phone exists
        showMessage('Invalid phone number or password. Please try again.', 'error');
        return;
    }

    recordAttempt(true);

    // Handle "Remember Me"
    if (!document.getElementById('rememberMe')?.checked) {
        // Session will expire when browser closes (Supabase default is persistent;
        // we sign out on pagehide if remember-me is unchecked)
        window.addEventListener('pagehide', () => supabase.auth.signOut(), { once: true });
    }

    showMessage('Login successful! Redirecting…', 'success');
    setTimeout(() => window.location.replace('/'), 700);
};

// ─── Sign Up ──────────────────────────────────────────────────────────────────

window.handleSignup = async function (e) {
    e.preventDefault();

    const rawPhone = sanitize(document.getElementById('signupPhone').value);
    const password = document.getElementById('signupPassword').value;
    const confirm  = document.getElementById('signupConfirm').value;
    const referral = sanitize(document.getElementById('signupReferral').value).toUpperCase();
    const terms    = document.getElementById('termsCheckbox').checked;
    const phone    = normalisePhone(rawPhone);

    // ── Validation ──
    if (!validatePhone(phone)) {
        showMessage('Enter a valid Kenyan phone number (e.g. 0712345678).', 'error');
        return;
    }
    if (!terms) {
        showMessage('Please accept the Terms & Conditions.', 'error');
        return;
    }
    if (password.length < 8) {
        showMessage('Password must be at least 8 characters.', 'error');
        return;
    }
    if (password !== confirm) {
        showMessage('Passwords do not match.', 'error');
        return;
    }

    const email = phone + '@metricwin.app';

    setLoading('signupBtn', true);
    showMessage('Creating your account…', 'info');

    // Supabase hashes the password with bcrypt internally
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { phone, referral_code: referral || null },
        },
    });

    if (error) {
        setLoading('signupBtn', false);
        // Don't reveal "already registered" — use generic message
        showMessage('Registration failed. This phone may already be registered.', 'error');
        return;
    }

    // Create profile row immediately
    if (data?.user) {
        await supabase.from('profiles').upsert({
            id:          data.user.id,
            phone,
            referred_by: referral || null,
            balance:     1000,
        });
    }

    // Auto-sign in (signUp returns a session if email confirmation is disabled in Supabase)
    if (data?.session) {
        setLoading('signupBtn', false);
        showMessage('Account created! Welcome to Nexus Hub ✈️', 'success');
        setTimeout(() => window.location.replace('/'), 900);
    } else {
        // Supabase has email confirmation enabled — sign in manually
        const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        setLoading('signupBtn', false);
        if (loginErr) {
            showMessage('Account created! Please log in to continue.', 'success');
            setTimeout(() => {
                window.toggleForms();
            }, 1500);
        } else {
            showMessage('Account created! Welcome to Nexus Hub ✈️', 'success');
            setTimeout(() => window.location.replace('/'), 900);
        }
    }
};

// ─── Forgot Password ──────────────────────────────────────────────────────────

window.handleForgotPassword = async function (e) {
    e.preventDefault();

    const rawPhone = sanitize(document.getElementById('forgotPhone').value);
    const phone    = normalisePhone(rawPhone);

    if (!validatePhone(phone)) {
        showMessage('Enter a valid Kenyan phone number.', 'error');
        return;
    }

    const email = phone + '@metricwin.app';

    setLoading('forgotBtn', true);
    showMessage('Processing request…', 'info');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/auth',
    });

    setLoading('forgotBtn', false);

    // Always show success — never reveal whether the phone exists
    showMessage(
        'If that phone number is registered, a reset link has been sent to the associated email. Contact support if you need help.',
        'success'
    );
};

// ─── Terms & Conditions Modal ─────────────────────────────────────────────────

window.openTermsModal = function () {
    const modal = document.getElementById('termsModal');
    if (!modal) return;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Scroll content to top every time it opens
    const body = modal.querySelector('.tc-body');
    if (body) body.scrollTop = 0;
};

window.closeTermsModal = function () {
    const modal = document.getElementById('termsModal');
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
};

/** Clicking the backdrop (not the modal itself) closes it */
window.handleOverlayClick = function (e) {
    if (e.target === document.getElementById('termsModal')) {
        closeTermsModal();
    }
};

/** "I Accept" → tick the checkbox automatically and close */
window.acceptTerms = function () {
    const cb = document.getElementById('termsCheckbox');
    if (cb) cb.checked = true;
    closeTermsModal();
};

// Close with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTermsModal();
});