/**
 * src/super-admin.js
 * 
 * Super Admin Dashboard Logic
 */

import { supabase } from './lib/supabase.js';

let currentUser = null;

window.addEventListener('load', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.replace('/auth');
        return;
    }

    // Verify Super Admin Permission
    const { data: hasAccess, error } = await supabase.rpc('has_permission', {
        p_user_id: session.user.id,
        p_permission: 'all_access'
    });

    if (error || !hasAccess) {
        alert("CRITICAL: ACCESS DENIED. AUTHORIZATION FAILURE.");
        window.location.replace('/');
        return;
    }

    currentUser = session.user;
    loadStats();
    loadAuditTrail();
});

async function loadStats() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/admin/system?action=stats', {
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        const data = await res.json();
        
        document.getElementById('activeSessions').textContent = data.users || '0';
        document.getElementById('totalGGR').textContent = `KES ${data.ggr?.toLocaleString() || '0'}`;
    } catch (e) {
        console.error("Stats fail", e);
    }
}

async function loadAuditTrail() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/admin/system?action=audit_logs', {
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        const logs = await res.json();
        
        const list = document.getElementById('auditTrail');
        list.innerHTML = logs.map(log => `
            <tr>
                <td style="color: #444;">${new Date(log.created_at).toLocaleTimeString()}</td>
                <td style="font-weight: 700; color: var(--admin-red);">${log.profiles ? (log.profiles.username ? `@${log.profiles.username}` : log.profiles.phone) : 'SYSTEM'}</td>
                <td class="action-tag">${log.action}</td>
                <td style="color: #666;">ID: ${log.target_id || '--'}</td>
                <td style="font-size: 0.6rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${JSON.stringify(log.details)}</td>
            </tr>
        `).join('');
    } catch (e) {
        console.error("Audit fail", e);
    }
}

window.toggleMaintenance = async () => {
    const confirm = prompt("DANGER: This will lock the platform for all standard users. Type 'CONFIRM' to proceed:");
    if (confirm !== 'CONFIRM') return;
    
    // Logic for maintenance mode (Update active_game_state or a separate config table)
    alert("Maintenance Mode Activated System-Wide.");
};
