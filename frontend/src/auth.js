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

    if (!rawPhone || !password) {
        showMessage('Please enter your phone number and password.', 'error');
        return;
    }

    const phone = normalisePhone(rawPhone);
    if (!validatePhone(phone)) {
        showMessage('Enter a valid Kenyan phone number (e.g. 0712345678).', 'error');
        return;
    }

    setLoading('loginBtn', true);
    showMessage('Authenticating…', 'info');

    let email = '';

    try {
        // Look up email registered on this phone number
        const { data: profile } = await supabase
            .from('profiles')
            .select('email')
            .eq('phone', phone)
            .limit(1)
            .maybeSingle();

        if (profile && profile.email) {
            email = profile.email;
        } else {
            email = phone + '@metricwin.app'; // legacy default fallback
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        setLoading('loginBtn', false);

        if (error) {
            recordAttempt(false);
            showMessage('Invalid phone number or password. Please try again.', 'error');
            return;
        }

        recordAttempt(true);

        if (!document.getElementById('rememberMe')?.checked) {
            window.addEventListener('pagehide', () => supabase.auth.signOut(), { once: true });
        }

        showMessage('Login successful! Redirecting…', 'success');
        setTimeout(() => window.location.replace('/'), 700);
    } catch (err) {
        setLoading('loginBtn', false);
        showMessage('An unexpected error occurred. Please try again.', 'error');
    }
};

// ─── Sign Up ──────────────────────────────────────────────────────────────────

// Client-side username syntax check
function validateUsername(username) {
    // 3–20 characters long.
    // Only letters (A–Z), numbers (0–9), underscores (_), and periods (.) are allowed. No spaces.
    return /^[a-zA-Z0-9_\.]{3,20}$/.test(username);
}

// Debounced Username availability checker function
async function checkUsernameAvailability(username) {
    const container = document.getElementById('usernameAvailability');
    if (!container) return;

    if (!username) {
        container.style.display = 'none';
        container.textContent = '';
        return;
    }

    container.style.display = 'block';

    if (!validateUsername(username)) {
        container.className = 'availability-indicator unavailable';
        container.textContent = '❌ Invalid format (3-20 chars: alphanumeric, _, or .).';
        return;
    }

    container.className = 'availability-indicator checking';
    container.textContent = '⏳ Checking availability...';

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id')
            .ilike('username', username)
            .limit(1);

        if (error) {
            container.className = 'availability-indicator checking';
            container.textContent = '⚠️ Service error checking availability.';
            return;
        }

        if (data && data.length > 0) {
            container.className = 'availability-indicator unavailable';
            container.textContent = `❌ "${username}" is already taken.`;
            return false;
        } else {
            container.className = 'availability-indicator available';
            container.textContent = `✅ "${username}" is available!`;
            return true;
        }
    } catch (err) {
        container.className = 'availability-indicator checking';
        container.textContent = '⚠️ Service error checks.';
        return false;
    }
}

window.handleSignup = async function (e) {
    e.preventDefault();

    const username = sanitize(document.getElementById('signupUsername').value);
    const rawPhone = sanitize(document.getElementById('signupPhone').value);
    const password = document.getElementById('signupPassword').value;
    const confirm  = document.getElementById('signupConfirm').value;
    const referral = sanitize(document.getElementById('signupReferral').value).toUpperCase();
    const terms    = document.getElementById('termsCheckbox').checked;
    const phone    = normalisePhone(rawPhone);

    // ── Validation ──
    if (!username) {
        showMessage('Username is required.', 'error');
        return;
    }

    if (!validateUsername(username)) {
        showMessage('Username must be 3-20 characters: alphanumeric, underscores or periods only.', 'error');
        return;
    }

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

    setLoading('signupBtn', true);
    showMessage('Checking username availability…', 'info');

    // Double check availability one final time before calling auth
    try {
        const { data: existingUser, error: checkErr } = await supabase
            .from('profiles')
            .select('id')
            .ilike('username', username)
            .limit(1);

        if (checkErr) throw checkErr;

        if (existingUser && existingUser.length > 0) {
            setLoading('signupBtn', false);
            showMessage('Username is already taken. Please try another one.', 'error');
            return;
        }

        // Also check if phone belongs to another profile
        const { data: existingPhone } = await supabase
            .from('profiles')
            .select('id')
            .eq('phone', phone)
            .limit(1);

        if (existingPhone && existingPhone.length > 0) {
            setLoading('signupBtn', false);
            showMessage('This phone number is already registered under another account.', 'error');
            return;
        }

        // Generate synthetic unique email using unique username
        const email = username.toLowerCase() + '@metricwin.app';

        showMessage('Creating your secure account…', 'info');

        // Create auth user account
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { phone, username, referral_code: referral || null },
            },
        });

        if (error) {
            setLoading('signupBtn', false);
            showMessage('Registration error: ' + error.message, 'error');
            return;
        }

        // Create profile row immediately
        if (data?.user) {
            const { error: profileErr } = await supabase.from('profiles').upsert({
                id:          data.user.id,
                username:    username,
                phone:       phone,
                email:       email,
                referred_by: referral || null,
                balance:     1000,
                role:        'User'
            });

            if (profileErr) {
                console.error("Profile creation error", profileErr);
            }
        }

        // Auto-sign in (sign up returns a session if email confirmation is disabled in Supabase)
        if (data?.session) {
            setLoading('signupBtn', false);
            showMessage('Account created! Welcome to Metricwin ✈️', 'success');
            setTimeout(() => window.location.replace('/'), 900);
        } else {
            // Confirmation is enabled or session was not returned — sign in manually
            const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
            setLoading('signupBtn', false);
            if (loginErr) {
                showMessage('Account created! Please log in to continue.', 'success');
                setTimeout(() => {
                    window.toggleForms();
                }, 1500);
            } else {
                showMessage('Account created! Welcome to Metricwin ✈️', 'success');
                setTimeout(() => window.location.replace('/'), 900);
            }
        }

    } catch (err) {
        setLoading('signupBtn', false);
        showMessage('Error during signup: ' + err.message, 'error');
    }
};

// ─── Forgot Password (Username-First Verification) ──────────────────────────

window.handleForgotPassword = async function (e) {
    e.preventDefault();

    const username = sanitize(document.getElementById('forgotUsername').value);
    if (!username) {
        showMessage('Please enter your username.', 'error');
        return;
    }

    setLoading('forgotBtn', true);
    showMessage('Verifying username…', 'info');

    try {
        // Look up registered user using username
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('email, id')
            .ilike('username', username)
            .limit(1)
            .maybeSingle();

        if (error || !profile) {
            setLoading('forgotBtn', false);
            showMessage('Username not found.', 'error');
            return;
        }

        // Trigger secure reset email
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(profile.email, {
            redirectTo: window.location.origin + '/auth?type=recovery',
        });

        setLoading('forgotBtn', false);

        if (resetErr) {
            showMessage('Failed to send reset link. Please try again.', 'error');
            return;
        }

        showMessage(
            'A secure password reset link has been sent to the email address associated with your account.',
            'success'
        );
    } catch (err) {
        setLoading('forgotBtn', false);
        showMessage('An error occurred. Please try again.', 'error');
    }
};

// ─── Set New Password ─────────────────────────────────────────────────────────

window.updateNewPasswordStrength = function (pw) {
    window.updateStrength(pw); // Reuse register strength logic for styling
    const fill = document.getElementById('newStrengthFill');
    const label = document.getElementById('newStrengthLabel');
    const registerFill = document.getElementById('strengthFill');
    const registerLabel = document.getElementById('strengthLabel');
    if (fill && registerFill) {
        fill.style.width = registerFill.style.width;
        fill.style.backgroundColor = registerFill.style.backgroundColor;
    }
    if (label && registerLabel) {
        label.textContent = registerLabel.textContent;
        label.style.color = registerLabel.style.color;
    }
};

window.handleSetNewPassword = async function (e) {
    e.preventDefault();

    const newPassword = document.getElementById('newPassword').value;
    const confirm     = document.getElementById('newPasswordConfirm').value;

    if (newPassword.length < 8) {
        showMessage('Password must be at least 8 characters.', 'error');
        return;
    }
    if (newPassword !== confirm) {
        showMessage('Passwords do not match.', 'error');
        return;
    }

    setLoading('newPasswordBtn', true);
    showMessage('Updating your password…', 'info');

    try {
        const { error } = await supabase.auth.updateUser({ password: newPassword });

        if (error) {
            setLoading('newPasswordBtn', false);
            showMessage('Failed to update password: ' + error.message, 'error');
            return;
        }

        // Invalidate all active sessions by signing out
        await supabase.auth.signOut();

        setLoading('newPasswordBtn', false);
        showMessage('Your password has been reset successfully. Please sign in with your new password.', 'success');

        setTimeout(() => {
            document.getElementById('newPasswordForm').classList.remove('active');
            document.getElementById('loginForm').classList.add('active');
        }, 4000);

    } catch (err) {
        setLoading('newPasswordBtn', false);
        showMessage('An error occurred resetting password.', 'error');
    }
};

function showNewPasswordForm() {
    document.getElementById('loginForm').classList.remove('active');
    document.getElementById('signupForm').classList.remove('active');
    document.getElementById('forgotForm').classList.remove('active');
    document.getElementById('newPasswordForm').classList.add('active');
    showMessage('Recovery link verified. Please enter a new password.', 'info');
}

// ─── Event Listeners Hook ───────────────────────────────────────────────────

window.addEventListener('load', () => {
    // Check if loading recovery type
    if (window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery')) {
        showNewPasswordForm();
    }

    // Subscribe to password recovery state change
    supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === "PASSWORD_RECOVERY") {
            showNewPasswordForm();
        }
    });

    // Username input listener for real-time av check
    const usernameInput = document.getElementById('signupUsername');
    if (usernameInput) {
        let timer;
        usernameInput.addEventListener('input', () => {
            clearTimeout(timer);
            const username = usernameInput.value.trim();
            timer = setTimeout(() => {
                checkUsernameAvailability(username);
            }, 350);
        });
    }
});

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