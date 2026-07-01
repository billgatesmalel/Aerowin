/**
 * src/admin.js
 * 
 * Admin Control Logic
 * Interfaces with the secure admin-action Edge Function.
 */

import { supabase } from './lib/supabase.js';

let currentUser = null;

// ── INITIALIZATION ─────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.replace('/auth');
        return;
    }

    // Verify Admin Status
    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .single();

    if (!profile?.is_admin) {
        alert("Access Denied: Administrative privileges required.");
        window.location.replace('/');
        return;
    }

    currentUser = session.user;
    fetchDashboardStats();
    fetchPendingWithdrawals();
});

// ── DATA FETCHING ──────────────────────────────────────────────────────────

async function fetchDashboardStats() {
    // Basic stats from DB tables
    const { count: userCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
    const { count: pendingCount } = await supabase.from('withdrawals').select('*', { count: 'exact', head: true }).eq('status', 'pending');

    document.getElementById('activeUsersCount').textContent = userCount || 0;
    document.getElementById('pendingPayoutsCount').textContent = pendingCount || 0;
}

async function fetchPendingWithdrawals() {
    const { data, error } = await supabase
        .from('withdrawals')
        .select('*, profiles(username, phone)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Fetch error", error);
        return;
    }

    const listEl = document.getElementById('pendingWithdrawalList');
    listEl.innerHTML = data.map(w => `
        <tr>
            <td>${new Date(w.created_at).toLocaleDateString()}</td>
            <td>${w.profiles ? (w.profiles.username ? `@${w.profiles.username}` : w.profiles.phone) : 'Unknown'}</td>
            <td>KES ${parseFloat(w.amount).toLocaleString()}</td>
            <td><span class="status-pill status-pending">PENDING</span></td>
            <td>
                <button class="auth-btn" style="width: auto; padding: 6px 12px; background: var(--accent-green);" onclick="processAction('${w.id}', 'approve_withdrawal')">Approve</button>
                <button class="auth-btn" style="width: auto; padding: 6px 12px; margin-left: 8px;" onclick="processAction('${w.id}', 'reject_withdrawal')">Reject</button>
            </td>
        </tr>
    `).join('');
}

// ── ADMIN ACTIONS ───────────────────────────────────────────────────────────

window.processAction = async (id, action) => {
    const reason = action === 'reject_withdrawal' ? prompt("Enter rejection reason:") : null;
    if (action === 'reject_withdrawal' && reason === null) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/functions/v1/admin-action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ action, withdrawal_id: id, reason })
        });

        const result = await res.json();
        if (result.ok) {
            alert("Action completed successfully.");
            fetchDashboardStats();
            fetchPendingWithdrawals();
        } else {
            alert(`Error: ${result.error}`);
        }
    } catch (e) {
        alert("Network error occurred.");
    }
}
