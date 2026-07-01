import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://hnqrmmmctmfdothyblsp.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhucXJtbW1jdG1mZG90aHlibHNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MzU3MTAsImV4cCI6MjA5MzIxMTcxMH0.JpOLXE3rpk9NLsgEKMS2l52jD_MbnWuOGDo0enJZdmM'
export const supabase = createClient(supabaseUrl, supabaseAnonKey)