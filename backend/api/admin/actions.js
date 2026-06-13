/**
 * backend/api/admin/actions.js
 * 
 * Privileged Admin Actions (Ban, Delete, Role Change)
 */

import { createClient } from '@supabase/supabase-js';
import { verifyPermission, logAdminAction } from '../../lib/rbac.js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const access = await verifyPermission(req, 'manage_users');
    if (!access.success) return res.status(access.status).json({ error: access.error });

    const { action, targetUserId, roleName } = req.body;

    try {
        switch (action) {
            case 'freeze_user': {
                const { error } = await supabase
                    .from('profiles')
                    .update({ is_frozen: true })
                    .eq('id', targetUserId);
                
                if (error) throw error;
                await logAdminAction(access.user.id, 'FREEZE_USER', targetUserId, {});
                return res.status(200).json({ success: true });
            }

            case 'unfreeze_user': {
                const { error } = await supabase
                    .from('profiles')
                    .update({ is_frozen: false })
                    .eq('id', targetUserId);
                
                if (error) throw error;
                await logAdminAction(access.user.id, 'UNFREEZE_USER', targetUserId, {});
                return res.status(200).json({ success: true });
            }

            case 'assign_role': {
                // Security check: Only Super Admins can promote to Admin or Super Admin
                if (['Admin', 'Super Admin'].includes(roleName)) {
                    const superCheck = await verifyPermission(req, 'manage_admins');
                    if (!superCheck.success) return res.status(403).json({ error: 'Permission denied: Super Admin required' });
                }

                const { data: role } = await supabase.from('roles').select('id').eq('name', roleName).single();
                if (!role) throw new Error("Role not found");

                // Clear existing roles and assign new one
                await supabase.from('user_roles').delete().eq('user_id', targetUserId);
                const { error } = await supabase.from('user_roles').insert({
                    user_id: targetUserId,
                    role_id: role.id,
                    assigned_by: access.user.id
                });

                if (error) throw error;

                // Sync legacy is_admin flag
                await supabase.from('profiles').update({ is_admin: roleName === 'Admin' || roleName === 'Super Admin' }).eq('id', targetUserId);

                await logAdminAction(access.user.id, 'ASSIGN_ROLE', targetUserId, { role: roleName });
                return res.status(200).json({ success: true });
            }

            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
