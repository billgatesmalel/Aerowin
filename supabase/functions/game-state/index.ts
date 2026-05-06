/**
 * supabase/functions/game-state/index.ts
 *
 * Server-Authoritative Game State Manager
 *
 * This Edge Function maintains the GLOBAL game state:
 * - roundStartTime: When the current round started (server time)
 * - crashPoint: The predetermined crash multiplier for this round
 * - gameStatus: 'waiting' | 'playing' | 'crashed'
 *
 * All clients synchronize to this single source of truth.
 *
 * Deploy: supabase functions deploy game-state
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

// Game configuration
const ROUND_DURATION = 15000 // 15 seconds per round
const FLIGHT_DURATION = 10000 // 10 seconds max flight time

// In-memory state (persists across requests within the same edge function instance)
// This acts as the "global server loop" - all clients sync to this
let globalGameState: {
  roundId: number
  roundStartTime: number // Server timestamp (ms)
  crashPoint: number
  gameStatus: 'waiting' | 'playing' | 'crashed'
  lastUpdate: number
} = {
  roundId: 0,
  roundStartTime: 0,
  crashPoint: 1.05,
  gameStatus: 'waiting',
  lastUpdate: Date.now(),
}

// Initialize the first round
function initializeFirstRound() {
  const now = Date.now()
  const crashPoint = generateCrashPoint(now)
  globalGameState = {
    roundId: 1,
    roundStartTime: now,
    crashPoint,
    gameStatus: 'waiting',
    lastUpdate: now,
  }
}

// Deterministic crash point generation based on server time window
function generateCrashPoint(windowSeed: number): number {
  const currentWindowStart = Math.floor(windowSeed / ROUND_DURATION)
  const x = Math.sin(currentWindowStart) * 10000
  const r = x - Math.floor(x)

  let crashPoint = 1.05
  if (r < 0.1) crashPoint = 1.05
  else if (r < 0.5) crashPoint = 1.2 + r * 2
  else if (r < 0.8) crashPoint = 3.0 + r * 8
  else crashPoint = 15.0 + r * 50

  return parseFloat(crashPoint.toFixed(2))
}

// Server-side game loop - advances state based on elapsed time
function updateGameState() {
  const now = Date.now()
  const elapsed = now - globalGameState.roundStartTime

  if (globalGameState.gameStatus === 'waiting') {
    // Check if we should transition to playing
    if (elapsed >= 5000) { // 5 second countdown
      globalGameState.gameStatus = 'playing'
      globalGameState.lastUpdate = now
    }
  } else if (globalGameState.gameStatus === 'playing') {
    // Check if round should crash
    if (elapsed >= FLIGHT_DURATION) {
      // Round crashed - start new round after delay
      globalGameState.gameStatus = 'crashed'
      globalGameState.lastUpdate = now
    } else {
      // Still in flight - calculate current multiplier
      const currentMultiplier = Math.pow(1.08, elapsed / 1000)
      if (currentMultiplier >= globalGameState.crashPoint) {
        globalGameState.gameStatus = 'crashed'
        globalGameState.lastUpdate = now
      }
    }
  } else if (globalGameState.gameStatus === 'crashed') {
    // Check if we should start a new round (3.5 second delay)
    if (elapsed >= FLIGHT_DURATION + 3500) {
      const newRoundId = globalGameState.roundId + 1
      const newRoundStartTime = now
      const newCrashPoint = generateCrashPoint(newRoundStartTime)
      globalGameState = {
        roundId: newRoundId,
        roundStartTime: newRoundStartTime,
        crashPoint: newCrashPoint,
        gameStatus: 'waiting',
        lastUpdate: now,
      }
    }
  }
}

// Initialize on first run
if (globalGameState.roundStartTime === 0) {
  initializeFirstRound()
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    // Update game state based on current server time
    updateGameState()

    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    if (req.method === 'GET') {
      // GET: Return current game state for client sync
      const now = Date.now()
      const response = {
        roundId: globalGameState.roundId,
        roundStartTime: globalGameState.roundStartTime,
        crashPoint: globalGameState.crashPoint,
        gameStatus: globalGameState.gameStatus,
        serverTime: now,
        // Calculate current multiplier for convenience
        currentMultiplier: globalGameState.gameStatus === 'playing'
          ? parseFloat(Math.pow(1.08, (now - globalGameState.roundStartTime) / 1000).toFixed(2))
          : globalGameState.gameStatus === 'crashed'
            ? globalGameState.crashPoint
            : 1.0,
        // Time remaining in current phase (ms)
        timeElapsed: now - globalGameState.roundStartTime,
      }

      return new Response(JSON.stringify(response), { headers: CORS_HEADERS })
    }

    if (req.method === 'POST') {
      // POST: Admin action to force state change (for testing/debugging)
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS })
      }

      // Verify admin via Supabase
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''))
      if (userErr || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS })
      }

      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

      if (profileErr || !profile?.is_admin) {
        return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), { status: 403, headers: CORS_HEADERS })
      }

      const body = await req.json()
      const { forceStatus, crashPoint: forcedCrashPoint } = body

      if (forceStatus) {
        globalGameState.gameStatus = forceStatus
        if (forcedCrashPoint) globalGameState.crashPoint = forcedCrashPoint
        globalGameState.lastUpdate = Date.now()
      }

      return new Response(JSON.stringify({ ok: true, state: globalGameState }), { headers: CORS_HEADERS })
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS })
  } catch (err) {
    console.error('game-state error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error', details: err.message }), { status: 500, headers: CORS_HEADERS })
  }
})
