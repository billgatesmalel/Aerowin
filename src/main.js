// ══════════════════════════════════════════════
// IMPORTS
// ══════════════════════════════════════════════
import { supabase } from './lib/supabase.js';

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
let balance = 1000;
let bet1 = { amount: 100, active: false, cashed: false, auto: false, winnings: 0 };
let bet2 = { amount: 100, active: false, cashed: false, auto: false, winnings: 0 };
let currentMultiplier = 1.0;
let crashPoint = 0;
let gameInterval = null;
let currentUser = null;
let crashHistory = [];
let gameState = 'waiting'; // 'waiting' | 'playing' | 'crashed'
let countdown = 5;
let allBets = [];
let muted = false;
let audioCtx = null;

let tickSpeed = 50;
let tickIncrement = 0.02;
let elapsedTicks = 0;
let activeBetsTab = 'all'; // 'all' | 'previous' | 'top'
let personalHistory = []; // Stores user's personal bets

// ── PERFECT TIME SYNC ──
const ROUND_DURATION = 15000; // 15s total
const FLIGHT_LIMIT = 10000;   // 10s max flight

let roundStartTime = 0;

function getGlobalTimeMultiplier() {
    // Deprecated for smooth UI flight logic, using gameTick local time instead
    return null;
}

function calculateSyncedCrashPoint() {
    const seed = Math.floor(Date.now() / ROUND_DURATION);
    const x = Math.sin(seed) * 10000;
    const r = x - Math.floor(x);
    
    if (r < 0.1) return 1.05;
    if (r < 0.5) return 1.2 + (r * 2);
    if (r < 0.8) return 3.0 + (r * 8);
    return 15.0 + (r * 50);
}

// Graph canvas state
let graphPoints = [];
let graphCanvas = null;
let graphCtx2d = null;

// Particle trail state
let particles = [];

// Simulated total count
let simulatedTotalCount = 0;
let totalCountInterval = null;

// Live player count
let livePlayerCount = 0;
let livePlayerInterval = null;


// ══════════════════════════════════════════════
// HAPTIC FEEDBACK
// ══════════════════════════════════════════════
function haptic(pattern = [30]) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { }
}
// ══════════════════════════════════════════════
// AUDIO NODES
// ══════════════════════════════════════════════
let risingOscillator = null;
let risingGain = null;
let engineRumbleSource = null;
let engineRumbleGain = null;

// ══════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════
window.addEventListener('load', async () => {
    // 🚀 Start initializing UI while data fetches in background
    initAudio();
    initCanvas();
    updateUI();

    // â›”ï¸ Pre-populate from LocalStorage for instant feel
    const cached = localStorage.getItem('aerowin_global_history');
    if (cached) {
        try {
            crashHistory = JSON.parse(cached).filter(v => v !== null && v !== 'undefined');
            renderTicker();
        } catch(e) {}
    }

    // Unleash Audio on user interaction
    document.body.addEventListener('click', () => {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        if (!muted && ambientAudio && ambientAudio.paused) {
            ambientAudio.play().catch(()=>{});
        }
    }, { once: true });

    // ðŸ“¡ Background Database Sync (Non-blocking)
    Promise.all([
        supabase.auth.getSession(),
        supabase.from('game_history').select('multiplier').order('created_at', { ascending: false }).limit(30)
    ]).then(async ([sessionResult, historyResult]) => {
        const { data: { session } } = sessionResult;
        if (!session) { window.location.href = 'auth.html'; return; }

        const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (profile) {
            currentUser = { ...session.user, ...profile };
            balance = profile.balance;
            // 👑 FLEXIBLE ADMIN CHECK: Handles +254... or 07... formats
            const phone = String(profile.phone || '');
            if (phone.includes('799289214') || profile.is_admin === true) {
                currentUser.isAdmin = true;
                console.log("Admin Privileges Granted to:", phone);
            }
            updateUI();
        }

        if (historyResult.data) {
            // 🛡️ STRICT SANITIZATION: filter out nulls or 'undefined' literals
            crashHistory = historyResult.data
                .map(h => h.multiplier)
                .filter(m => m !== null && m !== undefined && m !== 'undefined' && m !== '');
            
            localStorage.setItem('aerowin_global_history', JSON.stringify(crashHistory));
            renderTicker();
        }
    }).catch(err => console.error("Boot sequence error:", err));

    // 📱 ULTIMATE MOBILE BINDINGS (Instant Touch)
    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (!el) return;

        const handler = (e) => {
            // Prevent double-triggering (touch + click)
            if (e.type === 'touchstart') e.preventDefault(); 
            fn(); 
            haptic([30]); 
        };

        el.addEventListener('click', handler);
        el.addEventListener('touchstart', handler, { passive: false });
    };

    bind('profileBtn', openProfile);
    bind('muteBtn', toggleMute);
    bind('logoutBtn', logout);
    bind('themeBtn', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
        const btn = document.getElementById('themeBtn');
        if (btn) btn.textContent = isDark ? '🌞' : '🌙';
    });

    // Modals
    bind('closeProfileBtn', closeProfile);
    bind('openDepositBtn', openDepositModal);
    bind('closeDepositBtn', closeDepositModal);
    bind('cancelDepositBtn', closeDepositModal);
    bind('confirmDepositBtn', processDeposit);
    bind('openWithdrawBtn', openWithdrawModal);
    bind('closeWithdrawBtn', closeWithdrawModal);
    bind('confirmWithdrawBtn', processWithdraw);
    bind('cancelWithdrawBtn', closeWithdrawModal);
    
    // Bet Feed Tabs
    bind('tabAll', () => switchBetTab('all'));
    bind('tabPrevious', () => switchBetTab('previous'));
    bind('tabTop', () => switchBetTab('top'));

    // ... existing binds ...
    bind('closeAdminBtn', () => document.getElementById('adminModal').classList.remove('show'));
    bind('refreshAdminBtn', fetchAdminUsers);
    
    // Search filter
    const searchInp = document.getElementById('adminSearchInput');
    if (searchInp) {
        searchInp.addEventListener('input', (e) => filterAdminUsers(e.target.value));
    }

    showGameLoader(() => startNewRound());
});

// ══════════════════════════════════════════════
// AUDIO ENGINE
// ══════════════════════════════════════════════
function initAudio() {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
}

function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// ── Utility: play a one-shot tone ─────────────
function playTone(freq, dur, type = 'sine', vol = 0.08) {
    if (muted || !audioCtx) return;
    resumeAudio();
    try {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, audioCtx.currentTime);
        g.gain.setValueAtTime(vol, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { }
}

// ── 1. BET PLACED — crisp click ─────────────
function playSoundBetPlaced() {
    if (muted || !audioCtx) return;
    resumeAudio();
    playTone(800, 0.05, 'square', 0.04);
}

// ── 2. ENGINE RUMBLE — the flying sound ───────
function startEngineRumble() {
    if (muted || !audioCtx) return;
    resumeAudio();
    stopEngineRumble();
    try {
        engineRumbleGain = audioCtx.createGain();
        engineRumbleGain.gain.setValueAtTime(0.0, audioCtx.currentTime);
        engineRumbleGain.gain.linearRampToValueAtTime(0.04, audioCtx.currentTime + 0.5);
        engineRumbleGain.connect(audioCtx.destination);

        // Low hum
        const hum = audioCtx.createOscillator();
        hum.type = 'triangle';
        hum.frequency.setValueAtTime(45, audioCtx.currentTime);

        // Noise for air friction
        const bufSize = audioCtx.sampleRate * 2;
        const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.1;
        const noise = audioCtx.createBufferSource();
        noise.buffer = noiseBuf;
        noise.loop = true;

        const lpf = audioCtx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(300, audioCtx.currentTime);

        hum.connect(engineRumbleGain);
        noise.connect(lpf);
        lpf.connect(engineRumbleGain);

        hum.start(); noise.start();
        engineRumbleSource = { hum, noise };
    } catch (e) { }
}

function updateEngineRumble(mult) {
    if (!engineRumbleSource || !engineRumbleGain || muted) return;
    try {
        const freq = 45 + Math.min(80, (mult - 1) * 6);
        engineRumbleSource.hum.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.1);
        const vol = Math.min(0.08, 0.04 + (mult - 1) * 0.002);
        engineRumbleGain.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.1);
    } catch (e) { }
}

function stopEngineRumble() {
    if (!engineRumbleSource) return;
    try {
        if (engineRumbleGain) engineRumbleGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        setTimeout(() => {
            try { engineRumbleSource.hum.stop(); } catch (e) { }
            try { engineRumbleSource.noise.stop(); } catch (e) { }
        }, 250);
    } catch (e) { }
    engineRumbleSource = null;
    engineRumbleGain = null;
}

// ── 3. RISING TONE — the multiplier whistle ─────
function startRisingTone() {
    if (muted || !audioCtx) return;
    resumeAudio();
    stopRisingTone();
    try {
        risingOscillator = audioCtx.createOscillator();
        risingGain = audioCtx.createGain();
        risingOscillator.type = 'sine';
        risingOscillator.frequency.setValueAtTime(150, audioCtx.currentTime);
        risingGain.gain.setValueAtTime(0.02, audioCtx.currentTime);
        risingOscillator.connect(risingGain);
        risingGain.connect(audioCtx.destination);
        risingOscillator.start();
    } catch (e) { }
}

function updateRisingTone(mult) {
    if (!risingOscillator || muted) return;
    try {
        const freq = 150 + Math.min(600, (mult - 1) * 45);
        risingOscillator.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.1);
    } catch (e) { }
}

function stopRisingTone() {
    if (!risingOscillator) return;
    try {
        risingGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        risingOscillator.stop(audioCtx.currentTime + 0.2);
    } catch (e) { }
    risingOscillator = null;
    risingGain = null;
}

// ── MODERN AUDIO ENGINE (Ear-Friendly) ──
let activeSounds = [];
let ambientAudio = new Audio('https://raw.githubusercontent.com/antigravitydev/aerowin-sounds/main/ambient.mp3'); 
// Fallback if that doesn't exist
ambientAudio.src = 'https://www.soundjay.com/misc/sounds/wind-chimes-1.mp3'; 
ambientAudio.loop = true;
ambientAudio.volume = 0.05;

function playSyncedSound(url, volume = 0.4) {
    if (muted) return;
    try {
        const audio = new Audio(url);
        audio.volume = volume;
        activeSounds.push(audio);
        audio.play().catch(() => {});
        audio.onended = () => {
            activeSounds = activeSounds.filter(a => a !== audio);
        };
    } catch (e) { }
}

function playSoundCashOut() {
    playSyncedSound('https://www.soundjay.com/buttons/sounds/button-11.mp3', 0.5);
}

function playSoundExplosion() {
    playSyncedSound('https://www.soundjay.com/buttons/sounds/button-10.mp3', 0.6);
}

function playSoundTakeoff() {
    playSyncedSound('https://www.soundjay.com/nature/sounds/wind-01.mp3', 0.3);
}


// ── 6. MILESTONE PINGS ────────────────────────────────────────
function playMilestoneSound(mult) {
    if (muted || !audioCtx) return;
    resumeAudio();
    try {
        playSyncedSound('https://www.soundjay.com/buttons/sounds/button-4.mp3', 0.2);
        const freqs = { 2: 880, 5: 1100, 10: 1400, 20: 1800 };
        const freq = freqs[mult] || 880;
        const now = audioCtx.currentTime;
        // Double-ping
        [0, 0.12].forEach((delay, i) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'triangle';
            o.frequency.setValueAtTime(freq * (i === 1 ? 1.25 : 1), now + delay);
            g.gain.setValueAtTime(0.12, now + delay);
            g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.25);
            o.connect(g); g.connect(audioCtx.destination);
            o.start(now + delay); o.stop(now + delay + 0.3);
        });
    } catch (e) { }
}

// ── 7. COUNTDOWN TICK ─────────────────────────────────────────
function playSoundTick() {
    playTone(440, 0.05, 'square', 0.03);
}

// ── 8. MUTE TOGGLE ────────────────────────────────────────────
function toggleMute() {
    muted = !muted;
    const btn = document.getElementById('muteBtn');
    if (btn) {
        btn.textContent = muted ? '🔇' : '🔊';
        btn.style.opacity = muted ? '0.5' : '1';
        btn.style.filter = muted ? 'grayscale(1)' : 'none';
    }

    if (muted) {
        if (audioCtx) try { audioCtx.suspend(); } catch(e){}
        activeSounds.forEach(s => { try { s.pause(); s.currentTime = 0; } catch(e){} });
        activeSounds = [];
        if (ambientAudio) ambientAudio.pause();
        stopEngineRumble();
        stopRisingTone();
    } else {
        if (audioCtx) try { audioCtx.resume(); } catch(e){}
        if (ambientAudio) ambientAudio.play().catch(()=>{});
    }
    haptic([40, 20]); // Stronger haptic feedback
}

// Keep legacy alias
function playSound(freq, dur, type = 'sine') {
    playTone(freq, dur, type);
}


// ══════════════════════════════════════════════
// GAME LOADING SCREEN
// ══════════════════════════════════════════════
const LOADING_TIPS = [
    'Place your bet before the plane takes off!',
    'Cash out early for guaranteed winnings.',
    'The higher the multiplier, the bigger the risk!',
    'Auto cashout locks in your profit automatically.',
    'Use two bets — one safe, one aggressive!',
];

function showGameLoader(callback) {
    const loader = document.getElementById('gameLoader');
    if (!loader) { callback(); return; }
    // Show random tip
    const tip = document.getElementById('glTip');
    if (tip) tip.textContent = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
    loader.style.display = 'flex';
    // Hide as soon as possible after data is ready
    setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
            callback();
        }, 300);
    }, 500); // Reduced from 2000ms to 500ms for faster mobile loading
}

// ══════════════════════════════════════════════
// CANVAS GRAPH (animated line + plane on curve)
// ══════════════════════════════════════════════
function initCanvas() {
    const board = document.getElementById('gameBoard');
    graphCanvas = document.createElement('canvas');
    graphCanvas.id = 'graphCanvas';
    graphCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;';
    board.appendChild(graphCanvas);
    
    // Initial resize
    resizeCanvas();
    
    // 📱 Mobile fix: Force resize after DOM settles (multiple attempts for slow devices)
    setTimeout(resizeCanvas, 100);
    setTimeout(resizeCanvas, 500);
    setTimeout(resizeCanvas, 1000);

    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    if (!graphCanvas) return;
    const w = graphCanvas.offsetWidth;
    const h = graphCanvas.offsetHeight;
    if (w > 0 && h > 0) {
        graphCanvas.width = w;
        graphCanvas.height = h;
    }
    graphCtx2d = graphCanvas.getContext('2d');
}

function getGraphXY(mult, canvasW, canvasH) {
    const progress = Math.min(1, (mult - 1.0) / 19.0);
    const x = progress * 0.92 + 0.04; // 🛰️ Return relative 0 to 1
    const y = 1.0 - (0.1 + Math.pow(progress, 0.7) * 0.78); 
    return { x, y, pxX: x * canvasW, pxY: y * canvasH };
}

function drawGraph() {
    // 🛡️ Guard: ensure canvas has valid dimensions before drawing
    if (!graphCanvas) return;
    if (graphCanvas.width === 0 || graphCanvas.height === 0) resizeCanvas();
    if (!graphCtx2d || graphCanvas.width === 0 || graphCanvas.height === 0) return;

    const W = graphCanvas.width;
    const H = graphCanvas.height;
    graphCtx2d.clearRect(0, 0, W, H);
    if (!graphPoints || graphPoints.length === 0) return;

    // Convert raw multipliers to current screen points
    const pts = graphPoints.map(m => getGraphXY(m, W, H));
    const crashed = gameState === 'crashed';

    // Gradient fill under curve
    graphCtx2d.beginPath();
    graphCtx2d.moveTo(pts[0].pxX, H);
    pts.forEach(p => graphCtx2d.lineTo(p.pxX, p.pxY));
    graphCtx2d.lineTo(pts[pts.length - 1].pxX, H);
    graphCtx2d.closePath();
    
    const fillGrad = graphCtx2d.createLinearGradient(0, 0, 0, H);
    fillGrad.addColorStop(0, crashed ? 'rgba(255,40,80,0.45)' : 'rgba(200,0,60,0.5)');
    fillGrad.addColorStop(1, crashed ? 'rgba(255,40,80,0.02)' : 'rgba(200,0,60,0.03)');
    graphCtx2d.fillStyle = fillGrad;
    graphCtx2d.fill();

    // Curve line
    graphCtx2d.beginPath();
    graphCtx2d.moveTo(pts[0].pxX, pts[0].pxY);
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const cx = (prev.pxX + curr.pxX) / 2;
        graphCtx2d.bezierCurveTo(cx, prev.pxY, cx, curr.pxY, curr.pxX, curr.pxY);
    }
    graphCtx2d.strokeStyle = crashed ? '#ff2244' : '#ff1a50';
    graphCtx2d.lineWidth = 3;
    graphCtx2d.stroke();

    // Particle trail
    drawParticles();


    // 🚀 LIVE PLANE: follow tip of curve using canvas pixel coords
    const lastPt = pts[pts.length - 1];
    const prevPt = pts.length > 1 ? pts[pts.length - 2] : pts[0];

    const dx = lastPt.pxX - prevPt.pxX;
    const dy = lastPt.pxY - prevPt.pxY;
    const angle = pts.length > 1 ? Math.atan2(dy, dx) * 180 / Math.PI : -20;

    // The canvas is 100% width/height of #gameBoard (position:relative), 
    // so canvas px == gameBoard px. We use left:0;top:0 + translate(pxX,pxY).
    const planeSvg = document.getElementById('plane');
    if (planeSvg && gameState !== 'crashed') {
        const planeW = 100;
        const planeH = 34;
        planeSvg.style.left = '0';
        planeSvg.style.top  = '0';
        planeSvg.style.transform = `translate(${lastPt.pxX - planeW}px, ${lastPt.pxY - planeH / 2}px) rotate(${Math.max(-35, Math.min(5, angle))}deg)`;
        planeSvg.style.transformOrigin = `${planeW}px ${planeH / 2}px`;
        planeSvg.style.opacity = '1';
        planeSvg.style.display = 'block';
        planeSvg.style.width = `${planeW}px`;
        planeSvg.style.height = `${planeH}px`;
        planeSvg.style.zIndex = '10';
    }
}


// ══════════════════════════════════════════════
// PARTICLE TRAIL
// ══════════════════════════════════════════════
function spawnParticles(x, y) {
    for (let i = 0; i < 3; i++) {
        particles.push({
            x, y,
            vx: -(Math.random() * 2 + 1),
            vy: (Math.random() - 0.5) * 1.5,
            life: 1.0,
            size: Math.random() * 4 + 2,
            color: Math.random() > 0.5 ? '#ff4400' : '#ffaa00'
        });
    }
    if (particles.length > 80) particles.splice(0, particles.length - 80);
}

function updateParticles() {
    particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life -= 0.04; });
    particles = particles.filter(p => p.life > 0);
}

function drawParticles() {
    particles.forEach(p => {
        graphCtx2d.globalAlpha = p.life * 0.8;
        graphCtx2d.beginPath();
        graphCtx2d.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        graphCtx2d.fillStyle = p.color;
        graphCtx2d.fill();
    });
    graphCtx2d.globalAlpha = 1;
}

// ══════════════════════════════════════════════
// LIVE PLAYER COUNT
// ══════════════════════════════════════════════
function startLivePlayerCount() {
    livePlayerCount = 7000 + Math.floor(Math.random() * 4000);
    updateLivePlayerDisplay();
    clearInterval(livePlayerInterval);
    livePlayerInterval = setInterval(() => {
        livePlayerCount += Math.floor(Math.random() * 5) - 1;
        if (livePlayerCount < 5000) livePlayerCount = 5000;
        updateLivePlayerDisplay();
    }, 800);
}

function updateLivePlayerDisplay() {
    const el = document.getElementById('livePlayerCount');
    if (el) el.textContent = livePlayerCount.toLocaleString('en-KE');
}

// ══════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════════
function showToast(message, type = 'info') {
    let toast = document.getElementById('gameToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'gameToast';
        toast.style.cssText = `
            position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(80px);
            background:#1a0a2e;border:1px solid rgba(255,255,255,0.12);
            color:#fff;padding:12px 24px;border-radius:30px;
            font-size:0.9em;font-weight:600;z-index:9999;
            transition:transform 0.3s ease,opacity 0.3s ease;opacity:0;
            box-shadow:0 8px 32px rgba(0,0,0,0.5);
            max-width:320px;text-align:center;pointer-events:none;
        `;
        document.body.appendChild(toast);
    }
    const colors = { success: '#00e676', error: '#ff3c6e', info: '#ffd700', warn: '#f39c12' };
    toast.style.borderColor = colors[type] || colors.info;
    toast.style.color = colors[type] || '#fff';
    toast.textContent = message;
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(80px)';
        toast.style.opacity = '0';
    }, 2800);
}

// ══════════════════════════════════════════════
// UI UPDATE
// ══════════════════════════════════════════════
function updateUI() {
    document.getElementById('headerBalance').textContent = formatNum(balance);
    const pb = document.getElementById('profileBalance');
    if (pb) pb.textContent = 'KES ' + formatNum(balance);
    syncBetCard(1);
    syncBetCard(2);
}

function syncBetCard(num) {
    const bet = num === 1 ? bet1 : bet2;
    const amtEl = document.getElementById('betAmount' + num);
    const lblEl = document.getElementById('betLabel' + num);
    const cashLbl = document.getElementById('cashLabel' + num);
    const placeBtnEl = document.getElementById('placeBet' + num + 'Btn');
    const cashBtnEl = document.getElementById('cashBtn' + num);

    if (amtEl) amtEl.value = bet.amount;
    if (lblEl) lblEl.textContent = parseFloat(bet.amount).toFixed(2);

    if (bet.active && !bet.cashed && gameState === 'playing') {
        if (cashBtnEl) {
            cashBtnEl.classList.remove('hidden');
            if (cashLbl) cashLbl.textContent = formatNum(Math.floor(bet.amount * currentMultiplier));
        }
        if (placeBtnEl) placeBtnEl.classList.add('hidden');
    } else {
        if (cashBtnEl) cashBtnEl.classList.add('hidden');
        if (placeBtnEl) {
            placeBtnEl.classList.remove('hidden');
            if (bet.active && gameState === 'waiting') {
                placeBtnEl.textContent = 'Cancel';
                placeBtnEl.classList.add('waiting-state');
                placeBtnEl.disabled = false;
            } else {
                placeBtnEl.innerHTML = `Bet<br><span id="betLabel${num}">${parseFloat(bet.amount).toFixed(2)}</span> KES`;
                placeBtnEl.classList.remove('waiting-state');
                placeBtnEl.disabled = (gameState === 'playing');
            }
        }
    }
}

// ══════════════════════════════════════════════
// BET ADJUSTMENT HELPERS
// ══════════════════════════════════════════════
function adjustBet(num, delta) {
    const bet = num === 1 ? bet1 : bet2;
    if (bet.active && gameState === 'playing') return;
    bet.amount = Math.max(50, (bet.amount || 0) + delta);
    syncBetCard(num);
}

function setBet(num, val) {
    const bet = num === 1 ? bet1 : bet2;
    if (bet.active && gameState === 'playing') return;
    bet.amount = val;
    syncBetCard(num);
}

// ══════════════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════════════
function switchBetTab(mode) {
    activeBetsTab = mode;
    document.getElementById('tabAll').classList.toggle('active', mode === 'all');
    document.getElementById('tabPrevious').classList.toggle('active', mode === 'previous');
    document.getElementById('tabTop').classList.toggle('active', mode === 'top');
    
    // Update the header text
    const header = document.querySelector('.all-bets-header span');
    if (header) header.textContent = mode === 'all' ? 'ALL BETS' : (mode === 'previous' ? 'MY BETS' : 'TOP BETS');
    
    renderAllBets();
}

function switchTab(num, mode) {
    document.getElementById('betTab' + num).classList.toggle('active', mode === 'bet');
    document.getElementById('autoTab' + num).classList.toggle('active', mode === 'auto');
    const autoPanel = document.getElementById('autoCashoutPanel' + num);
    const autoRow = document.getElementById('autoBetRow' + num);
    if (autoPanel) autoPanel.classList.toggle('hidden', mode !== 'auto');
    if (autoRow) autoRow.classList.toggle('hidden', mode !== 'auto');
}

// ══════════════════════════════════════════════
// PLACE BET / CANCEL BET
// ══════════════════════════════════════════════
async function placeBet(num) {
    resumeAudio(); // Unlock audio context on first user gesture
    const bet = num === 1 ? bet1 : bet2;
    const input = document.getElementById('betAmount' + num);
    const amount = parseFloat(input.value);

    if (bet.active && gameState === 'waiting') {
        balance += bet.amount;
        bet.active = false;
        bet.cashed = false;
        saveBalance();
        updateUI();
        showToast('Bet cancelled', 'warn');
        return;
    }

    if (isNaN(amount) || amount < 50) { showToast('Minimum bet is KES 50', 'error'); return; }
    if (amount > balance) { showToast('Insufficient balance!', 'error'); return; }
    if (bet.active) return;

    balance -= amount;
    bet.amount = amount;
    bet.active = true;
    bet.cashed = false;
    bet.winnings = 0;

    saveBalance();
    updateUI();
    haptic([25]);
    playSoundBetPlaced();
    addMyBetToFeed(num, amount);
}

// ══════════════════════════════════════════════
// CASH OUT
// ══════════════════════════════════════════════
async function cashOutBet(num) {
    const bet = num === 1 ? bet1 : bet2;
    if (!bet.active || bet.cashed || gameState !== 'playing') return;

    bet.winnings = Math.floor(bet.amount * currentMultiplier);
    balance += bet.winnings;
    bet.cashed = true;

    updateMyBetInFeed(num, currentMultiplier, bet.winnings, 'cashed');

    // 📜 ADD TO PERSONAL HISTORY
    personalHistory.unshift({
        name: currentUser.phone.slice(-4).padStart(4, '*'),
        avatar: '🌟',
        betAmt: bet.amount,
        mult: currentMultiplier.toFixed(2) + 'x',
        winAmt: bet.winnings,
        status: 'cashed'
    });

    const status = document.getElementById('status');
    if (status) status.textContent = `✅ Cashed at ${currentMultiplier.toFixed(2)}x!`;

    saveBalance();
    updateUI();
    haptic([30, 20, 80]);  // buzz on win
    playSoundCashOut();   // 🎰 Cash register!
    showToast(`✅ KES ${formatNum(bet.winnings)} cashed at ${currentMultiplier.toFixed(2)}x!`, 'success');
}

// ══════════════════════════════════════════════
// AUTO BET
// ══════════════════════════════════════════════
function toggleAutoBet(num) {
    const bet = num === 1 ? bet1 : bet2;
    bet.auto = document.getElementById('autoBet' + num).checked;
}

// ══════════════════════════════════════════════
// ROUND LIFECYCLE
// ══════════════════════════════════════════════
function resetBetState(bet) {
    bet.active = false;
    bet.cashed = false;
    bet.winnings = 0;
}

function startNewRound() {
    gameState = 'waiting';
    countdown = 5;
    currentMultiplier = 1.0;
    elapsedTicks = 0;
    tickIncrement = 0.02;
    graphPoints = [];
    particles = [];

    const multEl = document.getElementById('multiplier');
    const statusEl = document.getElementById('status');
    const overlay = document.getElementById('crashedOverlay');
    const plane = document.getElementById('plane');
    const board = document.getElementById('gameBoard');

    if (multEl) { multEl.textContent = '1.00x'; multEl.className = 'mult-display mult-low'; multEl.style.animation = ''; }
    if (statusEl) statusEl.textContent = '';
    if (overlay) overlay.classList.add('hidden');
    if (board) board.classList.remove('screen-shake');
    if (plane) {
        plane.style.opacity = '0';
        plane.style.display = 'none';
        plane.classList.remove('fly');
    }

    if (graphCtx2d && graphCanvas) graphCtx2d.clearRect(0, 0, graphCanvas.width, graphCanvas.height);

    resetBetState(bet1);
    resetBetState(bet2);

    if (bet1.auto) placeBet(1);
    if (bet2.auto) placeBet(2);

    spawnSimulatedBets();
    updateUI();
    showCountdownRing(countdown);

    let lastTickSec = Math.ceil(countdown);
    const tickInterval = setInterval(() => {
        countdown -= 0.1;
        updateCountdownRing(Math.max(0, countdown));
        if (statusEl) statusEl.textContent = `Starting in ${Math.max(0, countdown).toFixed(1)}s`;

        // Tick sound on each whole second
        const thisSec = Math.ceil(countdown);
        if (thisSec < lastTickSec && thisSec > 0) {
            playSoundTick();
            lastTickSec = thisSec;
        }

        if (countdown <= 0) { clearInterval(tickInterval); hideCountdownRing(); launchRound(); }
    }, 100);
}

// ══════════════════════════════════════════════
// COUNTDOWN RING
// ══════════════════════════════════════════════
function showCountdownRing(total) {
    let ring = document.getElementById('countdownRing');
    if (!ring) {
        ring = document.createElement('div');
        ring.id = 'countdownRing';
        ring.innerHTML = `
            <svg viewBox="0 0 120 120" width="120" height="120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="6"/>
                <circle id="ringArc" cx="60" cy="60" r="52" fill="none" stroke="#ff3c6e"
                    stroke-width="6" stroke-linecap="round"
                    stroke-dasharray="327" stroke-dashoffset="0"
                    transform="rotate(-90 60 60)"
                    style="transition:stroke-dashoffset 0.1s linear;filter:drop-shadow(0 0 6px #ff3c6e)"/>
            </svg>`;
        ring.style.cssText = 'position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);z-index:15;pointer-events:none;opacity:0;transition:opacity 0.3s;';
        document.getElementById('gameBoard').appendChild(ring);
    }
    ring.style.opacity = '1';
}

function updateCountdownRing(remaining) {
    const arc = document.getElementById('ringArc');
    if (!arc) return;
    const circumference = 327;
    const offset = circumference * (1 - remaining / 5);
    arc.setAttribute('stroke-dashoffset', offset);
    const ratio = remaining / 5;
    if (ratio > 0.6) arc.setAttribute('stroke', '#00e676');
    else if (ratio > 0.3) arc.setAttribute('stroke', '#ffd700');
    else arc.setAttribute('stroke', '#ff3c6e');
}

function hideCountdownRing() {
    const ring = document.getElementById('countdownRing');
    if (ring) ring.style.opacity = '0';
}

// ══════════════════════════════════════════════
// LAUNCH & TICK
// ══════════════════════════════════════════════
function launchRound() {
    gameState = 'playing';
    roundStartTime = Date.now();
    
    // EVERYONE calculates the SAME crash point based on the SAME time seed
    crashPoint = calculateSyncedCrashPoint();

    const statusEl = document.getElementById('status');
    const plane = document.getElementById('plane');
    if (statusEl) statusEl.textContent = '';
    
    if (plane) {
        plane.classList.add('fly');
        plane.style.left = '0'; 
        plane.style.top = '0';
        plane.style.display = 'block';
        plane.style.opacity = '1';
    }

    // 🌍 PURE MULTIPLIERS ONLY (Fixes the stuck plane bug)
    graphPoints = [];
    graphPoints.push(1.0);

    startEngineRumble(); // 🔊 Engine starts
    startRisingTone();
    playSoundTakeoff();

    gameInterval = setInterval(gameTick, tickSpeed);
}

function gameTick() {
    // 🌍 FLIGHT SYNC: Calculate exact multiplier using elapsed round time for flawless smooth curve drawing
    const elapsed = Date.now() - roundStartTime;
    const mt = Math.pow(1.08, elapsed / 1000); // Base growth
    
    // Determine bounds and collisions
    if (mt >= crashPoint) {
        currentMultiplier = parseFloat(crashPoint.toFixed(2));
        crash();
        return;
    }

    currentMultiplier = parseFloat(mt.toFixed(2));

    // 🌍 DYNAMIC FLIGHT: Store the multiplier, not the coordinate
    graphPoints.push(currentMultiplier);
    
    if (graphCanvas) {
        const rel = getGraphXY(currentMultiplier, graphCanvas.width, graphCanvas.height);
        if (graphPoints.length > 1) spawnParticles(rel.pxX, rel.pxY);
        updateParticles();
        drawGraph();
    }

    const multEl = document.getElementById('multiplier');
    if (multEl) {
        multEl.textContent = currentMultiplier.toFixed(2) + 'x';
        if (currentMultiplier < 2) multEl.className = 'mult-display mult-low';
        else if (currentMultiplier < 5) multEl.className = 'mult-display mult-mid';
        else if (currentMultiplier < 10) multEl.className = 'mult-display mult-high';
        else multEl.className = 'mult-display mult-ultra';

        // Milestone bounce
        [2, 5, 10, 20].forEach(m => {
            if (currentMultiplier >= m && currentMultiplier < m + tickIncrement * 2) {
                triggerMultiplierBounce(multEl);
                playMilestoneSound(m);
            }
        });
    }

    updateRisingTone(currentMultiplier);
    updateEngineRumble(currentMultiplier); // 🔊 Engine pitch rises

    // Auto cashout
    [1, 2].forEach(num => {
        const bet = num === 1 ? bet1 : bet2;
        const toggle = document.getElementById('autoCashoutToggle' + num);
        if (toggle && toggle.checked) {
            const val = parseFloat(document.getElementById('autoCashOutValue' + num).value);
            if (bet.active && !bet.cashed && currentMultiplier >= val) cashOutBet(num);
        }
    });

    updateSimulatedBetsFeed();
    syncBetCard(1);
    syncBetCard(2);

    if (currentMultiplier >= crashPoint) crash();
}

// ══════════════════════════════════════════════
// MULTIPLIER MILESTONE BOUNCE
// ══════════════════════════════════════════════
function triggerMultiplierBounce(el) {
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = 'multBounce 0.4s ease';
}

// ══════════════════════════════════════════════
// CRASH
// ══════════════════════════════════════════════
function crash() {
    clearInterval(gameInterval);
    stopEngineRumble(); // 🔊 Engine dies
    stopRisingTone();
    gameState = 'crashed';

    const plane = document.getElementById('plane');
    const overlay = document.getElementById('crashedOverlay');
    const crashedText = document.getElementById('crashedText');
    const multEl = document.getElementById('multiplier');
    const statusEl = document.getElementById('status');
    const board = document.getElementById('gameBoard');

    if (plane) { plane.classList.remove('fly'); plane.style.opacity = '0'; }
    if (overlay) overlay.classList.remove('hidden');
    if (crashedText) crashedText.textContent = `FLEW AWAY @ ${currentMultiplier.toFixed(2)}x`;
    if (multEl) multEl.classList.add('crashed-color');
    if (statusEl) statusEl.textContent = '';

    if (board) {
        board.classList.add('screen-shake');
        setTimeout(() => board.classList.remove('screen-shake'), 600);
    }

    haptic([80, 40, 80, 40, 120]);  // strong buzz on crash
    playSoundExplosion(); // 💥 Explosion!
    triggerExplosion();
    drawGraph();

    crashSimulatedBets();
    addToCrashHistory(currentMultiplier);

    [bet1, bet2].forEach(bet => {
        if (bet.active && !bet.cashed) {
            // 📜 Add loss to history
            personalHistory.unshift({
                name: currentUser.phone.slice(-4).padStart(4, '*'),
                avatar: '🌟',
                betAmt: bet.amount,
                mult: currentMultiplier.toFixed(2) + 'x',
                winAmt: 0,
                status: 'crashed'
            });
            showToast(`💥 Flew away at ${currentMultiplier.toFixed(2)}x! Lost KES ${formatNum(bet.amount)}`, 'error');
        }
    });

    saveBalance();
    updateUI();
    setTimeout(startNewRound, 3500);
}

// ══════════════════════════════════════════════
// EXPLOSION EFFECT (visual)
// ══════════════════════════════════════════════
function triggerExplosion() {
    const board = document.getElementById('gameBoard');
    if (!board) return;
    for (let i = 0; i < 3; i++) {
        const ring = document.createElement('div');
        ring.className = 'explosion-ring';
        ring.style.animationDelay = (i * 0.12) + 's';
        board.appendChild(ring);
        setTimeout(() => ring.remove(), 1200);
    }
    const flash = document.createElement('div');
    flash.className = 'crash-flash';
    board.appendChild(flash);
    setTimeout(() => flash.remove(), 400);
}

// ══════════════════════════════════════════════
// CRASH HISTORY & TICKER
// ══════════════════════════════════════════════
async function addToCrashHistory(m) {
    const mult = parseFloat(m).toFixed(2);
    // 🌍 Sync to Supabase so it's "across the system"
    const { error } = await supabase.from('game_history').insert([{ multiplier: mult }]);
    
    if (!error) {
        // Only add to local state if DB insert succeeded to keep things in sync
        crashHistory.unshift(mult);
        if (crashHistory.length > 50) crashHistory.pop();
        renderTicker();
    } else {
        console.error("History sync failed", error);
    }
}

function renderTicker() {
    const ticker = document.getElementById('historyTicker');
    if (!ticker) return;
    if (!crashHistory || crashHistory.length === 0) { 
        ticker.innerHTML = '<div class="tick-pill gray">–</div>'; 
        return; 
    }
    
    ticker.innerHTML = crashHistory.map(c => {
        // 🛡️ Robust fallback: check if it's an object or just a value
        const val = (typeof c === 'object' && c !== null) ? c.multiplier : c;
        // 🚩 Aggressively skip any undefined/null/bad data
        if (!val || val === 'undefined' || val === 'null' || isNaN(parseFloat(val))) return '';
        
        const m = parseFloat(val);
        const cls = m < 2 ? 'red' : m < 5 ? 'green' : m < 10 ? 'purple' : 'gold';
        return `<div class="tick-pill ${cls}">${m.toFixed(2)}x</div>`;
    }).join('');
}

// ══════════════════════════════════════════════
// SIMULATED BETS FEED
// ══════════════════════════════════════════════
const PLAYER_NAMES = [
    '1***3', '2***5', '3***0', '4***8', '5***5', '6***6', '7***3', '8***1', '9***4', '0***2',
    '1***7', '2***9', '3***4', '4***1', '5***8', '6***3', '7***6', '8***0', '9***7', '0***5',
    '1***2', '2***8', '3***6', '4***4', '5***1', '7***2', '8***9', '9***1', '0***3', '1***6',
    '2***4', '3***8', '4***7', '5***3', '6***0', '7***5', '8***6', '9***2', '0***8', '1***4'
];
const AVATARS = ['🟣', '🔵', '🟢', '🔴', '🟠', '🟡', '🔶', '💜', '❤️', '💙'];

function startTotalCountAnimation() {
    simulatedTotalCount = 6000 + Math.floor(Math.random() * 3500);
    updateTotalCountDisplay();
    clearInterval(totalCountInterval);
    totalCountInterval = setInterval(() => {
        if (gameState === 'playing') {
            simulatedTotalCount += Math.floor(Math.random() * 3) + 1;
            updateTotalCountDisplay();
        }
    }, 300);
}

function updateTotalCountDisplay() {
    const countEl = document.getElementById('totalBetsCount');
    if (countEl) countEl.textContent = simulatedTotalCount.toLocaleString('en-KE');
}

function spawnSimulatedBets() {
    allBets = [];
    const count = 18 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
        allBets.push({
            id: Math.random(),
            name: PLAYER_NAMES[Math.floor(Math.random() * PLAYER_NAMES.length)],
            avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
            betAmt: (Math.floor(Math.random() * 400) + 200) * 10,
            cashAt: parseFloat((1.0 + Math.random() * 8).toFixed(2)),
            status: 'playing',
            winAmt: 0,
            mult: null,
        });
    }
    startTotalCountAnimation();
    renderAllBets();
}

function addMyBetToFeed(num, amount) {
    allBets = allBets.filter(b => b.id !== 'me' + num);
    const phone = currentUser ? currentUser.phone : '0000000000';
    allBets.unshift({
        id: 'me' + num,
        name: phone.slice(-4).padStart(4, '*'),
        avatar: '🌟',
        betAmt: amount,
        cashAt: Infinity,
        status: 'playing',
        winAmt: 0,
        mult: null,
        isMe: true,
    });
    renderAllBets();
}

function updateMyBetInFeed(num, mult, winAmt, status) {
    const entry = allBets.find(b => b.id === 'me' + num);
    if (entry) { entry.status = status; entry.mult = mult; entry.winAmt = winAmt; }
    renderAllBets();
}

function updateSimulatedBetsFeed() {
    allBets.forEach(b => {
        if (b.status === 'playing' && currentMultiplier >= b.cashAt) {
            b.status = 'cashed';
            b.mult = b.cashAt;
            b.winAmt = Math.floor(b.betAmt * b.cashAt);
        }
    });
    renderAllBets();
}

function crashSimulatedBets() {
    allBets.forEach(b => {
        if (b.status === 'playing') { b.status = 'crashed'; b.mult = currentMultiplier; b.winAmt = 0; }
    });
    renderAllBets();
}

function renderAllBets() {
    const list = document.getElementById('allBetsList');
    if (!list) return;
    updateTotalCountDisplay();

    // 🎯 Dynamic Source Selection
    let sourceData = [];
    if (activeBetsTab === 'all') {
        sourceData = allBets;
    } else if (activeBetsTab === 'previous') {
        sourceData = personalHistory;
    } else if (activeBetsTab === 'top') {
        // 🏆 Sort All Bets by highest win amount for the 'Top' tab
        sourceData = [...allBets].sort((a, b) => b.winAmt - a.winAmt).slice(0, 50);
    }

    list.innerHTML = sourceData.map(b => {
        const multClass = b.status === 'cashed' ? 'won' : b.status === 'crashed' ? 'lost' : 'playing';
        
        let multTxt = '–';
        if (b.status === 'playing') multTxt = '...';
        else if (typeof b.mult === 'string') multTxt = b.mult;
        else if (b.mult) multTxt = parseFloat(b.mult).toFixed(2) + 'x';

        let winTxt = '...';
        if (b.status === 'cashed') winTxt = formatNum(b.winAmt);
        else if (b.status === 'crashed') winTxt = (activeBetsTab === 'previous' ? '-'+formatNum(b.betAmt) : '–');
        
        const meClass = b.isMe ? 'me-highlight' : '';
        
        return `<div class="bet-row ${b.status} ${meClass}">
            <div class="player"><span>${b.avatar}</span> ${b.name}</div>
            <div class="bet-amt">${formatNum(b.betAmt)}</div>
            <div class="mult ${multClass}">${multTxt}</div>
            <div class="win-amt">${winTxt}</div>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════════
// SAVE / MISC
// ══════════════════════════════════════════════
async function saveBalance() {
    if (!currentUser) return;
    
    // Update local currentUser object
    currentUser.balance = balance;

    // Update Supabase
    const { error } = await supabase
        .from('profiles')
        .update({ balance: balance })
        .eq('id', currentUser.id);

    if (error) {
        console.error('Error saving balance to Supabase:', error);
    }
}

function formatNum(n) {
    return parseFloat(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ══════════════════════════════════════════════
// PROFILE / MODALS
// ══════════════════════════════════════════════
function openProfile() {
    if (!currentUser) return;
    const phone = currentUser.phone;
    const formatted = '+' + phone.slice(0, 3) + ' ' + phone.slice(3, 6) + ' ' + phone.slice(6);
    document.getElementById('profilePhone').textContent = formatted;
    document.getElementById('profileBalance').textContent = 'KES ' + formatNum(balance);
    if (currentUser.created_at) {
        document.getElementById('profileCreated').textContent = new Date(currentUser.created_at).toLocaleDateString();
    }
    // Referral code
    const refEl = document.getElementById('profileReferralCode');
    if (refEl) refEl.textContent = currentUser.referral_code || '—';
    // Referral count (mocking for now or fetching if exists)
    const refCount = document.getElementById('profileReferralCount');
    if (refCount) refCount.textContent = currentUser.referrals || 0;
    // Free bet notice
    const freeBetBanner = document.getElementById('freeBetBanner');
    if (freeBetBanner) {
        if (!currentUser.freeBetGiven) freeBetBanner.classList.remove('hidden');
        else freeBetBanner.classList.add('hidden');
    }
    // Admin actions
    const adminArea = document.getElementById('adminArea');
    if (adminArea) {
        adminArea.innerHTML = currentUser.isAdmin ? `
            <div class="admin-divider">🔒 Admin Tools</div>
            <button class="action-btn admin-btn" onclick="openAdminDashboard()">🛠️ Control Panel</button>
        ` : '';
    }

    document.getElementById('profileModal').classList.add('show');
}

let adminCachedUsers = [];

window.openAdminDashboard = async () => {
    closeProfile();
    document.getElementById('adminModal').classList.add('show');
    await fetchAdminUsers();
};

async function fetchAdminUsers() {
    const listEl = document.getElementById('adminUserList');
    if (!listEl) return;
    listEl.innerHTML = '<div style="padding:20px;text-align:center;">⌛ Fetching players...</div>';

    const { data: users, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        showToast('Failed to fetch users', 'error');
        return;
    }

    adminCachedUsers = users;
    renderAdminUserList(users);
    
    // Update Stats
    document.getElementById('adminTotalUsers').textContent = users.length;
    const totalBal = users.reduce((sum, u) => sum + (u.balance || 0), 0);
    document.getElementById('adminTotalBalance').textContent = `KES ${totalBal.toLocaleString()}`;
}

function filterAdminUsers(query) {
    const filtered = adminCachedUsers.filter(u => String(u.phone).includes(query));
    renderAdminUserList(filtered);
}

function renderAdminUserList(users) {
    const listEl = document.getElementById('adminUserList');
    if (!listEl) return;
    
    if (users.length === 0) {
        listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No players found</div>';
        return;
    }

    listEl.innerHTML = users.map(u => `
        <div class="admin-row">
            <span class="phone">${u.phone || 'Unknown'}</span>
            <span class="bal">KES ${formatNum(u.balance || 0)}</span>
            <div class="actions">
                <button class="small-btn" style="background:#448aff;color:#fff;" onclick="window.customSetBalance('${u.id}')">Set</button>
                <button class="small-btn gold-btn" onclick="adjustBalance('${u.id}', 500)">+500</button>
                <button class="small-btn" style="background:#ff4444;color:#fff;" onclick="adjustBalance('${u.id}', -500)">-500</button>
            </div>
        </div>
    `).join('');
}

window.adjustBalance = async (userId, delta) => {
    if (!currentUser || !currentUser.isAdmin) {
        showToast('Unauthorized: Admin access required', 'error');
        return;
    }
    const user = adminCachedUsers.find(u => u.id === userId);
    if (!user) return;
    
    const newBal = (user.balance || 0) + delta;
    if (newBal < 0) { showToast('Balance cannot be negative', 'error'); return; }

    const { error } = await supabase
        .from('profiles')
        .update({ balance: newBal })
        .eq('id', userId);

    if (error) {
        showToast('Update failed', 'error');
    } else {
        showToast(`Balance updated for ${user.phone}`, 'success');
        haptic([30, 50]);
        fetchAdminUsers(); // Refresh
        
        // If it was ME, update local balance
        if (currentUser && userId === currentUser.id) {
            balance = newBal;
            updateUI();
        }
    }
};

window.customSetBalance = async (userId) => {
    if (!currentUser || !currentUser.isAdmin) {
        showToast('Unauthorized: Admin access required', 'error');
        return;
    }
    const user = adminCachedUsers.find(u => u.id === userId);
    if (!user) return;
    
    const input = prompt(`Enter exact new balance for ${user.phone} (or prefix with +/- to adjust):`);
    if (input === null || input.trim() === '') return;
    
    let isDelta = input.trim().startsWith('+') || input.trim().startsWith('-');
    let val = parseFloat(input);
    if (isNaN(val)) { showToast('Invalid amount', 'error'); return; }
    
    const newBal = isDelta ? ((user.balance || 0) + val) : val;
    if (newBal < 0) { showToast('Balance cannot be negative', 'error'); return; }

    const { error } = await supabase
        .from('profiles')
        .update({ balance: newBal })
        .eq('id', userId);

    if (error) {
        showToast('Update failed', 'error');
    } else {
        showToast(`Balance set to KES ${newBal} for ${user.phone}`, 'success');
        haptic([30, 50]);
        fetchAdminUsers(); // Refresh
        
        // If it was ME, update local balance
        if (currentUser && userId === currentUser.id) {
            balance = newBal;
            updateUI();
        }
    }
};

function copyReferralCode() {
    const code = currentUser?.referralCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
        showToast('Referral code copied! Share with friends 🎉', 'success');
        haptic([30, 20, 30]);
    }).catch(() => {
        showToast('Your code: ' + code, 'info');
    });
}
function closeProfile() { document.getElementById('profileModal').classList.remove('show'); }
function openDepositModal() { closeProfile(); document.getElementById('depositModal').classList.add('show'); }
function closeDepositModal() { document.getElementById('depositModal').classList.remove('show'); document.getElementById('depositAmount').value = ''; }
function openWithdrawModal() {
    closeProfile();
    // Pre-fill balance display
    const bd = document.getElementById('withdrawBalanceDisplay');
    if (bd) bd.textContent = formatNum(balance);
    // Pre-fill phone
    const wp = document.getElementById('withdrawPhone');
    if (wp && currentUser?.phone) wp.value = String(currentUser.phone).replace(/^254/, '0');
    document.getElementById('withdrawModal').classList.add('show');
}
function closeWithdrawModal() { document.getElementById('withdrawModal').classList.remove('show'); document.getElementById('withdrawAmount').value = ''; }

// ─── Admin tab switching ──────────────────────────────
window.switchAdminTab = function(tab) {
    document.getElementById('adminPlayersPanel').style.display    = tab === 'players'     ? '' : 'none';
    document.getElementById('adminWithdrawalsPanel').style.display = tab === 'withdrawals' ? '' : 'none';
    document.getElementById('adminTabPlayers').classList.toggle('active',     tab === 'players');
    document.getElementById('adminTabWithdrawals').classList.toggle('active', tab === 'withdrawals');
    if (tab === 'withdrawals') fetchAdminWithdrawals();
};

async function fetchAdminWithdrawals() {
    const listEl = document.getElementById('adminWithdrawalList');
    if (!listEl) return;
    listEl.innerHTML = '<div style="padding:20px;text-align:center;">⌛ Loading...</div>';

    const { data, error } = await supabase
        .from('withdrawals')
        .select('*, profiles(phone)')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) { listEl.innerHTML = '<div style="padding:16px;color:#f44">Failed to load</div>'; return; }

    const pending = data.filter(w => w.status === 'pending').length;
    const pwdEl = document.getElementById('adminPendingWD');
    if (pwdEl) pwdEl.textContent = pending;

    if (!data.length) { listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No withdrawal requests</div>'; return; }

    listEl.innerHTML = data.map(w => {
        const phone = w.profiles?.phone || w.phone || '—';
        const date  = new Date(w.created_at).toLocaleString();
        const statusColor = w.status === 'approved' ? '#00e676' : w.status === 'rejected' ? '#f44' : '#ffd700';
        return `
        <div class="admin-row" style="flex-wrap:wrap;gap:6px;">
            <span class="phone">${phone}</span>
            <span class="bal">KES ${formatNum(w.amount)}</span>
            <span style="color:${statusColor};font-size:0.8em;font-weight:700;">${w.status.toUpperCase()}</span>
            <span style="font-size:0.75em;color:#888;">${date}</span>
            ${w.status === 'pending' ? `
            <div class="actions">
                <button class="small-btn gold-btn" onclick="approveWithdrawal('${w.id}','${w.user_id}',${w.amount},'${phone}')">✅ Pay</button>
                <button class="small-btn" style="background:#f44;color:#fff;" onclick="rejectWithdrawal('${w.id}','${w.user_id}',${w.amount})">❌ Reject</button>
            </div>` : ''}
        </div>`;
    }).join('');
}

window.approveWithdrawal = async (wdId, userId, amount, phone) => {
    if (!confirm(`Pay KES ${amount} to ${phone}?`)) return;
    // Mark approved in Supabase
    const { error } = await supabase.from('withdrawals').update({ status: 'approved' }).eq('id', wdId);
    if (error) { showToast('Failed to approve', 'error'); return; }
    showToast(`✅ KES ${formatNum(amount)} approved for ${phone}`, 'success');
    fetchAdminWithdrawals();
};

window.rejectWithdrawal = async (wdId, userId, amount) => {
    if (!confirm(`Reject this withdrawal and refund KES ${amount}?`)) return;
    // Refund balance
    const { data: prof } = await supabase.from('profiles').select('balance').eq('id', userId).single();
    if (prof) {
        await supabase.from('profiles').update({ balance: (prof.balance || 0) + amount }).eq('id', userId);
    }
    await supabase.from('withdrawals').update({ status: 'rejected' }).eq('id', wdId);
    showToast('Withdrawal rejected & balance refunded', 'info');
    fetchAdminWithdrawals();
};


// ─── Quick-amount helpers ────────────────────────────
window.setDepositAmt  = (n) => { document.getElementById('depositAmount').value = n; };
window.setWithdrawAmt = (n) => { document.getElementById('withdrawAmount').value = n; };

// ─── STK Push via secure backend ─────────────────────
async function requestSTKPush(phone, amount) {
    const res = await fetch('/api/deposit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, amount, userId: currentUser?.id })
    });
    return res.json();
}

async function processDeposit() {
    const amount   = parseFloat(document.getElementById('depositAmount').value);
    const phoneRaw = document.getElementById('depositPhone').value.trim()
                  || (currentUser?.phone ? String(currentUser.phone).replace(/^254/, '0') : '');

    if (!phoneRaw) { showToast('Enter your M-Pesa phone number', 'error'); return; }
    if (!amount || amount < 100) { showToast('Minimum deposit is KES 100', 'error'); return; }

    const btn  = document.getElementById('confirmDepositBtn');
    const note = document.getElementById('depositNote');
    btn.disabled   = true;
    btn.textContent = '⏳ Sending...';
    note.textContent = 'Sending STK push to your phone…';

    try {
        const result = await requestSTKPush(phoneRaw, amount);

        if (result?.success) {
            showToast('📲 Check your phone and enter M-Pesa PIN!', 'info');
            note.textContent = '✅ STK Push sent! Your balance will update automatically after payment.';
            // Balance is credited by the Safaricom callback (deposit-callback.js)
            // We wait 15s then re-fetch balance from Supabase
            setTimeout(async () => {
                const { data: prof } = await supabase
                    .from('profiles').select('balance,free_bet_given').eq('id', currentUser.id).single();
                if (prof) {
                    balance = prof.balance;
                    currentUser.freeBetGiven = prof.free_bet_given;
                    saveBalance(); updateUI();
                }
            }, 15000);
            closeDepositModal();
        } else {
            note.textContent = result?.message || 'Payment failed. Please try again.';
            showToast(`❌ ${result?.message || 'STK Push failed'}`, 'error');
        }
    } catch (err) {
        console.error('Deposit error:', err);
        note.textContent = 'Network error. Please try again.';
        showToast('❌ Could not reach payment server. Try again.', 'error');
    } finally {
        btn.disabled    = false;
        btn.textContent = '📲 Send STK Push';
    }
}

async function processWithdraw() {
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const phoneRaw = document.getElementById('withdrawPhone').value.trim()
                  || (currentUser?.phone ? String(currentUser.phone) : '');

    if (!phoneRaw) { showToast('Enter your M-Pesa phone number', 'error'); return; }
    if (!amount || amount < 100) { showToast('Minimum withdrawal is KES 100', 'error'); return; }
    if (amount > balance) { showToast('Insufficient balance', 'error'); return; }

    const btn = document.getElementById('confirmWithdrawBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Submitting...';

    try {
        // Deduct balance immediately (pending)
        const newBal = balance - amount;
        const { error: balErr } = await supabase
            .from('profiles')
            .update({ balance: newBal })
            .eq('id', currentUser.id);
        if (balErr) throw new Error('Balance update failed');

        // Save withdrawal request for admin approval
        const { error: wdErr } = await supabase.from('withdrawals').insert({
            user_id: currentUser.id,
            phone: phoneRaw,
            amount: amount,
            status: 'pending'
        });
        if (wdErr) throw new Error('Withdrawal request failed');

        balance = newBal;
        saveBalance(); updateUI();
        closeWithdrawModal();
        showToast(`✅ Withdrawal of KES ${formatNum(amount)} submitted! Processed within 24hrs.`, 'success');
    } catch (err) {
        console.error('Withdraw error:', err);
        showToast('❌ Withdrawal failed. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ Request Withdrawal';
    }
}

async function logout() {
    try {
        showToast('Logging out...', 'info');
        
        // 1. Clear Supabase Session
        await supabase.auth.signOut();
        
        // 2. Clear Local State
        currentUser = null;
        balance = 0;
        localStorage.clear(); // Clear all local caches
        sessionStorage.clear();

        // 3. Smooth Redirect (replace prevents "Back" button issues)
        window.location.replace('auth.html');
    } catch (e) {
        window.location.href = 'auth.html';
    }
}

window.addEventListener('click', e => {
    ['profileModal', 'depositModal', 'withdrawModal'].forEach(id => {
        const el = document.getElementById(id);
        if (el && e.target === el) el.classList.remove('show');
    });
});

// ══════════════════════════════════════════════
// EXPOSE TO WINDOW
// ══════════════════════════════════════════════
window.openProfile = openProfile;
window.closeProfile = closeProfile;
window.openDepositModal = openDepositModal;
window.closeDepositModal = closeDepositModal;
window.openWithdrawModal = openWithdrawModal;
window.closeWithdrawModal = closeWithdrawModal;
window.processDeposit = processDeposit;
window.processWithdraw = processWithdraw;
window.logout = logout;
window.toggleTheme = () => {
    // Note: toggleTheme was in the inline script in index.html, 
    // but we can move it here if we want to modernize further.
    // For now, index.html handles it, but let's keep it consistent.
};
window.toggleMute = toggleMute;
window.adjustBet = adjustBet;
window.setBet = setBet;
window.placeBet = placeBet;
window.cashOutBet = cashOutBet;
window.toggleAutoBet = toggleAutoBet;
window.switchTab = switchTab;
window.copyReferralCode = copyReferralCode;