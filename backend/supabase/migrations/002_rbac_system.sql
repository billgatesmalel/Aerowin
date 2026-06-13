-- ══════════════════════════════════════════════
-- SCHEMA: ENTERPRISE RBAC & AUDIT SYSTEM
-- ══════════════════════════════════════════════

-- 1. Roles & Permissions Table
CREATE TABLE IF NOT EXISTS public.roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES public.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

-- 2. Audit Logging
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    actor_id UUID REFERENCES public.profiles(id),
    action TEXT NOT NULL,
    target_id TEXT,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Seed Basic Roles
INSERT INTO public.roles (name, description) VALUES
('Super Admin', 'Full system access'),
('Admin', 'Manage users and financial operations'),
('Moderator', 'Manage chat and announcements'),
('User', 'Standard player account')
ON CONFLICT (name) DO NOTHING;

-- 4. Seed Essential Permissions
INSERT INTO public.permissions (name) VALUES
('all_access'),
('manage_admins'),
('manage_users'),
('manage_settings'),
('manage_finances'),
('view_audit_logs'),
('manage_maintenance'),
('force_logout'),
('manage_signals')
ON CONFLICT (name) DO NOTHING;

-- 5. Map Permissions to Super Admin
DO $$
DECLARE
    super_admin_id UUID;
BEGIN
    SELECT id INTO super_admin_id FROM public.roles WHERE name = 'Super Admin';
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT super_admin_id, id FROM public.permissions
    ON CONFLICT DO NOTHING;
END $$;

-- 6. Helper Function: Check Permission
CREATE OR REPLACE FUNCTION public.has_permission(p_user_id UUID, p_permission TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON ur.role_id = rp.role_id
        JOIN public.permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = p_user_id AND (p.name = p_permission OR p.name = 'all_access')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Secure Audit Log Function
CREATE OR REPLACE FUNCTION public.log_action(p_action TEXT, p_target_id TEXT, p_details JSONB)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.audit_logs (actor_id, action, target_id, details)
    VALUES (auth.uid(), p_action, p_target_id, p_details);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Enable RLS
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only Super Admins can see these
CREATE POLICY "Super Admin access" ON public.roles FOR SELECT USING (public.has_permission(auth.uid(), 'all_access'));
CREATE POLICY "Audit log access" ON public.audit_logs FOR SELECT USING (public.has_permission(auth.uid(), 'view_audit_logs'));
