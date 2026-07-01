/**
 * METRICWIN | AVIATOR ELITE
 * Core Game Engine (Unified & Secure)
 */

import { supabase } from './lib/supabase.js';

// ── STATE ──────────────────────────────────────────────────────────────────

let balance = 0;
let currentUser = null;
let gameState = 'waiting'; // 'waiting' | 'playing' | 'crashed'
let currentMultiplier = 1.0;
let serverTimeOffset = 0;
let serverRoundStartTime = 0;
let serverCrashPoint = 0;
let serverRoundId = 0;
let serverGameStatus = 'waiting';

let bet1 = { id: null, amount: 100, active: false, cashed: false, auto: false, winnings: 0 };
let bet2 = { id: null, amount: 100, active: false, cashed: false, auto: false, winnings: 0 };

let crashHistory = [];
let allBets = [];
let livePlayerCount = 0;
let animationFrameId = null;
let graphPoints = [];
let particles = [];
let muted = false;

// Configuration
const COUNTDOWN_DURATION = 5000;
const TICK_INCREMENT = 0.02;

// ── INITIALIZATION ─────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
    initAudio();
    initCanvas();
    await bootSequence();
    bindEvents();
    startServerSyncLoop();
});

async function bootSequence() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.replace('/auth');
        return;
    }

    const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

    if (error || !profile) {
        console.error("Profile load error", error);
        return;
    }

    currentUser = { ...session.user, ...profile };
    balance = parseFloat(profile.balance);
    
    // Load history
    const { data: history } = await supabase
        .from('game_history')
        .select('multiplier')
        .order('created_at', { ascending: false })
        .limit(20);
    
    if (history) crashHistory = history.map(h => h.multiplier);

    updateUI();
    renderTicker();
    renderAllBets();
}

// ── SERVER SYNC ─────────────────────────────────────────────────────────────

async function fetchServerState() {
    try {
        const url = import.meta.env.VITE_GAME_STATE_URL || '/api/game'; // Fallback to Vercel API if edge func not set
        const res = await fetch(url);
        const data = await res.json();
        
        serverTimeOffset = data.serverTime - Date.now();
        serverRoundId = data.roundId;
        serverRoundStartTime = data.roundStartTime;
        serverCrashPoint = data.crashPoint;

        const oldStatus = serverGameStatus;
        serverGameStatus = data.gameStatus;

        if (oldStatus !== serverGameStatus) {
            handleStatusChange(serverGameStatus);
        }
        
        return data;
    } catch (e) {
        console.error("Sync error", e);
        return null;
    }
}

function handleStatusChange(newStatus) {
    if (newStatus === 'waiting') {
        startNewRound();
    } else if (newStatus === 'playing' && gameState !== 'playing') {
        launchRound();
    } else if (newStatus === 'crashed' && gameState === 'playing') {
        crash();
    }
}

function startServerSyncLoop() {
    // Initial fetch
    fetchServerState();
    
    // Subscribe to Realtime Updates
    const channel = supabase
        .channel('game_state_changes')
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'active_game_state', filter: 'id=eq.1' },
            (payload) => {
                const data = payload.new;
                serverRoundId = data.round_id;
                serverRoundStartTime = new Date(data.start_time).getTime();
                serverCrashPoint = data.crash_point;
                handleStatusChange(data.status);
            }
        )
        .subscribe();
}

// ── GAME LOGIC ─────────────────────────────────────────────────────────────

function startNewRound() {
    gameState = 'waiting';
    currentMultiplier = 1.0;
    graphPoints = [];
    particles = [];
    
    resetBetStates();
    updateUI();
    
    const multEl = document.getElementById('multiplier');
    if (multEl) {
        multEl.textContent = '1.00x';
        multEl.classList.remove('crashed');
    }
    
    document.getElementById('status').textContent = 'WAITING FOR NEXT ROUND...';
    document.getElementById('crashedOverlay').classList.add('hidden');
    
    if (bet1.auto) placeBet(1);
    if (bet2.auto) placeBet(2);

    spawnSimulatedBets();
}

function launchRound() {
    gameState = 'playing';
    document.getElementById('status').textContent = '';
    
    startEngineRumble();
    startRisingTone();
    
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(gameTick);
}

function gameTick() {
    if (gameState !== 'playing') return;

    const now = Date.now() + serverTimeOffset;
    const elapsed = now - serverRoundStartTime;
    const flightElapsed = Math.max(0, elapsed - COUNTDOWN_DURATION);
    
    const mt = flightElapsed <= 0 ? 1.0 : Math.pow(1.08, flightElapsed / 1000);
    
    if (mt >= serverCrashPoint) {
        currentMultiplier = serverCrashPoint;
        crash();
        return;
    }

    currentMultiplier = mt;
    updateMultiplierUI();
    updateGraph();
    
    // Auto cash out logic
    checkAutoCashOut();

    animationFrameId = requestAnimationFrame(gameTick);
}

function crash() {
    gameState = 'crashed';
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    stopEngineRumble();
    stopRisingTone();
    playSoundExplosion();
    haptic('crash');

    document.getElementById('multiplier').classList.add('crashed');
    document.getElementById('crashedOverlay').classList.remove('hidden');
    document.getElementById('crashedText').textContent = `FLEW AWAY @ ${currentMultiplier.toFixed(2)}x`;
    
    // Finalize bets
    finalizeCrashedBets();
    
    addToHistory(currentMultiplier);
}

// ── SECURE TRANSACTIONS (RPC) ──────────────────────────────────────────────

async function placeBet(num) {
    const bet = num === 1 ? bet1 : bet2;
    if (bet.active || gameState !== 'waiting') return;

    const amount = parseFloat(document.getElementById(`betAmount${num}`).value);
    if (isNaN(amount) || amount < 50) {
        showToast("Minimum bet is KES 50", "error");
        return;
    }

    try {
        const { data, error } = await supabase.rpc('place_bet', {
            p_amount: amount,
            p_round_id: serverRoundId,
            p_use_free_bet: false
        });

        if (error || data.error) {
            showToast(error?.message || data.error, "error");
            return;
        }

        bet.id = data.bet_id;
        bet.amount = amount;
        bet.active = true;
        bet.cashed = false;
        
        balance = data.new_balance;
        updateUI();
        playSoundBetPlaced();
        haptic('medium');
    } catch (e) {
        showToast("Failed to place bet", "error");
    }
}

async function cashOutBet(num) {
    const bet = num === 1 ? bet1 : bet2;
    if (!bet.active || bet.cashed || gameState !== 'playing') return;

    try {
        const { data, error } = await supabase.rpc('cash_out', {
            p_bet_id: bet.id,
            p_multiplier: currentMultiplier
        });

        if (error || data.error) {
            showToast(error?.message || data.error, "error");
            return;
        }

        bet.cashed = true;
        bet.winnings = data.winnings;
        
        // Refresh balance
        await refreshBalance();
        
        updateUI();
        playSoundCashOut();
        haptic('success');
        showToast(`✅ Cashed out KES ${data.winnings.toLocaleString()}!`, 'success');
    } catch (e) {
        showToast("Cash out failed", "error");
    }
}

async function refreshBalance() {
    const { data } = await supabase.from('profiles').select('balance').eq('id', currentUser.id).single();
    if (data) balance = parseFloat(data.balance);
}

// ── UI UPDATES ─────────────────────────────────────────────────────────────

function updateUI() {
    document.getElementById('headerBalance').textContent = `KES ${balance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    
    // Sync buttons
    [1, 2].forEach(num => {
        const bet = num === 1 ? bet1 : bet2;
        const placeBtn = document.getElementById(`placeBet${num}Btn`);
        const cashBtn = document.getElementById(`cashBtn${num}`);
        const cashLabel = document.getElementById(`cashLabel${num}`);

        if (bet.active && !bet.cashed && gameState === 'playing') {
            placeBtn.classList.add('hidden');
            cashBtn.classList.remove('hidden');
            cashLabel.textContent = `KES ${(bet.amount * currentMultiplier).toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        } else {
            cashBtn.classList.add('hidden');
            placeBtn.classList.remove('hidden');
            placeBtn.disabled = (gameState === 'playing' || (bet.active && gameState === 'waiting'));
            
            if (bet.active && gameState === 'waiting') {
                placeBtn.innerHTML = `<span>CANCEL</span><span class="sub-text">WAITING...</span>`;
                placeBtn.classList.add('cancel-state');
            } else {
                placeBtn.innerHTML = `<span>BET</span><span class="sub-text">PLACE YOUR BET</span>`;
                placeBtn.classList.remove('cancel-state');
            }
        }
    });
}

function updateMultiplierUI() {
    const el = document.getElementById('multiplier');
    if (!el) return;
    el.textContent = `${currentMultiplier.toFixed(2)}x`;
}

function addToHistory(m) {
    crashHistory.unshift(m);
    if (crashHistory.length > 20) crashHistory.pop();
    renderTicker();
}

function renderTicker() {
    const el = document.getElementById('historyTicker');
    el.innerHTML = crashHistory.map(m => {
        const cls = m < 2 ? 'low' : m < 10 ? 'mid' : 'high';
        return `<div class="hist-pill ${cls}">${m.toFixed(2)}x</div>`;
    }).join('');
}

// ── AUDIO & CANVAS ────────────────────────────────────────────────────────

let audioCtx = null;
let masterGain = null;
let engineGain = null;
let engineOsc = null;

function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.connect(audioCtx.destination);
    } catch (e) {}
}

function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : 1, audioCtx.currentTime, 0.1);
    const btn = document.getElementById('muteBtn');
    btn.innerHTML = `<i data-lucide="${muted ? 'volume-x' : 'volume-2'}"></i>`;
    lucide.createIcons();
}

function playTone(freq, dur, vol = 0.1) {
    if (!audioCtx || muted) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g);
    g.connect(masterGain);
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
}

function playSoundBetPlaced() { playTone(880, 0.1); }
function playSoundCashOut() { playTone(1200, 0.2); playTone(1500, 0.2, 0.05); }
function playSoundExplosion() { playTone(100, 0.5, 0.3); }

function startEngineRumble() {
    if (!audioCtx || muted) return;
    engineOsc = audioCtx.createOscillator();
    engineGain = audioCtx.createGain();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.setValueAtTime(50, audioCtx.currentTime);
    engineGain.gain.setValueAtTime(0, audioCtx.currentTime);
    engineGain.gain.linearRampToValueAtTime(0.05, audioCtx.currentTime + 0.5);
    engineOsc.connect(engineGain);
    engineGain.connect(masterGain);
    engineOsc.start();
}

function stopEngineRumble() {
    if (engineGain) engineGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
    setTimeout(() => { if (engineOsc) engineOsc.stop(); }, 200);
}

function startRisingTone() {} // TBD
function stopRisingTone() {}

// ── UTILS ──────────────────────────────────────────────────────────────────

function bindEvents() {
    document.getElementById('tabAll').addEventListener('click', () => switchTab('all'));
    document.getElementById('tabPrevious').addEventListener('click', () => switchTab('previous'));
    document.getElementById('tabTop').addEventListener('click', () => switchTab('top'));
    document.getElementById('muteBtn').addEventListener('click', toggleMute);
    document.getElementById('profileBtn').addEventListener('click', openProfile);
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
    // Filter logic...
}

function showToast(msg, type = 'info') {
    // Premium toast implementation
    console.log(`[${type}] ${msg}`);
}

function haptic(type) {
    if (navigator.vibrate) {
        const patterns = { light: 10, medium: 30, crash: [50, 50, 50], success: [10, 20, 10] };
        navigator.vibrate(patterns[type] || 10);
    }
}

function resetBetStates() {
    [bet1, bet2].forEach(b => {
        if (b.cashed || gameState === 'crashed') {
            b.id = null;
            b.active = false;
        }
    });
}

function finalizeCrashedBets() {
    [bet1, bet2].forEach(b => {
        if (b.active && !b.cashed) {
            b.active = false;
            b.id = null;
        }
    });
}

// ── MOCK SIMULATION ────────────────────────────────────────────────────────

function spawnSimulatedBets() {
    allBets = Array.from({length: 15}, () => ({
        name: `User${Math.floor(Math.random()*9000)}`,
        amount: Math.floor(Math.random()*1000 + 100),
        mult: null,
        win: null
    }));
    renderAllBets();
}

function renderAllBets() {
    const el = document.getElementById('allBetsList');
    if (!el) return;
    el.innerHTML = allBets.map(b => `
        <div class="bet-row">
            <div class="player-info">
                <div class="player-avatar">${b.name.charAt(0)}</div>
                <span>${b.name}</span>
            </div>
            <span>${b.amount}</span>
            <span class="bet-multiplier playing">—</span>
            <span>—</span>
        </div>
    `).join('');
}

// ── CANVAS STUBS ───────────────────────────────────────────────────────────
function initCanvas() {}
function updateGraph() {}

// Expose helpers to window for HTML onclicks
window.adjustBet = (num, delta) => {
    const input = document.getElementById(`betAmount${num}`);
    input.value = Math.max(50, parseInt(input.value) + delta);
};
window.setBet = (num, val) => {
    document.getElementById(`betAmount${num}`).value = val;
};
window.placeBet = placeBet;
window.cashOutBet = cashOutBet;
window.openProfile = async () => {
    const backdrop = document.getElementById('modalBackdrop');
    const windowEl = document.getElementById('modalWindow');
    
    backdrop.classList.add('show');
    
    // Default silhouette icon fallback for privacy
    const avatarHtml = currentUser.avatar_url 
        ? `<img src="${currentUser.avatar_url}" alt="Avatar" class="player-avatar" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; margin: 0 auto 20px; border: 2px solid var(--bg-accent);">`
        : `<div class="player-avatar" style="width: 80px; height: 80px; font-size: 2rem; margin: 0 auto 20px; background: linear-gradient(135deg, var(--bg-accent), #8b5cf6); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff;">👤</div>`;
        
    windowEl.innerHTML = `
        <div style="text-align: center;">
            ${avatarHtml}
            <h2 style="margin-bottom: 4px;">${currentUser.phone}</h2>
            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">Player Account</p>
            
            <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 16px; text-align: left; margin-bottom: 24px; font-size: 0.9rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: var(--text-secondary);">Role:</span>
                    <span style="color: var(--bg-accent); font-weight: 700; text-transform: uppercase;">${currentUser.role || 'User'}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: var(--text-secondary);">Joined:</span>
                    <span style="color: var(--text-primary);">${new Date(currentUser.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
                <button class="auth-btn" style="background: var(--bg-surface); color: var(--text-primary);" onclick="openDeposit()">DEPOSIT</button>
                <button class="auth-btn" style="background: var(--bg-surface); color: var(--text-primary);" onclick="openWithdraw()">WITHDRAW</button>
            </div>

            <button class="auth-btn" style="background: #333; margin-top: 10px;" onclick="logout()">LOGOUT</button>
            <button class="auth-btn" style="background: transparent; color: var(--text-muted);" onclick="closeModal()">CLOSE</button>
        </div>
    `;
};

window.closeModal = () => {
    document.getElementById('modalBackdrop').classList.remove('show');
};

window.openDeposit = () => {
    const window = document.getElementById('modalWindow');
    window.innerHTML = `
        <h2 style="margin-bottom: 24px;">Deposit Funds</h2>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 16px;">Minimum deposit: KES 100 via M-Pesa STK Push.</p>
        
        <div class="form-group">
            <label>Amount (KES)</label>
            <input type="number" id="depAmount" class="amount-input" style="width:100%; border: 1px solid var(--glass-border);" value="500">
        </div>

        <button class="auth-btn" id="depBtn" onclick="processDeposit()">SEND STK PUSH</button>
        <button class="auth-btn" style="background: transparent; color: var(--text-muted);" onclick="closeModal()">CANCEL</button>
    `;
};

async function processDeposit() {
    const amt = parseFloat(document.getElementById('depAmount').value);
    const btn = document.getElementById('depBtn');
    btn.disabled = true;
    btn.textContent = "SENDING...";
    
    try {
        const res = await fetch('/api/deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: currentUser.phone, amount: amt, userId: currentUser.id })
        });
        const data = await res.json();
        if (data.success) {
            alert("STK Push sent to your phone!");
            closeModal();
        } else {
            alert(data.message || "Failed to send STK Push");
        }
    } catch (e) {
        alert("Payment service error");
    } finally {
        btn.disabled = false;
        btn.textContent = "SEND STK PUSH";
    }
}

window.logout = async () => {
    await supabase.auth.signOut();
    window.location.replace('/auth');
};

window.openWithdraw = () => {
    const window = document.getElementById('modalWindow');
    window.innerHTML = `
        <h2 style="margin-bottom: 24px;">Withdraw Funds</h2>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 16px;">Instant withdrawals to M-Pesa. Max KES 100,000.</p>
        
        <div class="form-group">
            <label>Amount (KES)</label>
            <input type="number" id="wdAmount" class="amount-input" style="width:100%; border: 1px solid var(--glass-border);" value="500">
        </div>

        <button class="auth-btn" id="wdBtn" onclick="processWithdraw()">CONFIRM WITHDRAWAL</button>
        <button class="auth- sz-btn" style="background: transparent; color: var(--text-muted);" onclick="closeModal()">CANCEL</button>
    `;
};

async function processWithdraw() {
    const amt = parseFloat(document.getElementById('wdAmount').value);
    if (amt > balance) { alert("Insufficient balance"); return; }
    
    const btn = document.getElementById('wdBtn');
    btn.disabled = true;
    
    try {
        const { error } = await supabase.from('withdrawals').insert({
            user_id: currentUser.id,
            amount: amt,
            status: 'pending'
        });
        if (error) throw error;
        
        alert("Withdrawal request submitted for approval.");
        closeModal();
    } catch (e) {
        alert("Action failed. Try again.");
    } finally {
        btn.disabled = false;
    }
}