export const DEFAULT_WALLETS = [
  'Cash',
  'KPay',
  'AYA Pay',
  'AYA Bank',
  'Virtual Visa',
  'AYA Credit Card',
] as const;

export type DefaultWalletName = (typeof DEFAULT_WALLETS)[number];
export type WalletName = DefaultWalletName | string;

export type ParsedIntentType =
  | 'income'
  | 'transfer'
  | 'todo_pay'
  | 'todo_add'
  | 'todo_update'
  | 'expense'
  | 'date_summary'
  | 'advice_only';

export interface ParsedBurmeseCommand {
  type: ParsedIntentType;
  amount: number;
  wallet: WalletName;
  fromWallet?: WalletName;
  toWallet?: WalletName;
  description: string;
  rawText: string;
  normalizedText: string;
  todoTitle?: string;
  summaryDateOffset?: 0 | -1; // 0 = today (ဒီနေ့), -1 = yesterday (မနေ့က)
  summaryDateISO?: string;
}

export interface FinancialContextForAdvice {
  safeToSpendToday: number;
  totalLiquidMmk: number;
  daysUntilPayday: number;
  nextPayday: string;
  creditCardDebtMmk?: number;
}

const BURMESE_DIGIT_MAP: Record<string, string> = {
  '၀': '0',
  '၁': '1',
  '၂': '2',
  '၃': '3',
  '၄': '4',
  '၅': '5',
  '၆': '6',
  '၇': '7',
  '၈': '8',
  '၉': '9',
};

const BURMESE_NUMBER_WORDS: Array<[RegExp, string]> = [
  [/တစ်ဆယ်(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '10'],
  [/တစ်(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '1'],
  [/နှစ်(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '2'],
  [/သုံး(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '3'],
  [/လေး(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '4'],
  [/ငါး(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '5'],
  [/ခြောက်(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '6'],
  [/ခုနှစ်(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '7'],
  [/ခုနစ်(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '7'],
  [/ရှစ်(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '8'],
  [/ကိုး(?=\s*(?:သိန်း|သောင်း|ထောင်|ရာ))/g, '9'],
];

/**
 * Normalizes Burmese digits (၀-၉) to ASCII (0-9) and cleans up numeric formatting.
 */
export function normalizeBurmeseDigits(input: string): string {
  let out = input.replace(/[၀-၉]/g, (ch) => BURMESE_DIGIT_MAP[ch] ?? ch);
  // Strip commas inside numbers (e.g., 10,000 -> 10000)
  out = out.replace(/(\d),(\d)/g, '$1$2').replace(/(\d),(\d)/g, '$1$2');
  for (const [pattern, replacement] of BURMESE_NUMBER_WORDS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Extracts MMK amount using Burmese spoken multipliers:
 * - ဆယ်သိန်း = 1,000,000
 * - သိန်းခွဲ = +50,000
 * - သိန်း = *100,000
 * - သောင်းခွဲ = +5,000
 * - သောင်း = *10,000
 * - ထောင်ခွဲ = +500
 * - ထောင် = *1,000
 * - ရာ = *100
 */
export function parseBurmeseAmount(input: string): number {
  const normalized = normalizeBurmeseDigits(input);
  let working = normalized;
  let total = 0;
  let matchedMultiplier = false;

  // 1. ဆယ်သိန်း = 1000000 (or N * 1000000 if preceded by digit)
  working = working.replace(/(\d+(?:\.\d+)?)?\s*ဆယ်သိန်း/g, (_match, numStr) => {
    matchedMultiplier = true;
    const mult = numStr ? parseFloat(numStr) : 1;
    total += Math.round(mult * 1000000);
    return ' ';
  });

  // 2. Half multipliers: သိန်းခွဲ = +50000, သောင်းခွဲ = +5000, ထောင်ခွဲ = +500
  // Note: If preceded by a digit (e.g. "၂သိန်းခွဲ"), the digit + base unit ("၂သိန်း")
  // adds 2 * 100000 and "သိန်းခွဲ" adds +50000 = 250000.
  if (working.includes('သိန်းခွဲ')) {
    matchedMultiplier = true;
    total += 50000;
    working = working.replace(/သိန်းခွဲ/g, 'သိန်း');
  }

  if (working.includes('သောင်းခွဲ')) {
    matchedMultiplier = true;
    total += 5000;
    working = working.replace(/သောင်းခွဲ/g, 'သောင်း');
  }

  if (working.includes('ထောင်ခွဲ')) {
    matchedMultiplier = true;
    total += 500;
    working = working.replace(/ထောင်ခွဲ/g, 'ထောင်');
  }

  // 3. Base multipliers: သိန်း = *100000, သောင်း = *10000, ထောင် = *1000, ရာ = *100
  const unitMultipliers: Array<{ unit: string; factor: number }> = [
    { unit: 'သိန်း', factor: 100000 },
    { unit: 'သောင်း', factor: 10000 },
    { unit: 'ထောင်', factor: 1000 },
    { unit: 'ရာ', factor: 100 },
  ];

  for (const { unit, factor } of unitMultipliers) {
    const regex = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`, 'g');
    working = working.replace(regex, (_match, numStr) => {
      matchedMultiplier = true;
      total += Math.round(parseFloat(numStr) * factor);
      return ' ';
    });
  }

  // Handle trailing digits after a unit (e.g. "၁သိန်း ၅" where 5 means 50,000, or raw numbers if no multiplier matched)
  if (!matchedMultiplier) {
    const rawNumbers = working.match(/\d+(?:\.\d+)?/g);
    if (rawNumbers && rawNumbers.length > 0) {
      // Pick the largest or last number representing the MMK amount
      const nums = rawNumbers.map((n) => Math.round(parseFloat(n)));
      total = Math.max(...nums);
    }
  }

  return total;
}

interface WalletAliasDef {
  canonical: WalletName;
  aliases: string[];
}

const WALLET_ALIASES: WalletAliasDef[] = [
  {
    canonical: 'AYA Credit Card',
    aliases: [
      'aya credit card',
      'credit card',
      'aya credit',
      'ခရက်ဒစ်ကတ်',
      'ခရက်ဒစ်',
      'အကြွေးကတ်',
    ],
  },
  {
    canonical: 'Virtual Visa',
    aliases: ['virtual visa', 'visa card', 'virtual card', 'visa', 'ဗီဇာ'],
  },
  {
    canonical: 'AYA Pay',
    aliases: ['aya pay', 'ayapay', 'ဧရာပေး', 'ayaပေး'],
  },
  {
    canonical: 'AYA Bank',
    aliases: ['aya bank', 'ayabank', 'aya ဘဏ်', 'ဧရာဘဏ်', 'aya account', 'aya acc', 'ဘဏ်'],
  },
  {
    canonical: 'KPay',
    aliases: ['kpay', 'kbzpay', 'kbz pay', 'k pay', 'ကေပေးလ်', 'ကေပေး'],
  },
  {
    canonical: 'Cash',
    aliases: ['cash', 'လက်ငင်း', 'ငွေသား', 'လက်ထဲ'],
  },
];

interface MentionedWallet {
  wallet: WalletName;
  index: number;
  endIndex: number;
  matchedAlias: string;
}

/**
 * Finds all wallet mentions in the input text ordered by their position.
 */
export function findWalletMentions(
  input: string,
  customWallets: string[] = []
): MentionedWallet[] {
  const lower = input.toLowerCase();
  const mentions: MentionedWallet[] = [];
  const occupiedRanges: Array<[number, number]> = [];

  const allDefs: WalletAliasDef[] = [
    ...WALLET_ALIASES,
    ...customWallets
      .filter((cw) => !DEFAULT_WALLETS.includes(cw as DefaultWalletName))
      .map((cw) => ({ canonical: cw, aliases: [cw.toLowerCase()] })),
  ];

  for (const def of allDefs) {
    for (const alias of def.aliases) {
      let searchPos = 0;
      while (searchPos < lower.length) {
        const idx = lower.indexOf(alias, searchPos);
        if (idx === -1) break;
        const endIdx = idx + alias.length;
        const overlaps = occupiedRanges.some(
          ([start, end]) => idx < end && endIdx > start
        );
        if (!overlaps) {
          occupiedRanges.push([idx, endIdx]);
          mentions.push({
            wallet: def.canonical,
            index: idx,
            endIndex: endIdx,
            matchedAlias: alias,
          });
        }
        searchPos = endIdx;
      }
    }
  }

  return mentions.sort((a, b) => a.index - b.index);
}

/**
 * Detects Debit `fromWallet` and Credit `toWallet` for transfer commands.
 */
export function detectTransferWallets(
  input: string,
  customWallets: string[] = []
): { fromWallet: WalletName; toWallet: WalletName } {
  const mentions = findWalletMentions(input, customWallets);

  if (mentions.length >= 2) {
    let fromWallet: WalletName | undefined;
    let toWallet: WalletName | undefined;

    for (const m of mentions) {
      const afterText = input.slice(m.endIndex, m.endIndex + 16).trim();
      if (/^(ကနေ|မှ|ထဲက|က\b|from\b)/i.test(afterText) && !fromWallet) {
        fromWallet = m.wallet;
      } else if (/^(ကို|သို့|ထဲကို|ထဲ|အဖြစ်|to\b)/i.test(afterText) && !toWallet) {
        toWallet = m.wallet;
      }
    }

    if (fromWallet && !toWallet) {
      toWallet = mentions.find((m) => m.wallet !== fromWallet)?.wallet ?? mentions[1].wallet;
    } else if (!fromWallet && toWallet) {
      fromWallet = mentions.find((m) => m.wallet !== toWallet)?.wallet ?? mentions[0].wallet;
    } else if (!fromWallet || !toWallet) {
      fromWallet = mentions[0].wallet;
      toWallet = mentions[1].wallet;
    }

    return { fromWallet, toWallet };
  }

  if (mentions.length === 1) {
    const only = mentions[0];
    const afterText = input.slice(only.endIndex, only.endIndex + 16).trim();
    const isWithdraw = input.includes('ထုတ်လိုက်');
    const hasFromMarker = /^(ကနေ|မှ|ထဲက)/.test(afterText);
    const hasToMarker = /^(ကို|သို့|ထဲကို|ထဲ)/.test(afterText);

    if (isWithdraw || hasFromMarker) {
      const fromWallet = only.wallet;
      const toWallet = fromWallet === 'Cash' ? 'KPay' : 'Cash';
      return { fromWallet, toWallet };
    }

    if (hasToMarker) {
      const toWallet = only.wallet;
      const fromWallet = toWallet === 'Cash' ? 'KPay' : 'Cash';
      return { fromWallet, toWallet };
    }

    return {
      fromWallet: only.wallet,
      toWallet: only.wallet === 'Cash' ? 'KPay' : 'Cash',
    };
  }

  return { fromWallet: 'KPay', toWallet: 'Cash' };
}

/**
 * Returns YYYY-MM-DD in Myanmar Time (UTC+6:30) with an optional day offset.
 */
export function getMyanmarDateISO(dayOffset = 0, referenceDate: Date = new Date()): string {
  // Convert to UTC+6:30 (390 minutes ahead of UTC)
  const utcMs = referenceDate.getTime() + referenceDate.getTimezoneOffset() * 60000;
  const mmMs = utcMs + 390 * 60000 + dayOffset * 86400000;
  const mmDate = new Date(mmMs);
  const yyyy = mmDate.getFullYear();
  const mm = String(mmDate.getMonth() + 1).padStart(2, '0');
  const dd = String(mmDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Cleans up the description text by removing amount expressions and boilerplate keywords.
 */
function extractCleanDescription(rawText: string, type: ParsedIntentType): string {
  let cleaned = rawText
    .replace(/[၀-၉0-9]+(?:\.[၀-၉0-9]+)?\s*(?:ဆယ်သိန်း|သိန်းခွဲ|သိန်း|သောင်းခွဲ|သောင်း|ထောင်ခွဲ|ထောင်|ရာ)/g, '')
    .replace(/ဆယ်သိန်း|သိန်းခွဲ|သောင်းခွဲ|ထောင်ခွဲ/g, '')
    .replace(/\b\d[\d,]*\b/g, '')
    .replace(/[၀-၉]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (type === 'todo_add' || type === 'todo_pay' || type === 'todo_update') {
    cleaned = cleaned
      .replace(/todo\s*(?:add|pay|update|ထည့်|အသစ်|ပေးပြီး|ပေး|ဆပ်ပြီး|ဆပ်|ပြင်|ပြောင်း)?/gi, '')
      .replace(/လစဉ်ပေးရန်|ပေးရန်စာရင်းထည့်|ဆပ်လိုက်ပြီ|ပေးလိုက်ပြီ|ပြင်မယ်/g, '')
      .trim();
  }

  return cleaned || rawText.trim();
}

/**
 * Deterministically parses a Burmese or mixed Burmese/English finance message.
 */
export function parseBurmeseFinanceInput(
  rawText: string,
  customWallets: string[] = []
): ParsedBurmeseCommand {
  const trimmed = rawText.trim();
  const normalizedText = normalizeBurmeseDigits(trimmed);
  const amount = parseBurmeseAmount(trimmed);
  const mentions = findWalletMentions(trimmed, customWallets);
  const primaryWallet: WalletName = mentions[0]?.wallet ?? 'Cash';

  // 1. Check `date_summary` first (`ဒီနေ့ဘယ်လောက်သုံးထားလဲ`, `မနေ့ကဘယ်လောက်သုံးလိုက်လဲ`, etc.)
  const isDateSummary =
    trimmed.includes('ဒီနေ့ဘယ်လောက်သုံးထားလဲ') ||
    trimmed.includes('မနေ့ကဘယ်လောက်သုံးလိုက်လဲ') ||
    ((trimmed.includes('ဒီနေ့') || trimmed.includes('မနေ့က') || trimmed.includes('ယနေ့')) &&
      (trimmed.includes('ဘယ်လောက်သုံး') ||
        trimmed.includes('ဘယ်လောက်ကုန်') ||
        trimmed.includes('အသုံးစရိတ်')));

  if (isDateSummary) {
    const isYesterday = trimmed.includes('မနေ့က');
    const offset: 0 | -1 = isYesterday ? -1 : 0;
    return {
      type: 'date_summary',
      amount: 0,
      wallet: primaryWallet,
      description: isYesterday ? 'မနေ့က အသုံးစရိတ်စာရင်း' : 'ဒီနေ့ အသုံးစရိတ်စာရင်း',
      rawText: trimmed,
      normalizedText,
      summaryDateOffset: offset,
      summaryDateISO: getMyanmarDateISO(offset),
    };
  }

  // 2. Check `advice_only` (contains `သင့်လား`, `မလား`, `လား`, `လဲ`)
  const isAdviceOnly =
    trimmed.includes('သင့်လား') ||
    trimmed.includes('မလား') ||
    trimmed.includes('လား') ||
    trimmed.includes('လဲ');

  if (isAdviceOnly) {
    return {
      type: 'advice_only',
      amount,
      wallet: primaryWallet,
      description: trimmed,
      rawText: trimmed,
      normalizedText,
    };
  }

  // 3. Check `todo_pay`, `todo_update`, `todo_add`
  const lower = trimmed.toLowerCase();
  const isTodoPay =
    lower.includes('todo pay') ||
    lower.includes('pay todo') ||
    trimmed.includes('todo ပေး') ||
    trimmed.includes('todo ဆပ်') ||
    trimmed.includes('ကြွေးဆပ်') ||
    trimmed.includes('ဘေလ်ဆပ်') ||
    trimmed.includes('ဆပ်လိုက်ပြီ') ||
    trimmed.includes('ဆပ်ပြီးပြီ');

  if (isTodoPay) {
    const todoTitle = extractCleanDescription(trimmed, 'todo_pay');
    return {
      type: 'todo_pay',
      amount,
      wallet: primaryWallet,
      description: trimmed,
      rawText: trimmed,
      normalizedText,
      todoTitle,
    };
  }

  const isTodoUpdate =
    lower.includes('todo update') ||
    lower.includes('update todo') ||
    trimmed.includes('todo ပြင်') ||
    trimmed.includes('todo ပြောင်း') ||
    trimmed.includes('target ပြင်');

  if (isTodoUpdate) {
    const todoTitle = extractCleanDescription(trimmed, 'todo_update');
    return {
      type: 'todo_update',
      amount,
      wallet: primaryWallet,
      description: trimmed,
      rawText: trimmed,
      normalizedText,
      todoTitle,
    };
  }

  const isTodoAdd =
    lower.includes('todo add') ||
    lower.includes('add todo') ||
    trimmed.includes('todo ထည့်') ||
    trimmed.includes('todo အသစ်') ||
    trimmed.includes('လစဉ်ပေးရန်') ||
    trimmed.includes('ပေးရန်စာရင်းထည့်');

  if (isTodoAdd) {
    const todoTitle = extractCleanDescription(trimmed, 'todo_add');
    return {
      type: 'todo_add',
      amount,
      wallet: primaryWallet,
      description: trimmed,
      rawText: trimmed,
      normalizedText,
      todoTitle,
    };
  }

  // 4. Check `transfer` (contains `လွှဲ`, `လဲပေး`, `လဲလိုက်`, `ထုတ်လိုက်`)
  const isTransfer =
    trimmed.includes('လွှဲ') ||
    trimmed.includes('လဲပေး') ||
    trimmed.includes('လဲလိုက်') ||
    trimmed.includes('ထုတ်လိုက်');

  if (isTransfer) {
    const { fromWallet, toWallet } = detectTransferWallets(trimmed, customWallets);
    return {
      type: 'transfer',
      amount,
      wallet: fromWallet,
      fromWallet,
      toWallet,
      description: extractCleanDescription(trimmed, 'transfer'),
      rawText: trimmed,
      normalizedText,
    };
  }

  // 5. Check `income` (contains `ရပြီ`, `ရတယ်`, `ဝင်တယ်`, `ပြန်ရ`, `လစာ`, `received`, or ends with `နဲ့ရ`)
  const isIncome =
    trimmed.includes('ရပြီ') ||
    trimmed.includes('ရတယ်') ||
    trimmed.includes('ဝင်တယ်') ||
    trimmed.includes('ပြန်ရ') ||
    trimmed.includes('လစာ') ||
    lower.includes('received') ||
    trimmed.endsWith('နဲ့ရ');

  if (isIncome) {
    return {
      type: 'income',
      amount,
      wallet: primaryWallet,
      description: extractCleanDescription(trimmed, 'income'),
      rawText: trimmed,
      normalizedText,
    };
  }

  // 6. Default to `expense` when amount > 0 (or fallback advice_only if no amount)
  if (amount > 0) {
    return {
      type: 'expense',
      amount,
      wallet: primaryWallet,
      description: extractCleanDescription(trimmed, 'expense'),
      rawText: trimmed,
      normalizedText,
    };
  }

  return {
    type: 'advice_only',
    amount: 0,
    wallet: primaryWallet,
    description: trimmed,
    rawText: trimmed,
    normalizedText,
  };
}

/**
 * Calls the `gemini-3.5-flash-lite` API for `advice_only` queries.
 * Provides a deterministic smart Burmese financial fallback if no API key is configured.
 */
export async function getGeminiFinancialAdvice(
  question: string,
  parsedAmount: number,
  context: FinancialContextForAdvice,
  apiKey?: string
): Promise<string> {
  const systemPrompt = `သင်သည် မြန်မာကျပ် (MMK) အသုံးစရိတ် အကြံပေး AI ဖြစ်ပါသည်။
လက်ရှိ အသုံးပြုသူ၏ ငွေကြေးအခြေအနေ:
- စုစုပေါင်း လက်ကျန်ငွေ (Liquid Wallets): ${context.totalLiquidMmk.toLocaleString()} MMK
- လစာထုတ်ရက် (${context.nextPayday}) အထိ ကျန်ရက်: ${context.daysUntilPayday} ရက်
- တစ်နေ့တာ သုံးနိုင်သောပမာဏ (Safe-to-Spend Today): ${Math.round(context.safeToSpendToday).toLocaleString()} MMK/day
- မေးခွန်းပါ ပမာဏ: ${parsedAmount.toLocaleString()} MMK

အသုံးပြုသူ၏ မေးခွန်းကို မြန်မာဘာသာဖြင့် တိုတိုတုတ်တုတ်၊ ဖော်ရွေပြီး လက်တွေ့ကျသော ငွေကြေးအကြံဉာဏ် ပေးပါ။`;

  if (apiKey && apiKey.trim().length > 0) {
    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite'];
    for (const model of modelsToTry) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
            apiKey.trim()
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: `${systemPrompt}\n\nမေးခွန်း: ${question}` }],
                },
              ],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 350,
              },
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (reply) return reply.trim();
        }
      } catch {
        // Fallback to next model or deterministic calculation below
      }
    }
  }

  // Deterministic Burmese advice calculation when no API key is set or offline
  const safeDaily = Math.round(context.safeToSpendToday);
  if (parsedAmount > 0) {
    if (parsedAmount <= safeDaily) {
      const remainingToday = safeDaily - parsedAmount;
      return `💡 အကြံပြုချက် (AI Advisor): သင့်ရဲ့ တစ်နေ့တာ သုံးနိုင်သောပမာဏ (${safeDaily.toLocaleString()} MMK) အတွင်း ရှိသောကြောင့် (${parsedAmount.toLocaleString()} MMK) ကို စိတ်ချလက်ချ သုံးနိုင်ပါတယ်! သုံးပြီးရင် ဒီနေ့အတွက် ${remainingToday.toLocaleString()} MMK ကျန်ပါဦးမယ်။`;
    } else if (parsedAmount <= context.totalLiquidMmk) {
      const daysEquivalent = (parsedAmount / Math.max(1, safeDaily)).toFixed(1);
      const newSafeDaily = Math.round(
        (context.totalLiquidMmk - parsedAmount) / Math.max(1, context.daysUntilPayday)
      );
      return `⚠️ အကြံပြုချက် (AI Advisor): ${parsedAmount.toLocaleString()} MMK သည် သင့်တစ်နေ့တာ သုံးနိုင်သောပမာဏ (${safeDaily.toLocaleString()} MMK) ထက် ${daysEquivalent} ရက်စာ ပိုများနေပါတယ်။ မဖြစ်မနေ လိုအပ်မှသာ ဝယ်ယူသင့်ပြီး၊ ဝယ်လိုက်ပါက နောက်ရက်များတွင် တစ်နေ့ ${newSafeDaily.toLocaleString()} MMK သာ သုံးနိုင်ပါတော့မည်။`;
    } else {
      return `🛑 အကြံပြုချက် (AI Advisor): ${parsedAmount.toLocaleString()} MMK သည် သင့်လက်ကျန်ငွေ စုစုပေါင်း (${context.totalLiquidMmk.toLocaleString()} MMK) ထက် ကျော်လွန်နေသောကြောင့် လုံးဝ မသုံးသင့်သေးပါ!`;
    }
  }

  return `💡 လက်ရှိ သင့်လက်ကျန်ငွေမှာ ${context.totalLiquidMmk.toLocaleString()} MMK ဖြစ်ပြီး လစာထုတ်ရက်အထိ ${context.daysUntilPayday} ရက် ကျန်သဖြင့် တစ်နေ့လျှင် ${safeDaily.toLocaleString()} MMK အတွင်း သုံးစွဲရန် အကြံပြုပါသည်။`;
}

