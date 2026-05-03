/**
 * supabase.js
 *
 * Reads credentials from Vite/Vercel environment variables so no secrets
 * are hardcoded in source. Set these in your Vercel project settings:
 *
 *   VITE_SUPABASE_URL   → your project URL  (e.g. https://xxxx.supabase.co)
 *   VITE_SUPABASE_ANON  → your anon/public key
 *
 * For local development create a .env file (gitignored):
 *   VITE_SUPABASE_URL=https://xxxx.supabase.co
 *   VITE_SUPABASE_ANON=eyJ...
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL ?? '__SUPABASE_URL__';
const SUPABASE_ANON = import.meta.env?.VITE_SUPABASE_ANON ?? '__SUPABASE_ANON__';

if (SUPABASE_URL === '__SUPABASE_URL__' || SUPABASE_ANON === '__SUPABASE_ANON__') {
    console.warn(
        '[Aerowin] Supabase credentials not set. ' +
        'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON to your environment.'
    );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);