/**
 * backend/lib/rbac.js
 * 
 * Middleware-style utilities for Role-Based Access Control.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Verifies that the user in the request has the required permission.
 */
export async function verifyPermission(req, permission) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return { success: false, status: 401, error: 'Unauthorized' };

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return { success: false, status: 401, error: 'Invalid session' };

    // Check permission via RPC
    const { data: hasAccess, error: rpcErr } = await supabase.rpc('has_permission', {
        p_user_id: user.id,
        p_permission: permission
    });

    if (rpcErr || !hasAccess) {
        // Log unauthorized attempt
        await supabase.from('audit_logs').insert({
            actor_id: user.id,
            action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
            details: { required_permission: permission, path: req.url }
        });
        return { success: false, status: 403, error: 'Forbidden: Insufficient permissions' };
    }

    return { success: true, user };
}

/**
 * Logs an administrative action.
 */
export async function logAdminAction(userId, action, targetId, details) {
    return await supabase.from('audit_logs').insert({
        actor_id: userId,
        action,
        target_id: String(targetId),
        details
    });
}
