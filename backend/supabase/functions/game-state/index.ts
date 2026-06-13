/**
 * supabase/functions/game-state/index.ts
 *
 * Persisted Server-Authoritative Game State
 *
 * This function handles:
 * 1. Advancing the game phase (Waiting -> Playing -> Crashed)
 * 2. Persisting state in 'active_game_state' table
 * 3. Generating deterministic crash points
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const ROUND_CONFIG = {
  WAITING_MS: 5000,
  MAX_FLIGHT_MS: 15000,
  POST_CRASH_MS: 3000
}

function generateCrashPoint(seed: number): number {
  const x = Math.sin(seed) * 10000
  const r = x - Math.floor(x)
  let cp = 1.05
  if (r < 0.1) cp = 1.05
  else if (r < 0.5) cp = 1.2 + r * 3
  else if (r < 0.8) cp = 5.0 + r * 15
  else cp = 20.0 + r * 100
  return parseFloat(cp.toFixed(2))
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    // 1. Fetch current state from DB
    const { data: state, error: fetchErr } = await supabase
      .from('active_game_state')
      .select('*')
      .eq('id', 1)
      .single()

    if (fetchErr) throw fetchErr

    const now = Date.now()
    const startTime = new Date(state.start_time).getTime()
    const elapsed = now - startTime

    let { status, round_id, crash_point } = state
    let needsUpdate = false

    // 2. Logic for phase transitions
    if (status === 'waiting') {
      if (elapsed >= ROUND_CONFIG.WAITING_MS) {
        status = 'playing'
        needsUpdate = true
      }
    } 
    else if (status === 'playing') {
      const currentMultiplier = Math.pow(1.08, (elapsed - ROUND_CONFIG.WAITING_MS) / 1000)
      if (currentMultiplier >= crash_point || elapsed >= ROUND_CONFIG.WAITING_MS + ROUND_CONFIG.MAX_FLIGHT_MS) {
        status = 'crashed'
        needsUpdate = true
      }
    } 
    else if (status === 'crashed') {
      if (elapsed >= ROUND_CONFIG.WAITING_MS + ROUND_CONFIG.POST_CRASH_MS + 2000) { // arbitrary flight buffer
        status = 'waiting'
        round_id = parseInt(round_id) + 1
        crash_point = generateCrashPoint(now)
        needsUpdate = true
      }
    }

    // 3. Update DB if state changed
    if (needsUpdate) {
      const { error: updErr } = await supabase
        .from('active_game_state')
        .update({
          status,
          round_id,
          crash_point,
          start_time: needsUpdate && status === 'waiting' ? new Date().toISOString() : state.start_time,
          server_time: new Date().toISOString()
        })
        .eq('id', 1)
      
      if (updErr) console.error("Update error", updErr)
      
      // Also record in history if crashed
      if (status === 'crashed') {
          await supabase.from('game_history').insert({ multiplier: crash_point })
      }
    }

    // Return current (possibly updated) state
    return new Response(JSON.stringify({
      ...state,
      status,round_id,crash_point,
      serverTime: now,
      elapsedMs: elapsed
    }), { headers: CORS_HEADERS })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS })
  }
})
