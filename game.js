// ══════════════════════════════════════════════
// GAME.JS — Enhanced
// ══════════════════════════════════════════════

// ── STATE ─────────────────────────────────────
let balance = 1000;
let freeBetBalance = 0;
let bet1 = { amount: 100, active: false, cashed: false, auto: false, winnings: 0, usingFreeBet: false };
let bet2 = { amount: 100, active: false, cashed: false, auto: false, winnings: 0, usingFreeBet: false };
let currentMultiplier = 1.0;
let crashPoint = 0;
let gameInterval = null;
let currentUser = null;
let crashHistory = [];
let gameState = 'waiting';
let countdown = 5;
let allBets = [];
let muted = false;

let tickSpeed = 50;
let tickIncrement = 0.02;
let elapsedTicks = 0;

// Graph canvas state
let graphPoints = [];
let graphCanvas = null;
let graphCtx2d = null;

// Particle trail state
let particles = [];

// Simulated counts
let simulatedTotalCount = 0;
let totalCountInterval = null;
let livePlayerCount = 0;
let livePlayerInterval = null;

// ── AUDIO — single AudioContext, all nodes tracked ─────────
let audioCtx = null;
let risingOscillator = null;
let risingGain = null;
let engineRumbleSource = null;
let engineRumbleGain = null;
// Master gain — muting goes through this so NOTHING leaks
let masterGain = null;

// ── LOADING SCREEN ─────────────────────────────
function hideLoadingScreen() {
    const ls = document.getElementById('loadingScreen');
    if (!ls) return;
    ls.style.transition = 'opacity 0.5s ease';
    ls.style.opacity = '0';
    setTimeout(() => { ls.style.display = 'none'; }, 500);
}

// ══════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════
window.addEventListener('load', () => {
    const stored = localStorage.getItem('currentUser');
    if (!stored) { window.location.href = 'auth.html'; return; }
    try { currentUser = JSON.parse(stored); } catch (e) { window.location.href = 'auth.html'; return; }
    if (currentUser.expiresAt && new Date(currentUser.expiresAt) < new Date()) {
        localStorage.removeItem('currentUser');
        window.location.href = 'auth.html';
        return;
    }

    balance = currentUser.balance;
    freeBetBalance = currentUser.freeBetBalance || 0;

    const hist = localStorage.getItem('crashHistory_' + currentUser.phone);
    if (hist) { try { crashHistory = JSON.parse(hist); } catch (e) { } }

    // Show loading screen for a beat, then start
    setTimeout(() => {
        hideLoadingScreen();
        initAudio();
        initCanvas();
        updateUI();
        renderTicker();
        startLivePlayerCount();
        startNewRound();
    }, 1800);
});

// ══════════════════════════════════════════════
// HAPTIC FEEDBACK
// ══════════════════════════════════════════════
function haptic(type = 'light') {
    if (!navigator.vibrate) return;
    const patterns = {
        light: [10],
        medium: [20],
        heavy: [30, 10, 30],
        success: [10, 50, 10],
        error: [50, 20, 50],
        cashout: [15, 30, 15, 30, 15],
        crash: [100, 50, 100],
        tick: [5],
    };
    navigator.vibrate(patterns[type] || [10]);
}

// ══════════════════════════════════════════════
// AUDIO ENGINE — all routed through masterGain
// ══════════════════════════════════════════════
function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Master gain node — muting sets this to 0, not individual nodes
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(1, audioCtx.currentTime);
        masterGain.connect(audioCtx.destination);
    } catch (e) { }
}

function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function setMasterMute(mute) {
    if (!masterGain || !audioCtx) return;
    masterGain.gain.setValueAtTime(mute ? 0 : 1, audioCtx.currentTime);
}

function playTone(freq, dur, type = 'sine', vol = 0.08) {
    if (!audioCtx || !masterGain) return;
    resumeAudio();
    try {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, audioCtx.currentTime);
        g.gain.setValueAtTime(vol, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        o.connect(g);
        g.connect(masterGain); // ← route through master
        o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { }
}

// ── Bet placed ─────────────────────────────────
function playSoundBetPlaced() {
    if (!audioCtx) return;
    resumeAudio();
    playTone(900, 0.06, 'square', 0.05);
    setTimeout(() => playTone(1200, 0.12, 'sine', 0.06), 60);
}

// ── Engine rumble ─────────────────────────────
function startEngineRumble() {
    if (!audioCtx || !masterGain) return;
    resumeAudio();
    stopEngineRumble();
    try {
        engineRumbleGain = audioCtx.createGain();
        engineRumbleGain.gain.setValueAtTime(0.0, audioCtx.currentTime);
        engineRumbleGain.gain.linearRampToValueAtTime(0.05, audioCtx.currentTime + 0.6);
        engineRumbleGain.connect(masterGain); // ← master

        const sub = audioCtx.createOscillator();
        sub.type = 'sawtooth';
        sub.frequency.setValueAtTime(55, audioCtx.currentTime);
        sub.frequency.linearRampToValueAtTime(80, audioCtx.currentTime + 0.5);

        const mid = audioCtx.createOscillator();
        mid.type = 'square';
        mid.frequency.setValueAtTime(110, audioCtx.currentTime);

        const bufSize = audioCtx.sampleRate * 2;
        const noiseBuffer = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.15;
        const noiseSource = audioCtx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        const lpf = audioCtx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(400, audioCtx.currentTime);

        sub.connect(engineRumbleGain);
        mid.connect(engineRumbleGain);
        noiseSource.connect(lpf);
        lpf.connect(engineRumbleGain);

        sub.start(); mid.start(); noiseSource.start();
        engineRumbleSource = { sub, mid, noise: noiseSource };
    } catch (e) { }
}

function updateEngineRumble(mult) {
    if (!engineRumbleSource || !engineRumbleGain || !audioCtx) return;
    try {
        const vol = Math.min(0.12, 0.04 + (mult - 1) * 0.004);
        engineRumbleGain.gain.setValueAtTime(vol, audioCtx.currentTime);
        const freq = 55 + Math.min(120, (mult - 1) * 8);
        engineRumbleSource.sub.frequency.setValueAtTime(freq, audioCtx.currentTime);
        engineRumbleSource.mid.frequency.setValueAtTime(freq * 2, audioCtx.currentTime);
    } catch (e) { }
}

function stopEngineRumble() {
    if (!engineRumbleSource) return;
    try {
        if (engineRumbleGain && audioCtx) {
            engineRumbleGain.gain.setValueAtTime(engineRumbleGain.gain.value, audioCtx.currentTime);
            engineRumbleGain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        }
        const src = engineRumbleSource;
        setTimeout(() => {
            try { src.sub.stop(); } catch (e) { }
            try { src.mid.stop(); } catch (e) { }
            try { src.noise.stop(); } catch (e) { }
        }, 350);
    } catch (e) { }
    engineRumbleSource = null;
    engineRumbleGain = null;
}

// ── Rising tone ────────────────────────────────
function startRisingTone() {
    if (!audioCtx || !masterGain) return;
    resumeAudio();
    stopRisingTone();
    try {
        risingOscillator = audioCtx.createOscillator();
        risingGain = audioCtx.createGain();
        risingOscillator.type = 'sine';
        risingOscillator.frequency.setValueAtTime(200, audioCtx.currentTime);
        risingGain.gain.setValueAtTime(0.03, audioCtx.currentTime);
        risingOscillator.connect(risingGain);
        risingGain.connect(masterGain); // ← master
        risingOscillator.start();
    } catch (e) { }
}

function updateRisingTone(mult) {
    if (!risingOscillator || !audioCtx) return;
    try {
        const freq = 200 + Math.min(700, (mult - 1) * 40);
        risingOscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
    } catch (e) { }
}

function stopRisingTone() {
    if (!risingOscillator || !audioCtx) return;
    try {
        risingGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
        risingOscillator.stop(audioCtx.currentTime + 0.25);
    } catch (e) { }
    risingOscillator = null;
    risingGain = null;
}

// ── Cash out ──────────────────────────────────
function playSoundCashOut() {
    if (!audioCtx || !masterGain) return;
    resumeAudio();
    try {
        const now = audioCtx.currentTime;
        const notes = [
            { freq: 1047, t: 0, dur: 0.12 },
            { freq: 1319, t: 0.10, dur: 0.12 },
            { freq: 1568, t: 0.20, dur: 0.16 },
            { freq: 2093, t: 0.30, dur: 0.25 },
        ];
        notes.forEach(n => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'triangle';
            o.frequency.setValueAtTime(n.freq, now + n.t);
            g.gain.setValueAtTime(0.10, now + n.t);
            g.gain.exponentialRampToValueAtTime(0.001, now + n.t + n.dur);
            o.connect(g); g.connect(masterGain);
            o.start(now + n.t); o.stop(now + n.t + n.dur + 0.05);
        });
        setTimeout(() => {
            for (let i = 0; i < 4; i++) {
                setTimeout(() => playTone(1800 + Math.random() * 800, 0.06, 'sine', 0.04), i * 35);
            }
        }, 120);
    } catch (e) { }
}

// ── Explosion ──────────────────────────────────
function playSoundExplosion() {
    if (!audioCtx || !masterGain) return;
    resumeAudio();
    try {
        const now = audioCtx.currentTime;
        const boom = audioCtx.createOscillator();
        const boomGain = audioCtx.createGain();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(80, now);
        boom.frequency.exponentialRampToValueAtTime(20, now + 0.5);
        boomGain.gain.setValueAtTime(0.35, now);
        boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        boom.connect(boomGain); boomGain.connect(masterGain);
        boom.start(now); boom.stop(now + 0.65);

        const crack = audioCtx.createOscillator();
        const crackGain = audioCtx.createGain();
        crack.type = 'sawtooth';
        crack.frequency.setValueAtTime(200, now);
        crack.frequency.exponentialRampToValueAtTime(40, now + 0.3);
        crackGain.gain.setValueAtTime(0.18, now);
        crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        crack.connect(crackGain); crackGain.connect(masterGain);
        crack.start(now); crack.stop(now + 0.4);

        const bufSize = audioCtx.sampleRate * 0.6;
        const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) nd[i] = (Math.random() * 2 - 1);
        const ns = audioCtx.createBufferSource();
        ns.buffer = noiseBuf;
        const nsGain = audioCtx.createGain();
        nsGain.gain.setValueAtTime(0.15, now);
        nsGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        const hpf = audioCtx.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.setValueAtTime(600, now);
        ns.connect(hpf); hpf.connect(nsGain); nsGain.connect(masterGain);
        ns.start(now); ns.stop(now + 0.6);

        setTimeout(() => {
            playTone(800, 0.4, 'sawtooth', 0.06);
            playTone(400, 0.5, 'sawtooth', 0.04);
        }, 80);
    } catch (e) { }
}

// ── Milestone ─────────────────────────────────
function playMilestoneSound(mult) {
    if (!audioCtx || !masterGain) return;
    resumeAudio();
    try {
        const freqs = { 2: 880, 5: 1100, 10: 1400, 20: 1800 };
        const freq = freqs[mult] || 880;
        const now = audioCtx.currentTime;
        [0, 0.12].forEach((delay, i) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'triangle';
            o.frequency.setValueAtTime(freq * (i === 1 ? 1.25 : 1), now + delay);
            g.gain.setValueAtTime(0.12, now + delay);
            g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.25);
            o.connect(g); g.connect(masterGain);
            o.start(now + delay); o.stop(now + delay + 0.3);
        });
    } catch (e) { }
}

// ── Tick ──────────────────────────────────────
function playSoundTick() {
    playTone(440, 0.05, 'square', 0.03);
}

// ── Mute — now truly global via masterGain ─────
let _muteState = false;
function toggleMute() {
    _muteState = !_muteState;
    muted = _muteState;
    setMasterMute(muted); // ← single point of control
    const btn = document.getElementById('muteBtn');
    if (btn) btn.textContent = muted ? '🔇' : '🔊';
    haptic('light');
}

function playSound(freq, dur, type = 'sine') { playTone(freq, dur, type); }

// ══════════════════════════════════════════════
// CANVAS GRAPH
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
    const W = graphCanvas.width, H = graphCanvas.height;
    graphCtx2d.clearRect(0, 0, W, H);
    if (graphPoints.length < 2) return;

    const pts = graphPoints;
    const crashed = gameState === 'crashed';

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

    graphCtx2d.beginPath();
    graphCtx2d.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1], curr = pts[i];
        const cx = (prev.x + curr.x) / 2;
        graphCtx2d.bezierCurveTo(cx, prev.y, cx, curr.y, curr.x, curr.y);
    }
    graphCtx2d.strokeStyle = crashed ? '#ff2244' : '#ff1a50';
    graphCtx2d.lineWidth = 3;
    graphCtx2d.shadowColor = crashed ? '#ff2244' : '#ff4466';
    graphCtx2d.shadowBlur = 10;
    graphCtx2d.stroke();
    graphCtx2d.shadowBlur = 0;

    drawParticles();

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
let _toastTimer = null;
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
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(80px)';
        toast.style.opacity = '0';
    }, 2800);
}

// ══════════════════════════════════════════════
// UI UPDATE
// ══════════════════════════════════════════════
function updateUI() {
    document.getElementById('headerBalance').textContent = formatNum(balance);

    // Free bet pill
    const fbPill = document.getElementById('freeBetPill');
    const fbHeader = document.getElementById('headerFreeBet');
    if (fbPill && fbHeader) {
        if (freeBetBalance > 0) {
            fbPill.classList.remove('hidden');
            fbHeader.textContent = formatNum(freeBetBalance);
        } else {
            fbPill.classList.add('hidden');
        }
    }

    const pb = document.getElementById('profileBalance');
    if (pb) pb.textContent = 'KES ' + formatNum(balance);
    const pfb = document.getElementById('profileFreeBet');
    if (pfb) pfb.textContent = freeBetBalance > 0 ? 'KES ' + formatNum(freeBetBalance) : 'None';

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
    haptic('light');
    syncBetCard(num);
}

function setBet(num, val) {
    const bet = num === 1 ? bet1 : bet2;
    if (bet.active && gameState === 'playing') return;
    bet.amount = val;
    haptic('light');
    syncBetCard(num);
}

function switchTab(num, mode) {
    document.getElementById('betTab' + num).classList.toggle('active', mode === 'bet');
    document.getElementById('autoTab' + num).classList.toggle('active', mode === 'auto');
    const autoPanel = document.getElementById('autoCashoutPanel' + num);
    const autoRow = document.getElementById('autoBetRow' + num);
    if (autoPanel) autoPanel.classList.toggle('hidden', mode !== 'auto');
    if (autoRow) autoRow.classList.toggle('hidden', mode !== 'auto');
    haptic('light');
}

// ══════════════════════════════════════════════
// PLACE BET / CANCEL
// ══════════════════════════════════════════════
function placeBet(num) {
    resumeAudio();
    const bet = num === 1 ? bet1 : bet2;
    const input = document.getElementById('betAmount' + num);
    const amount = parseFloat(input.value);

    // Cancel pending bet
    if (bet.active && gameState === 'waiting') {
        if (bet.usingFreeBet) freeBetBalance += bet.amount;
        else balance += bet.amount;
        bet.active = false;
        bet.cashed = false;
        bet.usingFreeBet = false;
        saveBalance();
        updateUI();
        haptic('medium');
        showToast('Bet cancelled', 'warn');
        return;
    }

    if (isNaN(amount) || amount < 50) { haptic('error'); showToast('Minimum bet is KES 50', 'error'); return; }
    if (bet.active) return;

    // Try free bet balance first if main balance is short
    let usingFree = false;
    if (amount <= freeBetBalance) {
        usingFree = true;
        freeBetBalance -= amount;
    } else if (amount > balance) {
        haptic('error');
        showToast('Insufficient balance!', 'error');
        return;
    } else {
        balance -= amount;
    }

    bet.amount = amount;
    bet.active = true;
    bet.cashed = false;
    bet.winnings = 0;
    bet.usingFreeBet = usingFree;

    saveBalance();
    updateUI();
    haptic('medium');
    playSoundBetPlaced();
    addMyBetToFeed(num, amount);
}

// ══════════════════════════════════════════════
// CASH OUT
// ══════════════════════════════════════════════
function cashOutBet(num) {
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
    haptic('cashout');
    playSoundCashOut();
    showToast(`✅ KES ${formatNum(bet.winnings)} cashed at ${currentMultiplier.toFixed(2)}x!`, 'success');
}

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
    bet.usingFreeBet = false;
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

        const thisSec = Math.ceil(countdown);
        if (thisSec < lastTickSec && thisSec > 0) {
            playSoundTick();
            haptic('tick');
            lastTickSec = thisSec;
        }

        if (countdown <= 0) { clearInterval(tickInterval); hideCountdownRing(); launchRound(); }
    }, 100);
}

// ── COUNTDOWN RING ─────────────────────────────
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

// ── LAUNCH ─────────────────────────────────────
function launchRound() {
    gameState = 'playing';

    // Improved crash distribution — slightly more player-friendly
    const r = Math.random();
    if (r < 0.45) crashPoint = 1.0 + Math.random() * 1.0;   // 45% below 2x
    else if (r < 0.75) crashPoint = 2.0 + Math.random() * 3.0;   // 30% 2–5x
    else if (r < 0.93) crashPoint = 5.0 + Math.random() * 15.0;  // 18% 5–20x
    else crashPoint = 20 + Math.random() * 30.0;  // 7% 20–50x

    const statusEl = document.getElementById('status');
    const plane = document.getElementById('plane');
    if (statusEl) statusEl.textContent = '';
    if (plane) plane.classList.add('fly');

    if (graphCanvas) {
        const { x, y } = getGraphXY(1.0, graphCanvas.width, graphCanvas.height);
        graphPoints.push({ x, y });
    }

    startEngineRumble();
    startRisingTone();
    gameInterval = setInterval(gameTick, tickSpeed);
}

// ── GAME TICK ──────────────────────────────────
function gameTick() {
    elapsedTicks++;
    if (elapsedTicks % 50 === 0) {
        tickIncrement = Math.min(0.08, tickIncrement + 0.005);
    }
    currentMultiplier = parseFloat((currentMultiplier + tickIncrement).toFixed(2));

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

        [2, 5, 10, 20].forEach(m => {
            if (currentMultiplier >= m && currentMultiplier < m + tickIncrement * 2) {
                triggerMultiplierBounce(multEl);
                playMilestoneSound(m);
                haptic('medium');
            }
        });
    }

    updateRisingTone(currentMultiplier);
    updateEngineRumble(currentMultiplier);

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

function triggerMultiplierBounce(el) {
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = 'multBounce 0.4s ease';
}

// ── CRASH ──────────────────────────────────────
function crash() {
    clearInterval(gameInterval);
    stopEngineRumble();
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

    playSoundExplosion();
    haptic('crash');
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
    updateUI();
    setTimeout(startNewRound, 3500);
}

// ── EXPLOSION FX ───────────────────────────────
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
            status: 'playing', winAmt: 0, mult: null,
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
        betAmt: amount, cashAt: Infinity,
        status: 'playing', winAmt: 0, mult: null, isMe: true,
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
            b.status = 'cashed'; b.mult = b.cashAt; b.winAmt = Math.floor(b.betAmt * b.cashAt);
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
// FREE BET & REFERRAL REWARDS
// ══════════════════════════════════════════════
function grantFreeBetOnFirstDeposit() {
    if (!currentUser) return;
    const users = JSON.parse(localStorage.getItem('aviatorUsers')) || {};
    const user = users[currentUser.phone];
    if (!user || user.freeBetGiven) return;

    // Grant KES 20 free bet
    freeBetBalance += 20;
    user.freeBetBalance = (user.freeBetBalance || 0) + 20;
    user.freeBetGiven = true;
    currentUser.freeBetBalance = freeBetBalance;
    currentUser.freeBetGiven = true;
    localStorage.setItem('aviatorUsers', JSON.stringify(users));
    showToast('🎁 KES 20 Free Bet credited!', 'success');

    // Reward referrer if any
    if (user.referredBy && !user.referralRewarded) {
        const referrer = users[user.referredBy];
        if (referrer) {
            referrer.balance = (referrer.balance || 0) + 50;
            referrer.referralCount = (referrer.referralCount || 0) + 1;
            referrer.referralEarnings = (referrer.referralEarnings || 0) + 50;
            users[user.referredBy] = referrer;
            user.referralRewarded = true;
            localStorage.setItem('aviatorUsers', JSON.stringify(users));
            // If referrer is currently logged in, update their session too
            const refSession = JSON.parse(localStorage.getItem('currentUser') || '{}');
            if (refSession.phone === user.referredBy) {
                refSession.balance = referrer.balance;
                refSession.referralCount = referrer.referralCount;
                refSession.referralEarnings = referrer.referralEarnings;
                localStorage.setItem('currentUser', JSON.stringify(refSession));
            }
        }
    }
}

// ══════════════════════════════════════════════
// SAVE / MISC
// ══════════════════════════════════════════════
function saveBalance() {
    if (!currentUser) return;
    currentUser.balance = balance;
    currentUser.freeBetBalance = freeBetBalance;
    const stored = localStorage.getItem('currentUser');
    if (stored) {
        try {
            const prev = JSON.parse(stored);
            currentUser.expiresAt = prev.expiresAt;
            currentUser.createdAt = prev.createdAt || currentUser.createdAt;
        } catch (e) { }
    }
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    const users = JSON.parse(localStorage.getItem('aviatorUsers')) || {};
    if (users[currentUser.phone]) {
        users[currentUser.phone].balance = balance;
        users[currentUser.phone].freeBetBalance = freeBetBalance;
        localStorage.setItem('aviatorUsers', JSON.stringify(users));
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
    document.getElementById('profileFreeBet').textContent = freeBetBalance > 0 ? 'KES ' + formatNum(freeBetBalance) : 'None';
    if (currentUser.createdAt) {
        document.getElementById('profileCreated').textContent = new Date(currentUser.createdAt).toLocaleDateString();
    }
    // Referral
    const refCode = currentUser.referralCode || '';
    document.getElementById('profileReferralCode').textContent = refCode;
    document.getElementById('profileRefCount').textContent = currentUser.referralCount || 0;
    document.getElementById('profileRefEarnings').textContent = 'KES ' + formatNum(currentUser.referralEarnings || 0);
    document.getElementById('profileModal').classList.add('show');
    haptic('light');
}

function copyReferralCode() {
    const code = document.getElementById('profileReferralCode').textContent;
    if (!code || code === '–') return;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('copyRefBtn');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000); }
        showToast('Referral code copied!', 'success');
        haptic('success');
    }).catch(() => {
        showToast('Code: ' + code, 'info');
    });
}

function closeProfile() { document.getElementById('profileModal').classList.remove('show'); }

function openDepositModal() {
    closeProfile();
    const users = JSON.parse(localStorage.getItem('aviatorUsers')) || {};
    const user = currentUser ? users[currentUser.phone] : null;
    const notice = document.getElementById('freeBetNotice');
    if (notice) {
        notice.classList.toggle('hidden', !!(user && user.freeBetGiven));
    }
    document.getElementById('depositModal').classList.add('show');
}

function closeDepositModal() {
    document.getElementById('depositModal').classList.remove('show');
    document.getElementById('depositAmount').value = '';
}

function openWithdrawModal() {
    closeProfile();
    document.getElementById('withdrawModal').classList.add('show');
}

function closeWithdrawModal() {
    document.getElementById('withdrawModal').classList.remove('show');
    document.getElementById('withdrawAmount').value = '';
}

function processDeposit() {
    const amount = parseFloat(document.getElementById('depositAmount').value);
    if (!amount || amount < 100) { haptic('error'); showToast('Minimum deposit is KES 100', 'error'); return; }

    const isFirst = !currentUser.freeBetGiven;
    balance += amount;
    saveBalance();
    updateUI();
    closeDepositModal();
    haptic('success');
    showToast(`✅ KES ${formatNum(amount)} deposited!`, 'success');

    if (isFirst) grantFreeBetOnFirstDeposit();
}

function processWithdraw() {
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    if (!amount || amount < 100) { haptic('error'); showToast('Minimum withdrawal is KES 100', 'error'); return; }
    if (amount > balance) { haptic('error'); showToast('Insufficient balance', 'error'); return; }
    balance -= amount;
    saveBalance();
    updateUI();
    closeWithdrawModal();
    haptic('success');
    showToast(`✅ Withdrawal of KES ${formatNum(amount)} submitted!`, 'success');
}

function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = 'auth.html';
}

window.addEventListener('click', e => {
    ['profileModal', 'depositModal', 'withdrawModal'].forEach(id => {
        const el = document.getElementById(id);
        if (el && e.target === el) el.classList.remove('show');
    });
});