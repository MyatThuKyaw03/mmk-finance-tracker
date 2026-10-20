-- ============================================================================
-- MMK Personal Finance Tracker (Multi-User Telegram Mini App + Bot Webhook)
-- Supabase PostgreSQL Schema
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users & Payday Settings Table
CREATE TABLE IF NOT EXISTS public.users (
  telegram_id BIGINT PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT 'User',
  next_payday DATE NOT NULL DEFAULT (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE,
  gemini_api_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Wallets Table (6 Default Wallets + Custom Wallets per User)
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  wallet_type TEXT NOT NULL DEFAULT 'LIQUID' CHECK (wallet_type IN ('LIQUID', 'DEBT')),
  balance_mmk BIGINT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (telegram_id, name)
);

CREATE INDEX IF NOT EXISTS idx_wallets_telegram_id ON public.wallets (telegram_id, sort_order);

-- 3. Monthly TODOs Table
CREATE TABLE IF NOT EXISTS public.monthly_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  target_mmk BIGINT NOT NULL DEFAULT 0,
  done_mmk BIGINT NOT NULL DEFAULT 0,
  month_cycle TEXT NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY-MM'),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monthly_todos_telegram_id ON public.monthly_todos (telegram_id, is_archived, month_cycle);

-- 4. Transactions Table
-- Note: Transfers insert TWO rows sharing `transfer_pair_id` (-amount_mmk and +amount_mmk)
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  tx_date DATE NOT NULL DEFAULT CURRENT_DATE,
  item_note TEXT NOT NULL,
  voice_input TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  wallet_name TEXT NOT NULL,
  amount_mmk BIGINT NOT NULL,
  transfer_pair_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_telegram_date ON public.transactions (telegram_id, tx_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_pair ON public.transactions (transfer_pair_id) WHERE transfer_pair_id IS NOT NULL;

-- 5. Daily Summary View (Date | Net Total MMK | Pure Spent MMK)
CREATE OR REPLACE VIEW public.daily_summary AS
SELECT
  telegram_id,
  tx_date,
  COALESCE(SUM(amount_mmk), 0)::BIGINT AS total_amount_mmk,
  COALESCE(SUM(ABS(amount_mmk)) FILTER (WHERE amount_mmk < 0 AND category NOT LIKE 'Transfer%'), 0)::BIGINT AS pure_spent_mmk,
  COALESCE(SUM(amount_mmk) FILTER (WHERE category = 'Income' OR (amount_mmk > 0 AND category NOT LIKE 'Transfer%')), 0)::BIGINT AS total_income_mmk,
  COUNT(*)::INT AS tx_count
FROM public.transactions
GROUP BY telegram_id, tx_date
ORDER BY tx_date DESC;

-- 6. Row Level Security (Permissive for TMA Anon Key + Service Role)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to users" ON public.users;
CREATE POLICY "Allow all access to users" ON public.users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to wallets" ON public.wallets;
CREATE POLICY "Allow all access to wallets" ON public.wallets FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to monthly_todos" ON public.monthly_todos;
CREATE POLICY "Allow all access to monthly_todos" ON public.monthly_todos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to transactions" ON public.transactions;
CREATE POLICY "Allow all access to transactions" ON public.transactions FOR ALL USING (true) WITH CHECK (true);
