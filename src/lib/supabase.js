import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Replace with your actual project URL and Anon Key
const supabaseUrl = 'https://hnqrmmmctmfdothyblsp.supabase.co'
const supabaseKey = 'sb_publishable_2Ut1nKne4Gs64kkMkbZLEQ_czYJKMOf'

export const supabase = createClient(supabaseUrl, supabaseKey)
