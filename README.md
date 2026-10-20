# MMK Personal Finance Tracker (Telegram Mini App + Vercel Bot Webhook)

A multi-user Burmese Personal Finance Tracker in **MMK (မြန်မာကျပ်)** built as a **Telegram Mini App (TMA)** + **Vercel Serverless Telegram Bot Webhook** (`api/telegram-webhook.ts`) sharing a single deterministic Burmese natural-language parser (`src/lib/burmeseParser.ts`) and backed by **Supabase PostgreSQL**.

---

## 1. Architecture & Shared Burmese Parser

- **Frontend (`src/`)**: React 18 + Vite + TypeScript + Tailwind CSS + Lucide Icons + `@supabase/supabase-js`.
- **Telegram Integration (`index.html`, `src/lib/telegram.ts`)**: Loads `https://telegram.org/js/telegram-web-app.js` and reads `window.Telegram?.WebApp?.initDataUnsafe?.user` for `telegram_id` and `first_name` (falls back to `telegram_id = 123456789` in standard browsers).
- **Shared Burmese Parser (`src/lib/burmeseParser.ts`)**:
  - Normalizes Burmese digits (`၀-၉` → `0-9`) and spoken number words (`တစ်` → `1`, etc.).
  - Supports spoken MMK multipliers (`ဆယ်သိန်း` = `1,000,000`, `သိန်းခွဲ` = `+50,000`, `သိန်း` = `*100,000`, `သောင်းခွဲ` = `+5,000`, `သောင်း` = `*10,000`, `ထောင်ခွဲ` = `+500`, `ထောင်` = `*1,000`, `ရာ` = `*100`).
  - Supports 6 default wallet names (`Cash`, `KPay`, `AYA Pay`, `AYA Bank`, `Virtual Visa`, `AYA Credit Card`) plus user-defined custom wallets.
  - Deterministically classifies `income`, `transfer` (dual-row `-amount` and `+amount` with `transfer_pair_id`), `todo_pay`, `todo_add`, `todo_update`, `expense`, `date_summary`, and `advice_only` (calls `gemini-3.5-flash-lite`).
- **Backend Bot Webhook (`api/telegram-webhook.ts`)**: Vercel Serverless Function sharing `src/lib/burmeseParser.ts` and syncing directly with Supabase (`users`, `wallets`, `transactions`, `monthly_todos`, and `daily_summary`).

---

## 2. Setup & Deployment on Vercel

### Step 1: Supabase Database Setup
Run [`supabase/schema.sql`](./supabase/schema.sql) in your Supabase SQL Editor.

### Step 2: Environment Variables
Configure the environment variables from [`.env.example`](./.env.example) in your Vercel Project Settings (and local `.env`).

### Step 3: Register Telegram Webhook on Vercel
After deploying to Vercel, register your bot webhook with Telegram:
```bash
curl "https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_DOMAIN>.vercel.app/api/telegram-webhook"
```
