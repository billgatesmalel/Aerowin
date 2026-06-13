/**
 * supabase/functions/admin-action/index.ts
 *
 * Fix #6: All privileged admin writes go through this Edge Function.
 * It verifies the caller is an authenticated admin (checked server-side
 * against the profiles table) before performing any operation.
 *
 * Deploy:  supabase functions deploy admin-action
 *
 * Supported actions (POST body JSON):
 *   { action: "adjust_balance", target_user_id: "uuid", delta: number }
 *   { action: "approve_withdrawal", withdrawal_id: number }
 *   { action: "reject_withdrawal",  withdrawal_id: number }
 *
 * Required Supabase secrets (set via `supabase secrets set`):
 *   ADMIN_PHONES  — comma-separated list of admin phone numbers e.g. "+254712345678,+254798765432"
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {

    // ── Preflight ────────────────────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS_HEADERS });
    }

    try {
        // ── Auth header required ─────────────────────────────────────────────
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json({ error: 'Unauthorized' }, 401);

        // ── Build a Supabase client scoped to the calling user's JWT ─────────
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_ANON_KEY')!,
            { global: { headers: { Authorization: authHeader } } }
        );

        // ── Verify caller identity ────────────────────────────────────────────
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

        // ── Fetch caller's profile to check admin status ─────────────────────
        const { data: profile, error: profileErr } = await supabase
            .from('profiles')
            .select('phone, is_admin')
            .eq('id', user.id)
            .single();

        if (profileErr || !profile) return json({ error: 'Profile not found' }, 403);

        // ── Admin check (server-side, not bypassable from client) ─────────────
        const adminPhones = (Deno.env.get('ADMIN_PHONES') ?? '').split(',').map(p => p.trim());
        const isAdmin = profile.is_admin === true || adminPhones.includes(profile.phone);
        if (!isAdmin) return json({ error: 'Forbidden: admin access required' }, 403);

        // ── Use service-role client for privileged writes ─────────────────────
        const admin = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        const body = await req.json();
        const { action } = body;

        // ── Dispatch action ───────────────────────────────────────────────────
        switch (action) {

            case 'adjust_balance': {
                const { target_user_id, delta } = body;
                if (!target_user_id || typeof delta !== 'number') {
                    return json({ error: 'Missing target_user_id or delta' }, 400);
                }
                const { error } = await admin.rpc('increment_balance', {
                    user_id: target_user_id,
                    amount: delta,
                });
                if (error) return json({ error: error.message }, 500);
                return json({ ok: true });
            }

            case 'approve_withdrawal': {
                const { withdrawal_id } = body;
                if (!withdrawal_id) return json({ error: 'Missing withdrawal_id' }, 400);
                const { error } = await admin
                    .from('withdrawals')
                    .update({ status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
                    .eq('id', withdrawal_id);
                if (error) return json({ error: error.message }, 500);
                return json({ ok: true });
            }

            case 'reject_withdrawal': {
                const { withdrawal_id, reason } = body;
                if (!withdrawal_id) return json({ error: 'Missing withdrawal_id' }, 400);
                const { error } = await admin
                    .from('withdrawals')
                    .update({ status: 'rejected', rejection_reason: reason ?? '', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
                    .eq('id', withdrawal_id);
                if (error) return json({ error: error.message }, 500);
                return json({ ok: true });
            }

            default:
                return json({ error: `Unknown action: ${action}` }, 400);
        }

    } catch (err) {
        console.error('admin-action error:', err);
        return json({ error: 'Internal server error' }, 500);
    }
});

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}