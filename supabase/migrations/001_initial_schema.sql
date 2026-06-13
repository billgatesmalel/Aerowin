-- ══════════════════════════════════════════════
-- SCHEMA: AVIATOR ELITE PLATFORM
-- ══════════════════════════════════════════════

-- 1. PROFILES & AUTH
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    balance DECIMAL(12, 2) DEFAULT 0.00,
    is_admin BOOLEAN DEFAULT FALSE,
    is_frozen BOOLEAN DEFAULT FALSE,
    referral_code TEXT UNIQUE,
    referred_by UUID REFERENCES public.profiles(id),
    free_bet_given BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. GAME HISTORY
CREATE TABLE IF NOT EXISTS public.game_history (
    id BIGSERIAL PRIMARY KEY,
    multiplier DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ACTIVE GAME STATE (Source of truth for all instances)
CREATE TABLE IF NOT EXISTS public.active_game_state (
    id INT PRIMARY KEY DEFAULT 1,
    round_id BIGINT DEFAULT 1,
    start_time TIMESTAMPTZ DEFAULT NOW(),
    crash_point DECIMAL(10, 2) DEFAULT 1.05,
    status TEXT DEFAULT 'waiting', -- 'waiting', 'playing', 'crashed'
    server_time TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT one_row_only CHECK (id = 1)
);
INSERT INTO public.active_game_state (id, round_id, start_time, crash_point, status)
VALUES (1, 1, NOW(), 2.50, 'waiting')
ON CONFLICT DO NOTHING;

-- Enable Realtime
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'active_game_state'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.active_game_state;
    END IF;
END $$;

ALTER TABLE public.active_game_state REPLICA IDENTITY FULL;
CREATE TABLE IF NOT EXISTS public.bets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    round_id BIGINT NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    multiplier_cashed DECIMAL(10, 2),
    winnings DECIMAL(12, 2) DEFAULT 0.00,
    status TEXT DEFAULT 'playing', -- 'playing', 'cashed', 'lost', 'cancelled'
    is_free_bet BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    type TEXT NOT NULL, -- 'deposit', 'withdrawal', 'referral_bonus'
    amount DECIMAL(12, 2) NOT NULL,
    status TEXT DEFAULT 'pending',
    reference TEXT UNIQUE,
    reviewed_by UUID REFERENCES public.profiles(id),
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ══════════════════════════════════════════════

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_game_state ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can read their own profile, only service_role can update balance
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
-- NO UPDATE POLICY FOR USERS ON BALANCE

-- Game History: Everyone can read
DROP POLICY IF EXISTS "Everyone can view game history" ON public.game_history;
CREATE POLICY "Everyone can view game history" ON public.game_history FOR SELECT USING (true);

-- Active Game State: Everyone can read
DROP POLICY IF EXISTS "Everyone can view game state" ON public.active_game_state;
CREATE POLICY "Everyone can view game state" ON public.active_game_state FOR SELECT USING (true);

-- Bets: Users can view their own bets
DROP POLICY IF EXISTS "Users can view own bets" ON public.bets;
CREATE POLICY "Users can view own bets" ON public.bets FOR SELECT USING (auth.uid() = user_id);

-- Transactions: Users can view their own transactions
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (auth.uid() = user_id);

-- ══════════════════════════════════════════════
-- RPC: SECURE GAME LOGIC
-- ══════════════════════════════════════════════

-- Increment Balance (Internal only)
CREATE OR REPLACE FUNCTION public.increment_balance(user_id UUID, amount DECIMAL)
RETURNS VOID AS $$
BEGIN
    UPDATE public.profiles
    SET balance = balance + amount
    WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: SECURE PLACE BET
CREATE OR REPLACE FUNCTION public.place_bet(p_amount DECIMAL, p_round_id BIGINT, p_use_free_bet BOOLEAN)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_balance DECIMAL;
    v_bet_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN json_build_object('error', 'Unauthorized');
    END IF;

    -- Get current balance
    SELECT balance INTO v_balance FROM public.profiles WHERE id = v_user_id;

    IF v_balance < p_amount THEN
        RETURN json_build_object('error', 'Insufficient balance');
    END IF;

    -- Deduct balance
    UPDATE public.profiles SET balance = balance - p_amount WHERE id = v_user_id;

    -- Create bet record
    INSERT INTO public.bets (user_id, round_id, amount, is_free_bet)
    VALUES (v_user_id, p_round_id, p_amount, p_use_free_bet)
    RETURNING id INTO v_bet_id;

    RETURN json_build_object('success', true, 'bet_id', v_bet_id, 'new_balance', v_balance - p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: SECURE CASH OUT
CREATE OR REPLACE FUNCTION public.cash_out(p_bet_id UUID, p_multiplier DECIMAL)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_bet_amount DECIMAL;
    v_winnings DECIMAL;
    v_status TEXT;
BEGIN
    v_user_id := auth.uid();
    
    -- Fetch bet and verify ownership/status
    SELECT amount, status INTO v_bet_amount, v_status 
    FROM public.bets WHERE id = p_bet_id AND user_id = v_user_id;

    IF v_bet_amount IS NULL THEN
        RETURN json_build_object('error', 'Bet not found');
    END IF;

    IF v_status != 'playing' THEN
        RETURN json_build_object('error', 'Bet already finalized');
    END IF;

    v_winnings := floor(v_bet_amount * p_multiplier);

    -- Update bet
    UPDATE public.bets 
    SET status = 'cashed', multiplier_cashed = p_multiplier, winnings = v_winnings
    WHERE id = p_bet_id;

    -- Credit balance
    UPDATE public.profiles SET balance = balance + v_winnings WHERE id = v_user_id;

    RETURN json_build_object('success', true, 'winnings', v_winnings);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
