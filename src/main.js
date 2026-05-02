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

// ── PERFECT TIME SYNC ──
const ROUND_DURATION = 15000; // 15s total
const FLIGHT_LIMIT = 10000;   // 10s max flight

function getGlobalTimeMultiplier() {
    const now = Date.now();
    const elapsed = now % ROUND_DURATION;
    
    if (elapsed > FLIGHT_LIMIT) return null; // In-between rounds
    
    // Growth formula: 1.05 ^ (seconds) - Identical for all users
    const seconds = elapsed / 1000;
    return Math.pow(1.08, seconds);
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
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) { 
        window.location.href = 'auth.html'; 
        return; 
    }

    // Fetch profile from Supabase
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

    if (error || !profile) {
        console.error('Profile not found', error);
        window.location.href = 'auth.html';
        return;
    }

    currentUser = { ...session.user, ...profile };
    balance = profile.balance;

    // Fetch crash history (could be local or from DB, let's stick to local for simplicity or DB if table exists)
    const { data: history } = await supabase
        .from('game_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

    if (history) {
        crashHistory = history.map(h => h.multiplier);
        renderTicker();
    }

    initAudio();
    initCanvas();
    updateUI();

    // 📱 ROBUST MOBILE BINDINGS
    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', (e) => { e.preventDefault(); fn(); haptic([20]); });
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
    playSyncedSound('https://www.soundjay.com/buttons/sounds/button-11.mp3', 0.3);
}

function playSoundExplosion() {
    playSyncedSound('https://www.soundjay.com/buttons/sounds/button-10.mp3', 0.4);
}

function playSoundTakeoff() {
    playSyncedSound('https://www.soundjay.com/nature/sounds/wind-01.mp3', 0.2);
}


// ── 6. MILESTONE PINGS ────────────────────────────────────────
function playMilestoneSound(mult) {
    if (muted || !audioCtx) return;
    resumeAudio();
    try {
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
        stopEngineRumble();
        stopRisingTone();
    } else {
        if (audioCtx) try { audioCtx.resume(); } catch(e){}
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
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    if (!graphCanvas) return;
    graphCanvas.width = graphCanvas.offsetWidth;
    graphCanvas.height = graphCanvas.offsetHeight;
    graphCtx2d = graphCanvas.getContext('2d');
}

function getGraphXY(mult, canvasW, canvasH) {
    const progress = Math.min(1, (mult - 1.0) / 19.0);
    const x = progress * canvasW * 0.92 + canvasW * 0.04;
    const y = canvasH - (canvasH * 0.1 + Math.pow(progress, 0.7) * canvasH * 0.78);
    return { x, y };
}

function drawGraph() {
    if (!graphCtx2d || !graphCanvas) return;
    const W = graphCanvas.width;
    const H = graphCanvas.height;
    graphCtx2d.clearRect(0, 0, W, H);
    if (graphPoints.length < 2) return;

    const pts = graphPoints;
    const crashed = gameState === 'crashed';

    // Gradient fill under curve
    graphCtx2d.beginPath();
    graphCtx2d.moveTo(pts[0].x, H);
    pts.forEach(p => graphCtx2d.lineTo(p.x, p.y));
    graphCtx2d.lineTo(pts[pts.length - 1].x, H);
    graphCtx2d.closePath();
    const fillGrad = graphCtx2d.createLinearGradient(0, 0, 0, H);
    fillGrad.addColorStop(0, crashed ? 'rgba(255,40,80,0.45)' : 'rgba(200,0,60,0.5)');
    fillGrad.addColorStop(1, crashed ? 'rgba(255,40,80,0.02)' : 'rgba(200,0,60,0.03)');
    graphCtx2d.fillStyle = fillGrad;
    graphCtx2d.fill();

    // Curve line
    graphCtx2d.beginPath();
    graphCtx2d.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const cx = (prev.x + curr.x) / 2;
        graphCtx2d.bezierCurveTo(cx, prev.y, cx, curr.y, curr.x, curr.y);
    }
    graphCtx2d.strokeStyle = crashed ? '#ff2244' : '#ff1a50';
    graphCtx2d.lineWidth = 3;
    graphCtx2d.shadowColor = crashed ? '#ff2244' : '#ff4466';
    graphCtx2d.shadowBlur = 10;
    graphCtx2d.stroke();
    graphCtx2d.shadowBlur = 0;

    // Particle trail
    drawParticles();

    // Move SVG plane to end of curve
    const last = pts[pts.length - 1];
    const prev2 = pts.length > 1 ? pts[pts.length - 2] : pts[0];
    const angle = Math.atan2(last.y - prev2.y, last.x - prev2.x) * 180 / Math.PI;
    const planeSvg = document.getElementById('plane');
    if (planeSvg && gameState !== 'crashed') {
        const boardEl = document.getElementById('gameBoard');
        const scaleX = boardEl.offsetWidth / W;
        const scaleY = boardEl.offsetHeight / H;
        planeSvg.style.left = (last.x * scaleX - 60) + 'px';
        planeSvg.style.top = (last.y * scaleY - 20) + 'px';
        planeSvg.style.transform = `rotate(${Math.max(-35, Math.min(5, angle))}deg)`;
        planeSvg.style.position = 'absolute';
        planeSvg.style.right = 'auto';
        planeSvg.style.bottom = 'auto';
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
        plane.style.opacity = '1';
        plane.style.left = '4%';
        plane.style.top = '80%';
        plane.style.right = 'auto';
        plane.style.bottom = 'auto';
        plane.style.position = 'absolute';
        plane.style.transform = 'rotate(-15deg)';
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
    
    // EVERYONE calculates the SAME crash point based on the SAME time seed
    crashPoint = calculateSyncedCrashPoint();

    const statusEl = document.getElementById('status');
    const plane = document.getElementById('plane');
    if (statusEl) statusEl.textContent = '';
    if (plane) plane.classList.add('fly');

    if (graphCanvas) {
        const { x, y } = getGraphXY(1.0, graphCanvas.width, graphCanvas.height);
        graphPoints.push({ x, y });
    }

    startEngineRumble(); // 🔊 Engine starts
    startRisingTone();
    playSoundTakeoff();

    gameInterval = setInterval(gameTick, tickSpeed);
}

function gameTick() {
    // 🌍 PERFECT SYNC: Calculate multiplier based on global time
    const globalMult = getGlobalTimeMultiplier();
    
    if (globalMult === null && gameState === 'playing') {
        // We reached the end of the time window
        if (currentMultiplier < crashPoint) crash();
        return;
    }

    if (globalMult !== null) {
        currentMultiplier = parseFloat(globalMult.toFixed(2));
    }

    // Add graph point and draw
    if (graphCanvas) {
        const { x, y } = getGraphXY(currentMultiplier, graphCanvas.width, graphCanvas.height);
        graphPoints.push({ x, y });
        if (graphPoints.length > 1) spawnParticles(x, y);
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
            showToast(`💥 Flew away at ${currentMultiplier.toFixed(2)}x! Lost KES ${formatNum(bet.amount)}`, 'error');
        }
    });

    saveBalance();
    saveCrashToHistory(currentMultiplier); // Persist to Supabase
    updateUI();
    setTimeout(startNewRound, 3500);
}

async function saveCrashToHistory(mult) {
    const { error } = await supabase
        .from('game_history')
        .insert([{ multiplier: mult }]);
    if (error) console.error('Error saving crash history:', error);
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
function addToCrashHistory(m) {
    crashHistory.unshift({ multiplier: parseFloat(m).toFixed(2) });
    if (crashHistory.length > 30) crashHistory.pop();
    if (currentUser) localStorage.setItem('crashHistory_' + currentUser.phone, JSON.stringify(crashHistory));
    renderTicker();
}

function renderTicker() {
    const ticker = document.getElementById('historyTicker');
    if (!ticker) return;
    if (crashHistory.length === 0) { ticker.innerHTML = '<div class="tick-pill gray">–</div>'; return; }
    ticker.innerHTML = crashHistory.map(c => {
        const m = parseFloat(c.multiplier);
        const cls = m < 2 ? 'red' : m < 5 ? 'green' : m < 10 ? 'purple' : 'gold';
        return `<div class="tick-pill ${cls}">${c.multiplier}x</div>`;
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
    list.innerHTML = allBets.map(b => {
        const multClass = b.status === 'cashed' ? 'won' : b.status === 'crashed' ? 'lost' : 'playing';
        const multTxt = b.status === 'playing' ? '–' : (b.mult ? parseFloat(b.mult).toFixed(2) + 'x' : '–');
        const winTxt = b.status === 'cashed' ? formatNum(b.winAmt) : b.status === 'crashed' ? '–' : '...';
        const rowClass = b.status === 'cashed' ? 'cashed' : b.status === 'crashed' ? 'crashed' : '';
        return `<div class="bet-row ${rowClass}">
            <div class="player"><div class="player-avatar">${b.avatar}</div><span>${b.name}</span></div>
            <span class="bet-amt">${formatNum(b.betAmt)}</span>
            <span class="mult ${multClass}">${multTxt}</span>
            <span class="win-amt">${winTxt}</span>
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
    if (currentUser.createdAt) {
        document.getElementById('profileCreated').textContent = new Date(currentUser.createdAt).toLocaleDateString();
    }
    // Referral code
    const refEl = document.getElementById('profileReferralCode');
    if (refEl) refEl.textContent = currentUser.referralCode || '—';
    // Referral count
    const refCount = document.getElementById('profileReferralCount');
    if (refCount) refCount.textContent = currentUser.referralCount || 0;
    // Free bet notice
    const freeBetBanner = document.getElementById('freeBetBanner');
    if (freeBetBanner) {
        if (!currentUser.freeBetGiven) freeBetBanner.classList.remove('hidden');
        else freeBetBanner.classList.add('hidden');
    }
    document.getElementById('profileModal').classList.add('show');
}

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
function openWithdrawModal() { closeProfile(); document.getElementById('withdrawModal').classList.add('show'); }
function closeWithdrawModal() { document.getElementById('withdrawModal').classList.remove('show'); document.getElementById('withdrawAmount').value = ''; }

async function processDeposit() {
    const amount = parseFloat(document.getElementById('depositAmount').value);
    if (!amount || amount < 100) { showToast('Minimum deposit is KES 100', 'error'); return; }

    balance += amount;

    // ── KES 20 Free Bet on first deposit ──────────────────────
    let freeBetMsg = '';
    if (currentUser && !currentUser.freeBetGiven) {
        const FREE_BET = 20;
        balance += FREE_BET;
        currentUser.freeBetGiven = true;
        
        // Persist freeBetGiven in Supabase
        const { error } = await supabase
            .from('profiles')
            .update({ free_bet_given: true })
            .eq('id', currentUser.id);

        if (error) console.error('Error updating free bet status:', error);

        freeBetMsg = ' + KES 20 free bet bonus! 🎁';
        haptic([30, 20, 30, 20, 60]);
    }

    saveBalance(); updateUI();
    closeDepositModal();
    showToast(`✅ KES ${formatNum(amount)} deposited!${freeBetMsg}`, 'success');
}

async function processWithdraw() {
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    if (!amount || amount < 100) { showToast('Minimum withdrawal is KES 100', 'error'); return; }
    if (amount > balance) { showToast('Insufficient balance', 'error'); return; }
    balance -= amount; saveBalance(); updateUI();
    closeWithdrawModal();
    showToast(`✅ Withdrawal of KES ${formatNum(amount)} submitted!`, 'success');
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