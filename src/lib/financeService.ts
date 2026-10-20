import { supabase, isSupabaseConfigured } from './supabase';
import {
  DEFAULT_WALLETS,
  FinancialContextForAdvice,
  getGeminiFinancialAdvice,
  getMyanmarDateISO,
  parseBurmeseFinanceInput,
  ParsedBurmeseCommand,
} from './burmeseParser';

export interface UserSettings {
  telegram_id: number;
  first_name: string;
  next_payday: string;
  gemini_api_key?: string | null;
}

export interface WalletRecord {
  id: string;
  telegram_id: number;
  name: string;
  balance_mmk: number;
  is_credit: boolean;
  sort_order: number;
}

export interface TransactionRecord {
  id: string;
  telegram_id: number;
  tx_date: string;
  description: string;
  type: 'income' | 'expense' | 'transfer' | 'todo_pay';
  wallet: string;
  amount_mmk: number; // Negative for expense, transfer debit, todo_pay; Positive for income, transfer credit
  transfer_pair_id?: string | null;
  todo_id?: string | null;
  created_at: string;
}

export interface DailySummaryRecord {
  telegram_id: number;
  tx_date: string;
  net_total_mmk: number;
  pure_spent_mmk: number;
  total_income_mmk: number;
  tx_count: number;
}

export interface MonthlyTodoRecord {
  id: string;
  telegram_id: number;
  title: string;
  target_mmk: number;
  done_mmk: number;
  month_label: string;
  is_archived: boolean;
  created_at: string;
}

export interface FinanceStateSnapshot {
  settings: UserSettings;
  wallets: WalletRecord[];
  transactions: TransactionRecord[];
  dailySummaries: DailySummaryRecord[];
  todos: MonthlyTodoRecord[];
  isLiveSupabase: boolean;
}

export interface CommandExecutionResult {
  parsed: ParsedBurmeseCommand;
  message: string;
  aiAdvice?: string;
  mutated: boolean;
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

export function getDefaultNextPayday(): string {
  const todayISO = getMyanmarDateISO(0);
  const [yyyy, mm, dd] = todayISO.split('-').map(Number);
  // Default to end of current month, or 25th of next month if past 25th
  const lastDayOfMonth = new Date(yyyy, mm, 0).getDate();
  if (dd < lastDayOfMonth) {
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;
  }
  const nextMonthDate = new Date(yyyy, mm, 25);
  return `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-${String(
    nextMonthDate.getDate()
  ).padStart(2, '0')}`;
}

export function computeSafeToSpendMetrics(
  wallets: WalletRecord[],
  nextPaydayISO: string
): FinancialContextForAdvice {
  const totalLiquidMmk = wallets
    .filter((w) => !w.is_credit && w.name !== 'AYA Credit Card')
    .reduce((sum, w) => sum + Number(w.balance_mmk || 0), 0);

  const creditCardDebtMmk = wallets
    .filter((w) => w.is_credit || w.name === 'AYA Credit Card')
    .reduce((sum, w) => sum + Number(w.balance_mmk || 0), 0);

  const todayISO = getMyanmarDateISO(0);
  const todayMs = new Date(`${todayISO}T00:00:00`).getTime();
  const paydayMs = new Date(`${nextPaydayISO}T00:00:00`).getTime();
  const diffDays = Math.ceil((paydayMs - todayMs) / 86400000);
  const daysUntilPayday = Math.max(1, isNaN(diffDays) ? 1 : diffDays);
  const safeToSpendToday = totalLiquidMmk / daysUntilPayday;

  return {
    safeToSpendToday,
    totalLiquidMmk,
    daysUntilPayday,
    nextPayday: nextPaydayISO,
    creditCardDebtMmk,
  };
}

// ============================================================================
// LocalStorage Fallback Store (used when Supabase env vars are not set)
// ============================================================================
const LOCAL_STORAGE_PREFIX = 'mmk_finance_tma_v1_';

function getLocalStore(telegram_id: number, first_name: string): FinanceStateSnapshot {
  const key = `${LOCAL_STORAGE_PREFIX}${telegram_id}`;
  if (typeof window !== 'undefined') {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as FinanceStateSnapshot;
        parsed.dailySummaries = buildDailySummariesFromTransactions(
          telegram_id,
          parsed.transactions
        );
        return parsed;
      } catch {
        // Re-seed below
      }
    }
  }

  const todayISO = getMyanmarDateISO(0);
  const yesterdayISO = getMyanmarDateISO(-1);
  const currentMonth = todayISO.slice(0, 7);

  const initialWallets: WalletRecord[] = DEFAULT_WALLETS.map((name, idx) => {
    const defaultBalances: Record<string, number> = {
      Cash: 185000,
      KPay: 420000,
      'AYA Pay': 95000,
      'AYA Bank': 850000,
      'Virtual Visa': 120000,
      'AYA Credit Card': 240000,
    };
    return {
      id: generateUUID(),
      telegram_id,
      name,
      balance_mmk: defaultBalances[name] ?? 0,
      is_credit: name === 'AYA Credit Card',
      sort_order: idx,
    };
  });

  const pairId = generateUUID();
  const initialTransactions: TransactionRecord[] = [
    {
      id: generateUUID(),
      telegram_id,
      tx_date: todayISO,
      description: 'မနက်စာ မုန့်ဟင်းခါး နှင့် လက်ဖက်ရည်',
      type: 'expense',
      wallet: 'Cash',
      amount_mmk: -6500,
      created_at: new Date(Date.now() - 3600 * 1000 * 3).toISOString(),
    },
    {
      id: generateUUID(),
      telegram_id,
      tx_date: todayISO,
      description: 'AYA Bank ကနေ KPay ကို လွှဲ (Debit)',
      type: 'transfer',
      wallet: 'AYA Bank',
      amount_mmk: -100000,
      transfer_pair_id: pairId,
      created_at: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
    },
    {
      id: generateUUID(),
      telegram_id,
      tx_date: todayISO,
      description: 'AYA Bank ကနေ KPay ကို လွှဲ (Credit)',
      type: 'transfer',
      wallet: 'KPay',
      amount_mmk: 100000,
      transfer_pair_id: pairId,
      created_at: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
    },
    {
      id: generateUUID(),
      telegram_id,
      tx_date: yesterdayISO,
      description: 'လစာ ၁၄သိန်း ရပြီ',
      type: 'income',
      wallet: 'AYA Bank',
      amount_mmk: 1400000,
      created_at: new Date(Date.now() - 86400 * 1000).toISOString(),
    },
    {
      id: generateUUID(),
      telegram_id,
      tx_date: yesterdayISO,
      description: 'ညစာ ထမင်းဖိုး (KPay)',
      type: 'expense',
      wallet: 'KPay',
      amount_mmk: -18000,
      created_at: new Date(Date.now() - 82000 * 1000).toISOString(),
    },
  ];

  const initialTodos: MonthlyTodoRecord[] = [
    {
      id: generateUUID(),
      telegram_id,
      title: 'အိမ်လခ နှင့် မီတာခ (Rent & Utilities)',
      target_mmk: 350000,
      done_mmk: 350000,
      month_label: currentMonth,
      is_archived: false,
      created_at: new Date().toISOString(),
    },
    {
      id: generateUUID(),
      telegram_id,
      title: 'မိဘထောက်ပံ့ငွေ (Parents Support)',
      target_mmk: 200000,
      done_mmk: 100000,
      month_label: currentMonth,
      is_archived: false,
      created_at: new Date().toISOString(),
    },
    {
      id: generateUUID(),
      telegram_id,
      title: 'AYA Credit Card အကြွေးဆပ်ရန်',
      target_mmk: 240000,
      done_mmk: 0,
      month_label: currentMonth,
      is_archived: false,
      created_at: new Date().toISOString(),
    },
    {
      id: generateUUID(),
      telegram_id,
      title: 'အင်တာနက် Fiber Bill (ပြီးခဲ့သောလ)',
      target_mmk: 65000,
      done_mmk: 65000,
      month_label: '2026-09',
      is_archived: true,
      created_at: new Date(Date.now() - 86400 * 1000 * 30).toISOString(),
    },
  ];

  const initialSnapshot: FinanceStateSnapshot = {
    settings: {
      telegram_id,
      first_name,
      next_payday: getDefaultNextPayday(),
      gemini_api_key: '',
    },
    wallets: initialWallets,
    transactions: initialTransactions,
    dailySummaries: buildDailySummariesFromTransactions(telegram_id, initialTransactions),
    todos: initialTodos,
    isLiveSupabase: false,
  };

  saveLocalStore(telegram_id, initialSnapshot);
  return initialSnapshot;
}

function saveLocalStore(telegram_id: number, snapshot: FinanceStateSnapshot): void {
  if (typeof window !== 'undefined') {
    const key = `${LOCAL_STORAGE_PREFIX}${telegram_id}`;
    snapshot.dailySummaries = buildDailySummariesFromTransactions(
      telegram_id,
      snapshot.transactions
    );
    window.localStorage.setItem(key, JSON.stringify(snapshot));
  }
}

export function buildDailySummariesFromTransactions(
  telegram_id: number,
  transactions: TransactionRecord[]
): DailySummaryRecord[] {
  const byDate = new Map<string, DailySummaryRecord>();

  for (const tx of transactions) {
    const dateKey = tx.tx_date;
    let rec = byDate.get(dateKey);
    if (!rec) {
      rec = {
        telegram_id,
        tx_date: dateKey,
        net_total_mmk: 0,
        pure_spent_mmk: 0,
        total_income_mmk: 0,
        tx_count: 0,
      };
      byDate.set(dateKey, rec);
    }

    const amt = Number(tx.amount_mmk || 0);
    rec.net_total_mmk += amt;
    if (tx.type === 'expense' || tx.type === 'todo_pay') {
      rec.pure_spent_mmk += Math.abs(amt);
    } else if (tx.type === 'income') {
      rec.total_income_mmk += Math.abs(amt);
    }
    rec.tx_count += 1;
  }

  return Array.from(byDate.values()).sort((a, b) => b.tx_date.localeCompare(a.tx_date));
}

// ============================================================================
// Unified Data Operations (Supabase PostgreSQL + Local Fallback)
// ============================================================================

export async function fetchFinanceSnapshot(
  telegram_id: number,
  first_name: string
): Promise<FinanceStateSnapshot> {
  if (!isSupabaseConfigured || !supabase) {
    return getLocalStore(telegram_id, first_name);
  }

  try {
    // 1. Ensure user_settings row exists
    const { data: existingSettings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('telegram_id', telegram_id)
      .maybeSingle();

    let settings: UserSettings;
    if (!existingSettings) {
      const defaultSettings: UserSettings = {
        telegram_id,
        first_name,
        next_payday: getDefaultNextPayday(),
        gemini_api_key: null,
      };
      const { data: insertedSettings } = await supabase
        .from('user_settings')
        .upsert(defaultSettings)
        .select('*')
        .single();
      settings = (insertedSettings as UserSettings) ?? defaultSettings;
    } else {
      settings = existingSettings as UserSettings;
    }

    // 2. Fetch or seed 6 default wallets
    const { data: existingWallets } = await supabase
      .from('wallets')
      .select('*')
      .eq('telegram_id', telegram_id)
      .order('sort_order', { ascending: true });

    let wallets: WalletRecord[] = (existingWallets as WalletRecord[]) ?? [];
    if (wallets.length === 0) {
      const seedWallets = DEFAULT_WALLETS.map((name, idx) => ({
        telegram_id,
        name,
        balance_mmk: 0,
        is_credit: name === 'AYA Credit Card',
        sort_order: idx,
      }));
      const { data: insertedWallets } = await supabase
        .from('wallets')
        .upsert(seedWallets, { onConflict: 'telegram_id,name' })
        .select('*')
        .order('sort_order', { ascending: true });
      wallets = (insertedWallets as WalletRecord[]) ?? [];
    }

    // 3. Fetch transactions
    const { data: txData } = await supabase
      .from('transactions')
      .select('*')
      .eq('telegram_id', telegram_id)
      .order('tx_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    const transactions: TransactionRecord[] = (txData as TransactionRecord[]) ?? [];

    // 4. Fetch from `daily_summary` view
    const { data: summaryData } = await supabase
      .from('daily_summary')
      .select('*')
      .eq('telegram_id', telegram_id)
      .order('tx_date', { ascending: false })
      .limit(60);
    const dailySummaries: DailySummaryRecord[] =
      summaryData && summaryData.length > 0
        ? (summaryData as DailySummaryRecord[])
        : buildDailySummariesFromTransactions(telegram_id, transactions);

    // 5. Fetch monthly_todos
    const { data: todoData } = await supabase
      .from('monthly_todos')
      .select('*')
      .eq('telegram_id', telegram_id)
      .order('created_at', { ascending: true });
    const todos: MonthlyTodoRecord[] = (todoData as MonthlyTodoRecord[]) ?? [];

    return {
      settings,
      wallets,
      transactions,
      dailySummaries,
      todos,
      isLiveSupabase: true,
    };
  } catch {
    return getLocalStore(telegram_id, first_name);
  }
}

export async function updateWalletBalance(
  telegram_id: number,
  first_name: string,
  walletId: string,
  newBalanceMmk: number
): Promise<FinanceStateSnapshot> {
  if (isSupabaseConfigured && supabase) {
    await supabase
      .from('wallets')
      .update({ balance_mmk: Math.round(newBalanceMmk) })
      .eq('id', walletId)
      .eq('telegram_id', telegram_id);
    return fetchFinanceSnapshot(telegram_id, first_name);
  }

  const store = getLocalStore(telegram_id, first_name);
  store.wallets = store.wallets.map((w) =>
    w.id === walletId ? { ...w, balance_mmk: Math.round(newBalanceMmk) } : w
  );
  saveLocalStore(telegram_id, store);
  return { ...store };
}

export async function addOrRenameWallet(
  telegram_id: number,
  first_name: string,
  options: { walletId?: string; name: string; balance_mmk?: number; is_credit?: boolean }
): Promise<FinanceStateSnapshot> {
  const cleanName = options.name.trim();
  if (!cleanName) return fetchFinanceSnapshot(telegram_id, first_name);

  if (isSupabaseConfigured && supabase) {
    if (options.walletId) {
      const { data: oldWallet } = await supabase
        .from('wallets')
        .select('name')
        .eq('id', options.walletId)
        .eq('telegram_id', telegram_id)
        .maybeSingle();

      await supabase
        .from('wallets')
        .update({ name: cleanName, is_credit: Boolean(options.is_credit) })
        .eq('id', options.walletId)
        .eq('telegram_id', telegram_id);

      if (oldWallet?.name && oldWallet.name !== cleanName) {
        await supabase
          .from('transactions')
          .update({ wallet: cleanName })
          .eq('telegram_id', telegram_id)
          .eq('wallet', oldWallet.name);
      }
    } else {
      await supabase.from('wallets').upsert(
        {
          telegram_id,
          name: cleanName,
          balance_mmk: Math.round(options.balance_mmk ?? 0),
          is_credit: Boolean(options.is_credit),
          sort_order: 10,
        },
        { onConflict: 'telegram_id,name' }
      );
    }
    return fetchFinanceSnapshot(telegram_id, first_name);
  }

  const store = getLocalStore(telegram_id, first_name);
  if (options.walletId) {
    const old = store.wallets.find((w) => w.id === options.walletId);
    const oldName = old?.name;
    store.wallets = store.wallets.map((w) =>
      w.id === options.walletId
        ? { ...w, name: cleanName, is_credit: Boolean(options.is_credit ?? w.is_credit) }
        : w
    );
    if (oldName && oldName !== cleanName) {
      store.transactions = store.transactions.map((tx) =>
        tx.wallet === oldName ? { ...tx, wallet: cleanName } : tx
      );
    }
  } else {
    store.wallets.push({
      id: generateUUID(),
      telegram_id,
      name: cleanName,
      balance_mmk: Math.round(options.balance_mmk ?? 0),
      is_credit: Boolean(options.is_credit),
      sort_order: store.wallets.length,
    });
  }
  saveLocalStore(telegram_id, store);
  return { ...store };
}

export async function updateUserSettings(
  telegram_id: number,
  first_name: string,
  updates: Partial<Pick<UserSettings, 'next_payday' | 'gemini_api_key'>>
): Promise<FinanceStateSnapshot> {
  if (isSupabaseConfigured && supabase) {
    await supabase
      .from('user_settings')
      .upsert({
        telegram_id,
        first_name,
        ...updates,
        updated_at: new Date().toISOString(),
      });
    return fetchFinanceSnapshot(telegram_id, first_name);
  }

  const store = getLocalStore(telegram_id, first_name);
  store.settings = {
    ...store.settings,
    ...updates,
  };
  saveLocalStore(telegram_id, store);
  return { ...store };
}

/**
 * 1-tap Undo (ဖျက်မယ်): Reverses wallet balance and deletes both rows if `transfer_pair_id` is present.
 */
export async function undoTransaction(
  telegram_id: number,
  first_name: string,
  tx: TransactionRecord
): Promise<FinanceStateSnapshot> {
  if (isSupabaseConfigured && supabase) {
    if (tx.transfer_pair_id) {
      const { data: pairRows } = await supabase
        .from('transactions')
        .select('*')
        .eq('telegram_id', telegram_id)
        .eq('transfer_pair_id', tx.transfer_pair_id);

      const rowsToUndo = (pairRows as TransactionRecord[]) ?? [tx];
      for (const row of rowsToUndo) {
        const { data: w } = await supabase
          .from('wallets')
          .select('id, balance_mmk')
          .eq('telegram_id', telegram_id)
          .eq('name', row.wallet)
          .maybeSingle();
        if (w) {
          await supabase
            .from('wallets')
            .update({ balance_mmk: Number(w.balance_mmk) - Number(row.amount_mmk) })
            .eq('id', w.id);
        }
      }

      await supabase
        .from('transactions')
        .delete()
        .eq('telegram_id', telegram_id)
        .eq('transfer_pair_id', tx.transfer_pair_id);
    } else {
      const { data: w } = await supabase
        .from('wallets')
        .select('id, balance_mmk')
        .eq('telegram_id', telegram_id)
        .eq('name', tx.wallet)
        .maybeSingle();

      if (w) {
        await supabase
          .from('wallets')
          .update({ balance_mmk: Number(w.balance_mmk) - Number(tx.amount_mmk) })
          .eq('id', w.id);
      }

      if (tx.type === 'todo_pay' && tx.todo_id) {
        const { data: todo } = await supabase
          .from('monthly_todos')
          .select('id, done_mmk')
          .eq('id', tx.todo_id)
          .maybeSingle();
        if (todo) {
          await supabase
            .from('monthly_todos')
            .update({ done_mmk: Math.max(0, Number(todo.done_mmk) - Math.abs(tx.amount_mmk)) })
            .eq('id', todo.id);
        }
      }

      await supabase
        .from('transactions')
        .delete()
        .eq('id', tx.id)
        .eq('telegram_id', telegram_id);
    }

    return fetchFinanceSnapshot(telegram_id, first_name);
  }

  const store = getLocalStore(telegram_id, first_name);
  if (tx.transfer_pair_id) {
    const pairRows = store.transactions.filter(
      (r) => r.transfer_pair_id === tx.transfer_pair_id
    );
    for (const row of pairRows) {
      store.wallets = store.wallets.map((w) =>
        w.name === row.wallet
          ? { ...w, balance_mmk: Number(w.balance_mmk) - Number(row.amount_mmk) }
          : w
      );
    }
    store.transactions = store.transactions.filter(
      (r) => r.transfer_pair_id !== tx.transfer_pair_id
    );
  } else {
    store.wallets = store.wallets.map((w) =>
      w.name === tx.wallet
        ? { ...w, balance_mmk: Number(w.balance_mmk) - Number(tx.amount_mmk) }
        : w
    );
    if (tx.type === 'todo_pay' && tx.todo_id) {
      store.todos = store.todos.map((t) =>
        t.id === tx.todo_id
          ? { ...t, done_mmk: Math.max(0, Number(t.done_mmk) - Math.abs(tx.amount_mmk)) }
          : t
      );
    }
    store.transactions = store.transactions.filter((r) => r.id !== tx.id);
  }

  saveLocalStore(telegram_id, store);
  return { ...store };
}

export async function addMonthlyTodo(
  telegram_id: number,
  first_name: string,
  title: string,
  target_mmk: number
): Promise<FinanceStateSnapshot> {
  const month_label = getMyanmarDateISO(0).slice(0, 7);
  if (isSupabaseConfigured && supabase) {
    await supabase.from('monthly_todos').insert({
      telegram_id,
      title: title.trim(),
      target_mmk: Math.round(target_mmk),
      done_mmk: 0,
      month_label,
      is_archived: false,
    });
    return fetchFinanceSnapshot(telegram_id, first_name);
  }

  const store = getLocalStore(telegram_id, first_name);
  store.todos.push({
    id: generateUUID(),
    telegram_id,
    title: title.trim(),
    target_mmk: Math.round(target_mmk),
    done_mmk: 0,
    month_label,
    is_archived: false,
    created_at: new Date().toISOString(),
  });
  saveLocalStore(telegram_id, store);
  return { ...store };
}

export async function payMonthlyTodo(
  telegram_id: number,
  first_name: string,
  todoId: string,
  payAmountMmk: number,
  walletName = 'Cash'
): Promise<FinanceStateSnapshot> {
  const amount = Math.abs(Math.round(payAmountMmk));
  if (amount <= 0) return fetchFinanceSnapshot(telegram_id, first_name);
  const todayISO = getMyanmarDateISO(0);

  if (isSupabaseConfigured && supabase) {
    const { data: todo } = await supabase
      .from('monthly_todos')
      .select('*')
      .eq('id', todoId)
      .eq('telegram_id', telegram_id)
      .maybeSingle();

    if (todo) {
      await supabase
        .from('monthly_todos')
        .update({ done_mmk: Number(todo.done_mmk || 0) + amount })
        .eq('id', todoId);

      await supabase.from('transactions').insert({
        telegram_id,
        tx_date: todayISO,
        description: `TODO ပေးချေမှု: ${todo.title}`,
        type: 'todo_pay',
        wallet: walletName,
        amount_mmk: -amount,
        todo_id: todoId,
      });

      const { data: wallet } = await supabase
        .from('wallets')
        .select('id, balance_mmk')
        .eq('telegram_id', telegram_id)
        .eq('name', walletName)
        .maybeSingle();

      if (wallet) {
        await supabase
          .from('wallets')
          .update({ balance_mmk: Number(wallet.balance_mmk) - amount })
          .eq('id', wallet.id);
      }
    }

    return fetchFinanceSnapshot(telegram_id, first_name);
  }

  const store = getLocalStore(telegram_id, first_name);
  const targetTodo = store.todos.find((t) => t.id === todoId);
  if (targetTodo) {
    targetTodo.done_mmk = Number(targetTodo.done_mmk || 0) + amount;
    store.wallets = store.wallets.map((w) =>
      w.name === walletName ? { ...w, balance_mmk: Number(w.balance_mmk) - amount } : w
    );
    store.transactions.unshift({
      id: generateUUID(),
      telegram_id,
      tx_date: todayISO,
      description: `TODO ပေးချေမှု: ${targetTodo.title}`,
      type: 'todo_pay',
      wallet: walletName,
      amount_mmk: -amount,
      todo_id: todoId,
      created_at: new Date().toISOString(),
    });
  }
  saveLocalStore(telegram_id, store);
  return { ...store };
}

export async function archiveAndStartNewMonth(
  telegram_id: number,
  first_name: string,
  cloneTemplatesForNewMonth = false
): Promise<FinanceStateSnapshot> {
  const nextMonthLabel = getMyanmarDateISO(0).slice(0, 7);

  if (isSupabaseConfigured && supabase) {
    const { data: activeTodos } = await supabase
      .from('monthly_todos')
      .select('*')
      .eq('telegram_id', telegram_id)
      .eq('is_archived', false);

    await supabase
      .from('monthly_todos')
      .update({ is_archived: true })
      .eq('telegram_id', telegram_id)
      .eq('is_archived', false);

    if (cloneTemplatesForNewMonth && activeTodos && activeTodos.length > 0) {
      const cloned = activeTodos.map((t: MonthlyTodoRecord) => ({
        telegram_id,
        title: t.title,
        target_mmk: t.target_mmk,
        done_mmk: 0,
        month_label: nextMonthLabel,
        is_archived: false,
      }));
      await supabase.from('monthly_todos').insert(cloned);
    }

    return fetchFinanceSnapshot(telegram_id, first_name);
  }

  const store = getLocalStore(telegram_id, first_name);
  const activeTodos = store.todos.filter((t) => !t.is_archived);
  store.todos = store.todos.map((t) =>
    t.is_archived ? t : { ...t, is_archived: true }
  );

  if (cloneTemplatesForNewMonth && activeTodos.length > 0) {
    for (const t of activeTodos) {
      store.todos.push({
        id: generateUUID(),
        telegram_id,
        title: t.title,
        target_mmk: t.target_mmk,
        done_mmk: 0,
        month_label: nextMonthLabel,
        is_archived: false,
        created_at: new Date().toISOString(),
      });
    }
  }

  saveLocalStore(telegram_id, store);
  return { ...store };
}

/**
 * Executes a natural-language Burmese input via `burmeseParser` and persists changes.
 */
export async function executeBurmeseQuickLog(
  telegram_id: number,
  first_name: string,
  rawText: string,
  currentSnapshot: FinanceStateSnapshot
): Promise<{ result: CommandExecutionResult; snapshot: FinanceStateSnapshot }> {
  const customWalletNames = currentSnapshot.wallets.map((w) => w.name);
  const parsed = parseBurmeseFinanceInput(rawText, customWalletNames);
  const todayISO = getMyanmarDateISO(0);

  // 1. Handle `date_summary`
  if (parsed.type === 'date_summary') {
    const targetDate = parsed.summaryDateISO ?? todayISO;
    const summaryRow = currentSnapshot.dailySummaries.find((d) => d.tx_date === targetDate);
    const pureSpent = summaryRow?.pure_spent_mmk ?? 0;
    const netTotal = summaryRow?.net_total_mmk ?? 0;
    const label = parsed.summaryDateOffset === -1 ? 'မနေ့က' : 'ဒီနေ့';
    return {
      result: {
        parsed,
        mutated: false,
        message: `📊 ${label} (${targetDate}) စာရင်းချုပ် — သုံးစွဲငွေသီးသန့် (Pure Spent): ${pureSpent.toLocaleString()} MMK | အသားတင် (Net Total): ${
          netTotal >= 0 ? '+' : ''
        }${netTotal.toLocaleString()} MMK`,
      },
      snapshot: currentSnapshot,
    };
  }

  // 2. Handle `advice_only`
  if (parsed.type === 'advice_only') {
    const context = computeSafeToSpendMetrics(
      currentSnapshot.wallets,
      currentSnapshot.settings.next_payday
    );
    const apiKey =
      currentSnapshot.settings.gemini_api_key ||
      (import.meta.env.VITE_GEMINI_API_KEY as string | undefined);
    const advice = await getGeminiFinancialAdvice(
      parsed.rawText,
      parsed.amount,
      context,
      apiKey
    );
    return {
      result: {
        parsed,
        mutated: false,
        message: advice,
        aiAdvice: advice,
      },
      snapshot: currentSnapshot,
    };
  }

  // 3. Handle `todo_add`
  if (parsed.type === 'todo_add') {
    const title = parsed.todoTitle || parsed.description || 'လစဉ်ပေးရန်';
    const nextSnap = await addMonthlyTodo(
      telegram_id,
      first_name,
      title,
      parsed.amount
    );
    return {
      result: {
        parsed,
        mutated: true,
        message: `✅ လစဉ် TODO အသစ်ထည့်ပြီးပါပြီ: "${title}" (${parsed.amount.toLocaleString()} MMK)`,
      },
      snapshot: nextSnap,
    };
  }

  // 4. Handle `todo_update`
  if (parsed.type === 'todo_update') {
    const activeTodos = currentSnapshot.todos.filter((t) => !t.is_archived);
    const matchedTodo =
      activeTodos.find((t) =>
        parsed.rawText.toLowerCase().includes(t.title.toLowerCase().split(' ')[0])
      ) ?? activeTodos[0];

    if (matchedTodo && parsed.amount > 0) {
      if (isSupabaseConfigured && supabase) {
        await supabase
          .from('monthly_todos')
          .update({ target_mmk: parsed.amount })
          .eq('id', matchedTodo.id);
      } else {
        const store = getLocalStore(telegram_id, first_name);
        store.todos = store.todos.map((t) =>
          t.id === matchedTodo.id ? { ...t, target_mmk: parsed.amount } : t
        );
        saveLocalStore(telegram_id, store);
      }
      const nextSnap = await fetchFinanceSnapshot(telegram_id, first_name);
      return {
        result: {
          parsed,
          mutated: true,
          message: `✏️ TODO "${matchedTodo.title}" ၏ Target ပမာဏကို ${parsed.amount.toLocaleString()} MMK သို့ ပြင်ဆင်ပြီးပါပြီ။`,
        },
        snapshot: nextSnap,
      };
    }
  }

  // 5. Handle `todo_pay`
  if (parsed.type === 'todo_pay') {
    const activeTodos = currentSnapshot.todos.filter((t) => !t.is_archived);
    const matchedTodo =
      activeTodos.find((t) =>
        parsed.rawText.toLowerCase().includes(t.title.toLowerCase().split(' ')[0])
      ) ?? activeTodos.find((t) => t.done_mmk < t.target_mmk) ?? activeTodos[0];

    if (matchedTodo) {
      const payAmt =
        parsed.amount > 0
          ? parsed.amount
          : Math.max(0, matchedTodo.target_mmk - matchedTodo.done_mmk);
      const nextSnap = await payMonthlyTodo(
        telegram_id,
        first_name,
        matchedTodo.id,
        payAmt,
        parsed.wallet
      );
      return {
        result: {
          parsed,
          mutated: true,
          message: `✅ TODO "${matchedTodo.title}" အတွက် ${payAmt.toLocaleString()} MMK (${parsed.wallet}) ပေးချေပြီးပါပြီ။`,
        },
        snapshot: nextSnap,
      };
    }
  }

  // 6. Handle `transfer` (insert TWO rows in `transactions` sharing a `transfer_pair_id`: `-amount` and `+amount`)
  if (parsed.type === 'transfer') {
    const amount = Math.abs(parsed.amount);
    const fromWallet = parsed.fromWallet ?? 'KPay';
    const toWallet = parsed.toWallet ?? 'Cash';
    const transferPairId = generateUUID();

    if (isSupabaseConfigured && supabase) {
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
        const { data: w } = await supabase
          .from('wallets')
          .select('id, balance_mmk')
          .eq('telegram_id', telegram_id)
          .eq('name', wName)
          .maybeSingle();
        if (w) {
          await supabase
            .from('wallets')
            .update({ balance_mmk: Number(w.balance_mmk) + delta })
            .eq('id', w.id);
        }
      }

      const nextSnap = await fetchFinanceSnapshot(telegram_id, first_name);
      return {
        result: {
          parsed,
          mutated: true,
          message: `🔄 ${fromWallet} မှ ${toWallet} သို့ ${amount.toLocaleString()} MMK လွှဲပြောင်းမှတ်တမ်းတင်ပြီးပါပြီ (၂ ကြောင်း: -${amount.toLocaleString()} / +${amount.toLocaleString()})။`,
        },
        snapshot: nextSnap,
      };
    }

    const store = getLocalStore(telegram_id, first_name);
    const nowISO = new Date().toISOString();
    store.transactions.unshift(
      {
        id: generateUUID(),
        telegram_id,
        tx_date: todayISO,
        description: `${fromWallet} → ${toWallet} လွှဲပြောင်းငွေ (${parsed.rawText})`,
        type: 'transfer',
        wallet: fromWallet,
        amount_mmk: -amount,
        transfer_pair_id: transferPairId,
        created_at: nowISO,
      },
      {
        id: generateUUID(),
        telegram_id,
        tx_date: todayISO,
        description: `${fromWallet} → ${toWallet} လက်ခံငွေ (${parsed.rawText})`,
        type: 'transfer',
        wallet: toWallet,
        amount_mmk: amount,
        transfer_pair_id: transferPairId,
        created_at: nowISO,
      }
    );

    store.wallets = store.wallets.map((w) => {
      if (w.name === fromWallet) {
        return { ...w, balance_mmk: Number(w.balance_mmk) - amount };
      }
      if (w.name === toWallet) {
        return { ...w, balance_mmk: Number(w.balance_mmk) + amount };
      }
      return w;
    });

    saveLocalStore(telegram_id, store);
    return {
      result: {
        parsed,
        mutated: true,
        message: `🔄 ${fromWallet} မှ ${toWallet} သို့ ${amount.toLocaleString()} MMK လွှဲပြောင်းမှတ်တမ်းတင်ပြီးပါပြီ (၂ ကြောင်း: -${amount.toLocaleString()} / +${amount.toLocaleString()})။`,
      },
      snapshot: { ...store },
    };
  }

  // 7. Handle `income` or `expense`
  const isIncome = parsed.type === 'income';
  const signedAmount = isIncome ? Math.abs(parsed.amount) : -Math.abs(parsed.amount);
  const walletName = parsed.wallet || 'Cash';

  if (isSupabaseConfigured && supabase) {
    await supabase.from('transactions').insert({
      telegram_id,
      tx_date: todayISO,
      description: parsed.rawText,
      type: isIncome ? 'income' : 'expense',
      wallet: walletName,
      amount_mmk: signedAmount,
    });

    const { data: w } = await supabase
      .from('wallets')
      .select('id, balance_mmk')
      .eq('telegram_id', telegram_id)
      .eq('name', walletName)
      .maybeSingle();

    if (w) {
      await supabase
        .from('wallets')
        .update({ balance_mmk: Number(w.balance_mmk) + signedAmount })
        .eq('id', w.id);
    }

    const nextSnap = await fetchFinanceSnapshot(telegram_id, first_name);
    return {
      result: {
        parsed,
        mutated: true,
        message: isIncome
          ? `💰 ဝင်ငွေ +${Math.abs(parsed.amount).toLocaleString()} MMK (${walletName}) မှတ်တမ်းတင်ပြီးပါပြီ!`
          : `💸 အသုံးစရိတ် -${Math.abs(parsed.amount).toLocaleString()} MMK (${walletName}) မှတ်တမ်းတင်ပြီးပါပြီ!`,
      },
      snapshot: nextSnap,
    };
  }

  const store = getLocalStore(telegram_id, first_name);
  store.transactions.unshift({
    id: generateUUID(),
    telegram_id,
    tx_date: todayISO,
    description: parsed.rawText,
    type: isIncome ? 'income' : 'expense',
    wallet: walletName,
    amount_mmk: signedAmount,
    created_at: new Date().toISOString(),
  });

  store.wallets = store.wallets.map((w) =>
    w.name === walletName
      ? { ...w, balance_mmk: Number(w.balance_mmk) + signedAmount }
      : w
  );

  saveLocalStore(telegram_id, store);
  return {
    result: {
      parsed,
      mutated: true,
      message: isIncome
        ? `💰 ဝင်ငွေ +${Math.abs(parsed.amount).toLocaleString()} MMK (${walletName}) မှတ်တမ်းတင်ပြီးပါပြီ!`
        : `💸 အသုံးစရိတ် -${Math.abs(parsed.amount).toLocaleString()} MMK (${walletName}) မှတ်တမ်းတင်ပြီးပါပြီ!`,
    },
    snapshot: { ...store },
  };
}

