/**
 * backend/api/admin/system.js
 * 
 * Super Admin System Management
 */

import { createClient } from '@supabase/supabase-js';
import { verifyPermission } from '../../lib/rbac.js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    const access = await verifyPermission(req, 'all_access');
    if (!access.success) return res.status(access.status).json({ error: access.error });

    const { action } = req.query;

    try {
        switch (action) {
            case 'stats': {
                const { count: users } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
                const { data: rev } = await supabase.rpc('calculate_total_ggr'); // Assume this exists or created
                
                return res.status(200).json({ 
                    users, 
                    ggr: rev || 0,
                    status: 'STABLE'
                });
            }

            case 'audit_logs': {
                const { data, error } = await supabase
                    .from('audit_logs')
                    .select('*, profiles(phone)')
                    .order('created_at', { ascending: false })
                    .limit(50);
                
                if (error) throw error;
                return res.status(200).json(data);
            }

            case 'users': {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('*, user_roles(roles(name))')
                    .order('created_at', { ascending: false });
                
                if (error) throw error;
                return res.status(200).json(data);
            }

            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
