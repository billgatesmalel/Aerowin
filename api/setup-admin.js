/**
 * backend/api/setup-admin.js
 * 
 * One-time setup for the first Super Admin.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, password, phone, secretKey } = req.body;

    // 1. Check if any Super Admin already exists
    const { data: existingRoles } = await supabase
        .from('user_roles')
        .select('user_id, roles(name)')
        .limit(1);

    const hasSuperAdmin = existingRoles?.some(r => r.roles.name === 'Super Admin');

    // Security: Only allow if no super admin exists OR with a Master Key from env
    const masterKey = process.env.MASTER_SETUP_KEY;
    if (hasSuperAdmin && (!secretKey || secretKey !== masterKey)) {
        return res.status(403).json({ error: 'System already initialized. Access denied.' });
    }

    try {
        // 2. Create User in Auth
        const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
            email,
            password,
            phone,
            email_confirm: true,
            phone_confirm: true
        });

        if (authErr) throw authErr;

        // 3. Ensure profile exists (triggered by DB, but we verify)
        const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', authUser.user.id)
            .single();

        // 4. Assign Super Admin Role
        const { data: superRole } = await supabase
            .from('roles')
            .select('id')
            .eq('name', 'Super Admin')
            .single();

        const { error: roleErr } = await supabase
            .from('user_roles')
            .insert({
                user_id: authUser.user.id,
                role_id: superRole.id
            });

        if (roleErr) throw roleErr;

        // 5. Update Profile
        await supabase
            .from('profiles')
            .update({ is_admin: true })
            .eq('id', authUser.user.id);

        // 6. Audit Log
        await supabase.from('audit_logs').insert({
            action: 'INITIAL_SETUP_SUPER_ADMIN',
            target_id: authUser.user.id,
            details: { email }
        });

        return res.status(200).json({ success: true, message: "Super Admin created successfully." });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
