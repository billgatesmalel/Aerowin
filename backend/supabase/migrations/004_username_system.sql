-- ══════════════════════════════════════════════
-- MIGRATION 004: Username-Based Accounts & Profiles
-- ══════════════════════════════════════════════

-- 1. Add Columns to public.profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'User';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Populate username for existing profiles
-- Generate a unique valid username 'user_<first_8_chars_of_id>'
UPDATE public.profiles
SET username = 'user_' || substring(id::text from 1 for 8)
WHERE username IS NULL;

-- 3. Populate email for existing profiles using phone
UPDATE public.profiles
SET email = phone || '@metricwin.app'
WHERE email IS NULL;

-- 4. Sync role column with existing RBAC system roles if assigned
UPDATE public.profiles p
SET role = COALESCE(
    (SELECT r.name FROM public.user_roles ur 
     JOIN public.roles r ON ur.role_id = r.id 
     WHERE ur.user_id = p.id LIMIT 1),
    'User'
);

-- 5. Add Constraints for Username
ALTER TABLE public.profiles ALTER COLUMN username SET NOT NULL;
ALTER TABLE public.profiles ADD CONSTRAINT unique_username UNIQUE (username);

-- Case-insensitive unique index to guarantee uniqueness of usernames like Victor/victor/VICTOR
CREATE UNIQUE INDEX IF NOT EXISTS unique_username_lower_idx ON public.profiles (LOWER(username));

-- Regexp validator constraint: 3-20 chars, containing only letters, numbers, underscores, and periods
ALTER TABLE public.profiles ADD CONSTRAINT username_format_check
    CHECK (username ~* '^[a-z0-9_\.]{3,20}$');

-- 6. Trigger to automatically keep the profiles and user_roles in sync
CREATE OR REPLACE FUNCTION public.sync_profile_role()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.profiles
    SET role = (SELECT name FROM public.roles WHERE id = NEW.role_id)
    WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_role_change
AFTER INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role();
