-- ══════════════════════════════════════════════
-- MIGRATION 005: Auto Super Admin for First User
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_first_user_as_super_admin()
RETURNS TRIGGER AS $$
DECLARE
    user_count INT;
    super_admin_role_id UUID;
BEGIN
    -- Count profiles in public.profiles (exclusive of the current insert)
    SELECT COUNT(*) INTO user_count FROM public.profiles;
    
    -- If this is the first profile
    IF user_count = 0 THEN
        NEW.is_admin := TRUE;
        NEW.role := 'Super Admin';
        
        -- Get the Super Admin role ID
        SELECT id INTO super_admin_role_id FROM public.roles WHERE name = 'Super Admin' LIMIT 1;
        
        -- Associate user with Super Admin role in user_roles
        IF super_admin_role_id IS NOT NULL THEN
            INSERT INTO public.user_roles (user_id, role_id)
            VALUES (NEW.id, super_admin_role_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Safely attach trigger
DROP TRIGGER IF EXISTS make_first_user_super_admin ON public.profiles;
CREATE TRIGGER make_first_user_super_admin
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_first_user_as_super_admin();
