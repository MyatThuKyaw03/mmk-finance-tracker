# MMK Personal Finance Tracker (Telegram Mini App + Bot Webhook)

A multi-user Burmese Personal Finance Tracker in **MMK (မြန်မာကျပ်)** built as a **Telegram Mini App (TMA)** + **Netlify Serverless Telegram Bot Webhook** sharing a single deterministic Burmese natural-language parser (`src/lib/burmeseParser.ts`) and backed by **Supabase PostgreSQL**.

---

## 1. Architecture & Shared Burmese Parser

- **Frontend (`src/`)**: React 18 + Vite + TypeScript + Tailwind CSS + Lucide Icons + `@supabase/supabase-js`.
- **Telegram Integration (`index.html`, `src/lib/telegram.ts`)**: Loads `https://telegram.org/js/telegram-web-app.js` and reads `window.Telegram?.WebApp?.initDataUnsafe?.user` for `telegram_id` and `first_name` (falls back to `telegram_id = 123456789` in standard browsers).
- **Shared Burmese Parser (`src/lib/burmeseParser.ts`)**:
  - Normalizes Burmese digits (`၀-၉` → `0-9`) and spoken number words (`တစ်` → `1`, etc.).
  - Supports spoken MMK multipliers:
    - `ဆယ်သိန်း` = `1,000,000`
    - `သိန်းခွဲ` = `+50,000`
    - `သိန်း` = `*100,000`
    - `သောင်းခွဲ` = `+5,000`
    - `သောင်း` = `*10,000`
    - `ထောင်ခွဲ` = `+500`
    - `ထောင်` = `*1,000`
    - `ရာ` = `*100`
  - Supports 6 default wallet names (`Cash`, `KPay`, `AYA Pay`, `AYA Bank`, `Virtual Visa`, `AYA Credit Card`) plus user-defined custom wallets.
  - Deterministically classifies:
    - `income` (`ရပြီ`, `ရတယ်`, `ဝင်တယ်`, `ပြန်ရ`, `လစာ`, `received`, or ends with `နဲ့ရ`)
    - `transfer` (`လွှဲ`, `လဲပေး`, `လဲလိုက်`, `ထုတ်လိုက်` → detects Debit `fromWallet` vs Credit `toWallet` and inserts **two** rows sharing `transfer_pair_id`: `-amount` and `+amount`)
    - `todo_pay`, `todo_add`, `todo_update`
    - `expense` (default when `amount > 0`)
    - `date_summary` (`ဒီနေ့ဘယ်လောက်သုံးထားလဲ`, `မနေ့ကဘယ်လောက်သုံးလိုက်လဲ`)
    - `advice_only` (`သင့်လား`, `မလား`, `လား`, `လဲ` → calls `gemini-3.5-flash-lite` API)
- **Backend Bot Webhook (`netlify/functions/telegram-webhook.ts`)**: Netlify Serverless Function that imports `src/lib/burmeseParser.ts` and logs/queries directly against Supabase.

---

## 2. Setup & Deployment

### Step 1: Supabase Database Setup
Run [`supabase/schema.sql`](./supabase/schema.sql) in your Supabase SQL Editor. It creates:
- `user_settings` (`telegram_id`, `first_name`, `next_payday`, `gemini_api_key`)
- `wallets` (6 default wallets + custom wallets per user)
- `monthly_todos` (`target_mmk`, `done_mmk`, `is_archived`, `month_label`)
- `transactions` (supports `transfer_pair_id` for dual-row transfers)
- `daily_summary` view (`tx_date`, `net_total_mmk`, `pure_spent_mmk`, `total_income_mmk`, `tx_count`)

### Step 2: Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

### Step 3: Local Development & Tests
```bash
npm install
npm run test
npm run dev
```

### Step 4: Register Telegram Webhook on Netlify
After deploying to Netlify, register your bot webhook with Telegram:
```bash
curl "https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR_NETLIFY_SITE>.netlify.app/.netlify/functions/telegram-webhook"
```

