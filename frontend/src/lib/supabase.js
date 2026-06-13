import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://hnqrmmmctmfdothyblsp.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_2Ut1nKne4Gs64kkMkbZLEQ_czYJKMOf'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)