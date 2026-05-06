# Server-Authoritative Architecture - Implementation Guide

## Overview

This document describes the transition from Client-Authoritative to Server-Authoritative architecture for the Aerowin Aviator game.

## Architecture Changes

### Before (Client-Authoritative)
- Client generated `crashPoint` locally using deterministic seed
- Client tracked `roundStartTime` locally
- Game loop ran entirely on client
- Vulnerable to manipulation (clients could modify game state)

### After (Server-Authoritative)
- **Global Server Loop**: Supabase Edge Function (`game-state`) maintains authoritative game state
- **Synchronized Time Check**: Frontend queries server on load for current game state
- **Frame Replay**: Frontend calculates current multiplier from server-provided `roundStartTime`
- **Deterministic & Verifiable**: All clients see identical game progression

## Components

### 1. Server-Side: Game State Manager
**File**: `supabase/functions/game-state/index.ts`

**Responsibilities**:
- Maintains global game state in memory (persists across requests)
- Tracks `roundStartTime`, `crashPoint`, `gameStatus`
- Automatically advances game through phases: `waiting` → `playing` → `crashed`
- Generates deterministic crash points based on server time windows
- Responds to GET requests with current state

**State Machine**:
```
[waiting] --5s--> [playing] --10s--> [crashed] --3.5s--> [waiting]
```

**Key Functions**:
- `generateCrashPoint(windowSeed)`: Deterministic crash multiplier (1.05x - 65x)
- `updateGameState()`: Server-side state machine advancement
- `fetchServerGameState()`: Client synchronization endpoint

**API Endpoints**:
- `GET /functions/v1/game-state` - Returns current game state
  ```json
  {
    "roundId": 123,
    "roundStartTime": 1715040000000,
    "crashPoint": 6.42,
    "gameStatus": "playing",
    "serverTime": 1715040005123,
    "currentMultiplier": 2.34,
    "timeElapsed": 5123
  }
  ```

### 2. Client-Side: Synchronization Layer
**File**: `src/main.js`

**New State Variables**:
```javascript
// Server-provided state (authoritative)
let serverRoundId = 0;
let serverRoundStartTime = 0;
let serverCrashPoint = 0;
let serverGameStatus = 'waiting';
let serverTimeOffset = 0;  // Client clock skew
```

**Key Functions**:

#### `fetchServerGameState()`
Fetches current state from server and calculates clock offset:
```javascript
serverTimeOffset = data.serverTime - Date.now();
```

#### `fallbackCalculateGameState()`
Local deterministic generation when server unavailable (same algorithm as server)

#### `calculateCurrentMultiplierFromServer()`
Frame replay: calculates multiplier from server startTime:
```javascript
const serverNow = Date.now() + serverTimeOffset;
const elapsed = serverNow - serverRoundStartTime;
const flightElapsed = Math.max(0, elapsed - COUNTDOWN_DURATION);
const mt = Math.pow(1.08, flightElapsed / 1000);
```

#### `startNewRound()`
Synchronizes with server before starting countdown:
1. Fetches server state
2. Calculates time until server takeoff
3. Shows countdown synced to server time
4. Launches when server enters `playing` state

#### `gameTick()`
Uses server-authoritative time for all calculations:
```javascript
const serverNow = Date.now() + serverTimeOffset;
const elapsed = serverNow - serverRoundStartTime;
```

### 3. Boot Sequence
**File**: `src/main.js` (window load event)

```javascript
showGameLoader(async () => {
    await fetchServerGameState();  // Sync with server first
    startNewRound();               // Then start local game
});
```

## Benefits

1. **Anti-Cheat**: Clients cannot manipulate crash points
2. **Consistency**: All players see identical game state
3. **Fairness**: No client-side prediction or manipulation
4. **Verifiability**: Server state can be audited
5. **Resilience**: Fallback to local generation if server unavailable

## Deployment

### Deploy Edge Function
```bash
supabase functions deploy game-state
```

### Environment Variables
Set in Supabase Dashboard:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for admin functions)
- `ADMIN_PHONES` (comma-separated admin phone numbers)

## Testing

### Manual Testing
1. Open game in two different browsers/devices
2. Verify both show identical multiplier progression
3. Verify crash points match across sessions
4. Test offline mode (should use fallback)

### Automated Testing
```bash
# Check syntax
node --check src/main.js

# Verify deterministic generation
node -e "..."
```

## Monitoring

### Client Console
```
[Server Sync] Round 123 Status: playing Crash: 6.42 Elapsed: 5123ms
```

### Server Logs
Edge Function logs available in Supabase Dashboard

## Future Enhancements

1. **Real-time Subscriptions**: Use Supabase Realtime for instant state updates
2. **Historical Replay**: Store all rounds in database for replay
3. **Provably Fair**: Add cryptographic signatures to crash points
4. **Regional Servers**: Deploy edge functions in multiple regions
5. **State Persistence**: Store game state in database for recovery

## Troubleshooting

### Issue: Clock Skew
**Symptom**: Client multiplier lags behind server
**Solution**: `serverTimeOffset` automatically compensates for client clock drift

### Issue: Server Unavailable
**Symptom**: Fallback to local generation
**Solution**: Check network connectivity, verify Edge Function deployment

### Issue: Desync Between Clients
**Symptom**: Different multipliers shown
**Solution**: Verify both clients successfully fetched server state (check console logs)

## Security Considerations

1. **No Client Trust**: Server never trusts client-provided state
2. **Rate Limiting**: Consider adding rate limits to game-state endpoint
3. **CORS**: Configured to allow all origins (adjust for production)
4. **Admin Access**: Protected by JWT verification and admin phone check

## Performance

- **Latency**: Single HTTP request on load (~50-200ms)
- **Bandwidth**: Minimal (~1KB per state fetch)
- **CPU**: Negligible (simple deterministic calculations)
- **Memory**: ~1KB per Edge Function instance

## Migration Notes

### Breaking Changes
- Removed `calculateSyncedCrashPoint()` Supabase function call
- Replaced with `fetchServerGameState()` to custom Edge Function
- All time calculations now use `serverTimeOffset`

### Compatibility
- Existing database schema unchanged
- Client-side code fully backward compatible (with fallback)
- No changes required to auth or betting systems

## References

- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Deterministic Random Generation](https://en.wikipedia.org/wiki/Pseudorandom_number_generator)
- [Client-Server Synchronization](https://gafferongames.com/post/snapshot_interpolation/)
