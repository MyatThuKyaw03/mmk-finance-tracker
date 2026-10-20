import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_WALLETS,
  getGeminiFinancialAdvice,
  getMyanmarDateISO,
  parseBurmeseFinanceInput,
} from '../../src/lib/burmeseParser';

interface TelegramWebhookUpdate {
  update_id?: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      first_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
  };
}

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
}

interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function sendTelegramMessage(
  botToken: string | undefined,
  chatId: number,
  text: string,
  miniAppUrl?: string
): Promise<void> {
  if (!botToken) return;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  };

  if (miniAppUrl && miniAppUrl.startsWith('https://')) {
    payload.reply_markup = {
      inline_keyboard: [
        [
          {
            text: '📱 MMK Finance Mini App ဖွင့်မည်',
            web_app: { url: miniAppUrl },
          },
        ],
      ],
    };
  }

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Ignore network errors in test mode
  }
}

export const handler = async (event: NetlifyEvent): Promise<NetlifyResponse> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        service: 'MMK Finance Tracker Telegram Bot Webhook',
      }),
    };
  }

  try {
    const update: TelegramWebhookUpdate = event.body ? JSON.parse(event.body) : {};
    const msg = update.message;
    if (!msg || !msg.text || !msg.from) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: true }) };
    }

    const telegram_id = msg.from.id;
    const first_name = msg.from.first_name || 'User';
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const miniAppUrl = process.env.MINI_APP_URL;
    const defaultGeminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

    const supabase =
      supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

    // Handle /start or /help
    if (text.startsWith('/start') || text.startsWith('/help')) {
      if (supabase) {
        await supabase.from('user_settings').upsert(
          {
            telegram_id,
            first_name,
          },
          { onConflict: 'telegram_id' }
        );

        const { data: existingWallets } = await supabase
          .from('wallets')
          .select('id')
          .eq('telegram_id', telegram_id);

        if (!existingWallets || existingWallets.length === 0) {
          const seedWallets = DEFAULT_WALLETS.map((name, idx) => ({
            telegram_id,
            name,
            balance_mmk: 0,
            is_credit: name === 'AYA Credit Card',
            sort_order: idx,
          }));
          await supabase
            .from('wallets')
            .upsert(seedWallets, { onConflict: 'telegram_id,name' });
        }
      }

      const welcomeReply = [
        `မင်္ဂလာပါ <b>${first_name}</b>! 🙏`,
        `<b>MMK Personal Finance Tracker</b> မှ ကြိုဆိုပါတယ်။`,
        ``,
        `မြန်မာလို အလွယ်တကူ စာရိုက်ပြီး မှတ်တမ်းတင်နိုင်ပါတယ် -`,
        `• အသုံးစရိတ်: <code>ထမင်းဖိုး ၁၀၀၀၀ KPay</code>`,
        `• ဝင်ငွေ: <code>လစာ ၁၄သိန်း AYA Bank ရပြီ</code>`,
        `• လွှဲပြောင်းငွေ: <code>AYA Bank ကနေ KPay ကို ၁သိန်းခွဲ လွှဲလိုက်တယ်</code>`,
        `• စာရင်းချုပ်: <code>ဒီနေ့ဘယ်လောက်သုံးထားလဲ</code>`,
        `• AI အကြံဉာဏ်: <code>ဖိနပ် ၅သောင်းတန် ဝယ်သင့်လား</code>`,
      ].join('\n');

      await sendTelegramMessage(botToken, chatId, welcomeReply, miniAppUrl);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, intent: 'welcome', reply: welcomeReply }),
      };
    }

    // Fetch user's custom wallets and settings if Supabase is connected
    let customWalletNames: string[] = [...DEFAULT_WALLETS];
    let walletsData: Array<{ id: string; name: string; balance_mmk: number; is_credit: boolean }> =
      [];
    let nextPaydayISO = getMyanmarDateISO(10);
    let userGeminiKey = defaultGeminiKey;

    if (supabase) {
      const [{ data: wData }, { data: sData }] = await Promise.all([
        supabase.from('wallets').select('*').eq('telegram_id', telegram_id),
        supabase
          .from('user_settings')
          .select('*')
          .eq('telegram_id', telegram_id)
          .maybeSingle(),
      ]);

      if (wData && wData.length > 0) {
        walletsData = wData;
        customWalletNames = wData.map((w: { name: string }) => w.name);
      }
      if (sData) {
        if (sData.next_payday) nextPaydayISO = sData.next_payday;
        if (sData.gemini_api_key) userGeminiKey = sData.gemini_api_key;
      }
    }

    const parsed = parseBurmeseFinanceInput(text, customWalletNames);
    const todayISO = getMyanmarDateISO(0);

    // Compute Safe-to-Spend metrics
    const totalLiquidMmk = walletsData
      .filter((w) => !w.is_credit && w.name !== 'AYA Credit Card')
      .reduce((sum, w) => sum + Number(w.balance_mmk || 0), 0);
    const todayMs = new Date(`${todayISO}T00:00:00`).getTime();
    const paydayMs = new Date(`${nextPaydayISO}T00:00:00`).getTime();
    const daysUntilPayday = Math.max(1, Math.ceil((paydayMs - todayMs) / 86400000));
    const safeToSpendToday = totalLiquidMmk / daysUntilPayday;

    let replyText = '';

    if (parsed.type === 'date_summary') {
      const targetDate = parsed.summaryDateISO ?? todayISO;
      let netTotal = 0;
      let pureSpent = 0;

      if (supabase) {
        const { data: sumRow } = await supabase
          .from('daily_summary')
          .select('*')
          .eq('telegram_id', telegram_id)
          .eq('tx_date', targetDate)
          .maybeSingle();

        if (sumRow) {
          netTotal = Number(sumRow.net_total_mmk || 0);
          pureSpent = Number(sumRow.pure_spent_mmk || 0);
        }
      }

      const dayLabel = parsed.summaryDateOffset === -1 ? 'မနေ့က' : 'ဒီနေ့';
      replyText = [
        `📊 <b>${dayLabel} (${targetDate}) အသုံးစရိတ်စာရင်းချုပ်</b>`,
        `• Pure Spent (အသုံးစရိတ်သီးသန့်): <b>${pureSpent.toLocaleString()} MMK</b>`,
        `• Net Total (အသားတင်): <b>${netTotal >= 0 ? '+' : ''}${netTotal.toLocaleString()} MMK</b>`,
      ].join('\n');
    } else if (parsed.type === 'advice_only') {
      replyText = await getGeminiFinancialAdvice(
        parsed.rawText,
        parsed.amount,
        {
          safeToSpendToday,
          totalLiquidMmk,
          daysUntilPayday,
          nextPayday: nextPaydayISO,
        },
        userGeminiKey
      );
    } else if (parsed.type === 'transfer') {
      const amount = Math.abs(parsed.amount);
      const fromWallet = parsed.fromWallet ?? 'KPay';
      const toWallet = parsed.toWallet ?? 'Cash';
      const transferPairId = generateUUID();

      if (supabase && amount > 0) {
        await supabase.from('transactions').insert([
          {
            telegram_id,
            tx_date: todayISO,
            description: `${fromWallet} → ${toWallet} လွှဲပြောင်းငွေ (${parsed.rawText})`,
            type: 'transfer',
            wallet: fromWallet,
            amount_mmk: -amount,
            transfer_pair_id: transferPairId,
          },
          {
            telegram_id,
            tx_date: todayISO,
            description: `${fromWallet} → ${toWallet} လက်ခံငွေ (${parsed.rawText})`,
            type: 'transfer',
            wallet: toWallet,
            amount_mmk: amount,
            transfer_pair_id: transferPairId,
          },
        ]);

        for (const [wName, delta] of [
          [fromWallet, -amount],
          [toWallet, amount],
        ] as const) {
          const targetW = walletsData.find((w) => w.name === wName);
          if (targetW) {
            await supabase
              .from('wallets')
              .update({ balance_mmk: Number(targetW.balance_mmk) + delta })
              .eq('id', targetW.id);
          }
        }
      }

      replyText = [
        `🔄 <b>လွှဲပြောင်းငွေ မှတ်တမ်းတင်ပြီးပါပြီ</b>`,
        `• မှ (Debit): <b>${fromWallet} (-${amount.toLocaleString()} MMK)</b>`,
        `• သို့ (Credit): <b>${toWallet} (+${amount.toLocaleString()} MMK)</b>`,
        `• Pair ID: <code>${transferPairId.slice(0, 8)}</code>`,
      ].join('\n');
    } else if (parsed.type === 'todo_add') {
      const title = parsed.todoTitle || parsed.description || 'လစဉ်ပေးရန်';
      if (supabase) {
        await supabase.from('monthly_todos').insert({
          telegram_id,
          title,
          target_mmk: parsed.amount,
          done_mmk: 0,
          month_label: todayISO.slice(0, 7),
          is_archived: false,
        });
      }
      replyText = `✅ <b>လစဉ် TODO အသစ်ထည့်ပြီးပါပြီ</b>\n• ခေါင်းစဉ်: ${title}\n• ပမာဏ: <b>${parsed.amount.toLocaleString()} MMK</b>`;
    } else if (parsed.type === 'todo_update') {
      if (supabase && parsed.amount > 0) {
        const { data: todos } = await supabase
          .from('monthly_todos')
          .select('*')
          .eq('telegram_id', telegram_id)
          .eq('is_archived', false);
        const target = todos?.[0];
        if (target) {
          await supabase
            .from('monthly_todos')
            .update({ target_mmk: parsed.amount })
            .eq('id', target.id);
        }
      }
      replyText = `✏️ <b>လစဉ် TODO ပမာဏကို ${parsed.amount.toLocaleString()} MMK သို့ ပြင်ဆင်ပြီးပါပြီ။</b>`;
    } else if (parsed.type === 'todo_pay') {
      const payAmt = Math.abs(parsed.amount);
      if (supabase && payAmt > 0) {
        const { data: todos } = await supabase
          .from('monthly_todos')
          .select('*')
          .eq('telegram_id', telegram_id)
          .eq('is_archived', false);
        const target = todos?.[0];
        if (target) {
          await supabase
            .from('monthly_todos')
            .update({ done_mmk: Number(target.done_mmk || 0) + payAmt })
            .eq('id', target.id);
        }
        await supabase.from('transactions').insert({
          telegram_id,
          tx_date: todayISO,
          description: parsed.rawText,
          type: 'todo_pay',
          wallet: parsed.wallet,
          amount_mmk: -payAmt,
          todo_id: target?.id ?? null,
        });
        const w = walletsData.find((item) => item.name === parsed.wallet);
        if (w) {
          await supabase
            .from('wallets')
            .update({ balance_mmk: Number(w.balance_mmk) - payAmt })
            .eq('id', w.id);
        }
      }
      replyText = `✅ <b>TODO ပေးချေမှု မှတ်တမ်းတင်ပြီးပါပြီ</b>\n• ပမာဏ: <b>-${payAmt.toLocaleString()} MMK</b> (${parsed.wallet})`;
    } else {
      const isIncome = parsed.type === 'income';
      const signedAmount = isIncome ? Math.abs(parsed.amount) : -Math.abs(parsed.amount);

      if (supabase && parsed.amount > 0) {
        await supabase.from('transactions').insert({
          telegram_id,
          tx_date: todayISO,
          description: parsed.rawText,
          type: isIncome ? 'income' : 'expense',
          wallet: parsed.wallet,
          amount_mmk: signedAmount,
        });

        const w = walletsData.find((item) => item.name === parsed.wallet);
        if (w) {
          await supabase
            .from('wallets')
            .update({ balance_mmk: Number(w.balance_mmk) + signedAmount })
            .eq('id', w.id);
        }
      }

      replyText = isIncome
        ? `💰 <b>ဝင်ငွေ မှတ်တမ်းတင်ပြီးပါပြီ!</b>\n• ပမာဏ: <b>+${Math.abs(
            parsed.amount
          ).toLocaleString()} MMK</b>\n• ပိုက်ဆံအိတ်: <b>${parsed.wallet}</b>`
        : `💸 <b>အသုံးစရိတ် မှတ်တမ်းတင်ပြီးပါပြီ!</b>\n• ပမာဏ: <b>-${Math.abs(
            parsed.amount
          ).toLocaleString()} MMK</b>\n• ပိုက်ဆံအိတ်: <b>${parsed.wallet}</b>`;
    }

    await sendTelegramMessage(botToken, chatId, replyText, miniAppUrl);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        parsed,
        reply: replyText,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
    };
  }
};

