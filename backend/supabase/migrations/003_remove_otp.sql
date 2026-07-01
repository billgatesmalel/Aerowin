-- ══════════════════════════════════════════════
-- MIGRATION 003: Remove OTP Authentication
-- ══════════════════════════════════════════════
-- OTP verification has been completely removed.
-- Users authenticate via phone number + password only.
-- Supabase Auth handles password hashing (bcrypt).
-- ══════════════════════════════════════════════

-- Drop the OTP table safely (cascade removes its RLS policies too)
DROP TABLE IF EXISTS public.otps CASCADE;

-- ── Ensure email confirmation is disabled  ─────────────────────────────────
-- ACTION REQUIRED in Supabase Dashboard:
--   Authentication → Settings → "Confirm email" → OFF
--
-- This allows signUp() to return a session immediately so users
-- can be auto-logged-in right after registration without any
-- email/OTP verification step.
--
-- ── Security remains strong via: ──────────────────────────────────────────
--   1. Supabase bcrypt password hashing (built-in)
--   2. Supabase Auth rate limiting (built-in, server-side)
--   3. Client-side lockout after 5 failed attempts (auth.js)
--   4. Row Level Security on all tables
--   5. Secure RPC functions with SECURITY DEFINER
--   6. Profile phone uniqueness constraint
--   7. Generic auth error messages (no phone enumeration)
