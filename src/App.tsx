import React, { useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  Calendar,
  CheckSquare,
  Settings,
  Send,
  Mic,
  MicOff,
  Edit3,
  RotateCcw,
  Plus,
  Archive,
  Sparkles,
  ArrowRightLeft,
  TrendingUp,
  TrendingDown,
  CreditCard,
  ShieldCheck,
  Clock,
  KeyRound,
  UserCheck,
  X,
  CheckCircle2,
  AlertCircle,
  History,
} from 'lucide-react';
import {
  getTelegramUser,
  initTelegramWebApp,
  triggerHaptic,
} from './lib/telegram';
import {
  addMonthlyTodo,
  addOrRenameWallet,
  archiveAndStartNewMonth,
  computeSafeToSpendMetrics,
  executeBurmeseQuickLog,
  fetchFinanceSnapshot,
  FinanceStateSnapshot,
  MonthlyTodoRecord,
  payMonthlyTodo,
  TransactionRecord,
  undoTransaction,
  updateUserSettings,
  updateWalletBalance,
  WalletRecord,
} from './lib/financeService';
import {
  getMyanmarDateISO,
  parseBurmeseFinanceInput,
} from './lib/burmeseParser';

type TabKey = 'home' | 'summary' | 'todos' | 'settings';

const QUICK_EXAMPLES = [
  'ထမင်းဖိုး ၁၀၀၀၀ KPay',
  'လစာ ၁၄သိန်း AYA Bank ရပြီ',
  'AYA Bank ကနေ KPay ကို ၁သိန်းခွဲ လွှဲလိုက်တယ်',
  'ဒီနေ့ဘယ်လောက်သုံးထားလဲ',
  'ဖိနပ် ၅သောင်းတန် ဝယ်သင့်လား',
];

export default function App() {
  const tgUser = useMemo(() => getTelegramUser(), []);
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [snapshot, setSnapshot] = useState<FinanceStateSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Quick-Log Bar state
  const [quickInput, setQuickInput] = useState<string>('');
  const [submittingLog, setSubmittingLog] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'info' | 'advice';
    text: string;
  } | null>(null);

  // Tab 1: Edit Wallet Balance Modal state
  const [editingWallet, setEditingWallet] = useState<WalletRecord | null>(null);
  const [editBalanceInput, setEditBalanceInput] = useState<string>('');

  // Tab 2: Selected Date filter for Daily Summary & Transactions
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('ALL');

  // Tab 3: Monthly TODO modals
  const [showAddTodoModal, setShowAddTodoModal] = useState<boolean>(false);
  const [newTodoTitle, setNewTodoTitle] = useState<string>('');
  const [newTodoTarget, setNewTodoTarget] = useState<string>('');
  const [payingTodo, setPayingTodo] = useState<MonthlyTodoRecord | null>(null);
  const [payTodoAmount, setPayTodoAmount] = useState<string>('');
  const [payTodoWallet, setPayTodoWallet] = useState<string>('Cash');
  const [cloneOnArchive, setCloneOnArchive] = useState<boolean>(true);

  // Tab 4: Settings & Custom Wallets state
  const [paydayInput, setPaydayInput] = useState<string>('');
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>('');
  const [customWalletModal, setCustomWalletModal] = useState<{
    mode: 'add' | 'rename';
    walletId?: string;
    name: string;
    balance: string;
    isCredit: boolean;
  } | null>(null);

  useEffect(() => {
    initTelegramWebApp();
    let mounted = true;
    fetchFinanceSnapshot(tgUser.telegram_id, tgUser.first_name).then((snap) => {
      if (!mounted) return;
      setSnapshot(snap);
      setPaydayInput(snap.settings.next_payday);
      setGeminiKeyInput(snap.settings.gemini_api_key || '');
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [tgUser.telegram_id, tgUser.first_name]);

  const safeMetrics = useMemo(() => {
    if (!snapshot) {
      return {
        safeToSpendToday: 0,
        totalLiquidMmk: 0,
        daysUntilPayday: 1,
        nextPayday: getMyanmarDateISO(10),
        creditCardDebtMmk: 0,
      };
    }
    return computeSafeToSpendMetrics(snapshot.wallets, snapshot.settings.next_payday);
  }, [snapshot]);

  const livePreview = useMemo(() => {
    if (!quickInput.trim() || !snapshot) return null;
    return parseBurmeseFinanceInput(
      quickInput,
      snapshot.wallets.map((w) => w.name)
    );
  }, [quickInput, snapshot]);

  async function handleQuickLogSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!quickInput.trim() || !snapshot || submittingLog) return;

    setSubmittingLog(true);
    try {
      const { result, snapshot: updated } = await executeBurmeseQuickLog(
        tgUser.telegram_id,
        tgUser.first_name,
        quickInput,
        snapshot
      );
      setSnapshot(updated);
      setFeedbackBanner({
        type:
          result.parsed.type === 'advice_only'
            ? 'advice'
            : result.mutated
            ? 'success'
            : 'info',
        text: result.message,
      });
      triggerHaptic('success');
      if (result.mutated) {
        setQuickInput('');
      }
    } finally {
      setSubmittingLog(false);
    }
  }

  function handleVoiceToggle() {
    const SpeechRecognitionAPI =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setFeedbackBanner({
        type: 'info',
        text: 'သင့် Browser တွင် မြန်မာအသံဖမ်းစနစ် (Web Speech API) မပံ့ပိုးသေးပါ။ စာရိုက်ထည့်သွင်းနိုင်ပါသည်။',
      });
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recognition = new (SpeechRecognitionAPI as any)();
      recognition.lang = 'my-MM';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      setIsListening(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setQuickInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
        setIsListening(false);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
    } catch {
      setIsListening(false);
    }
  }

  async function handleSaveWalletBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!editingWallet) return;
    const parsedAmt =
      parseBurmeseFinanceInput(editBalanceInput).amount ||
      Number(editBalanceInput.replace(/,/g, '')) ||
      0;

    const updated = await updateWalletBalance(
      tgUser.telegram_id,
      tgUser.first_name,
      editingWallet.id,
      parsedAmt
    );
    setSnapshot(updated);
    setEditingWallet(null);
    triggerHaptic('success');
    setFeedbackBanner({
      type: 'success',
      text: `✅ ${editingWallet.name} လက်ကျန်ငွေကို ${parsedAmt.toLocaleString()} MMK သို့ ပြောင်းလဲပြီးပါပြီ။`,
    });
  }

  async function handleUndoTransaction(tx: TransactionRecord) {
    const updated = await undoTransaction(tgUser.telegram_id, tgUser.first_name, tx);
    setSnapshot(updated);
    triggerHaptic('warning');
    setFeedbackBanner({
      type: 'info',
      text: tx.transfer_pair_id
        ? `↩️ လွှဲပြောင်းငွေ (၂ ကြောင်းလုံး) ကို ပြန်ဖျက်ပြီး ပိုက်ဆံအိတ်လက်ကျန် ပြန်ပေါင်းပေးပြီးပါပြီ။`
        : `↩️ "${tx.description}" (${Math.abs(tx.amount_mmk).toLocaleString()} MMK) ကို ပြန်ဖျက်ပြီးပါပြီ။`,
    });
  }

  async function handleAddTodoSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newTodoTitle.trim()) return;
    const targetAmt =
      parseBurmeseFinanceInput(newTodoTarget).amount ||
      Number(newTodoTarget.replace(/,/g, '')) ||
      0;
    const updated = await addMonthlyTodo(
      tgUser.telegram_id,
      tgUser.first_name,
      newTodoTitle,
      targetAmt
    );
    setSnapshot(updated);
    setNewTodoTitle('');
    setNewTodoTarget('');
    setShowAddTodoModal(false);
    triggerHaptic('success');
  }

  async function handlePayTodoSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!payingTodo) return;
    const amt =
      parseBurmeseFinanceInput(payTodoAmount).amount ||
      Number(payTodoAmount.replace(/,/g, '')) ||
      0;
    if (amt <= 0) return;

    const updated = await payMonthlyTodo(
      tgUser.telegram_id,
      tgUser.first_name,
      payingTodo.id,
      amt,
      payTodoWallet
    );
    setSnapshot(updated);
    setPayingTodo(null);
    triggerHaptic('success');
    setFeedbackBanner({
      type: 'success',
      text: `✅ "${payingTodo.title}" အတွက် ${amt.toLocaleString()} MMK (${payTodoWallet}) ပေးချေပြီးပါပြီ။`,
    });
  }

  async function handleArchiveMonth() {
    const updated = await archiveAndStartNewMonth(
      tgUser.telegram_id,
      tgUser.first_name,
      cloneOnArchive
    );
    setSnapshot(updated);
    triggerHaptic('success');
    setFeedbackBanner({
      type: 'info',
      text: '📦 ယခုလ TODO စာရင်းများကို History သို့ သိမ်းဆည်းပြီး လအသစ် စတင်ပြီးပါပြီ။',
    });
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    const updated = await updateUserSettings(tgUser.telegram_id, tgUser.first_name, {
      next_payday: paydayInput,
      gemini_api_key: geminiKeyInput.trim() || null,
    });
    setSnapshot(updated);
    triggerHaptic('success');
    setFeedbackBanner({
      type: 'success',
      text: '⚙️ Settings နှင့် လစာထုတ်ရက် (Next Payday) ကို သိမ်းဆည်းပြီးပါပြီ။',
    });
  }

  async function handleSaveCustomWallet(e: React.FormEvent) {
    e.preventDefault();
    if (!customWalletModal || !customWalletModal.name.trim()) return;
    const initBal =
      parseBurmeseFinanceInput(customWalletModal.balance).amount ||
      Number(customWalletModal.balance.replace(/,/g, '')) ||
      0;
    const updated = await addOrRenameWallet(tgUser.telegram_id, tgUser.first_name, {
      walletId: customWalletModal.walletId,
      name: customWalletModal.name,
      balance_mmk: initBal,
      is_credit: customWalletModal.isCredit,
    });
    setSnapshot(updated);
    setCustomWalletModal(null);
    triggerHaptic('success');
  }

  if (loading || !snapshot) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center animate-pulse mb-3">
          <Wallet className="w-6 h-6 text-emerald-400" />
        </div>
        <p className="text-sm text-slate-400">MMK Finance Tracker ဖွင့်နေပါသည်...</p>
      </div>
    );
  }

  const activeTodos = snapshot.todos.filter((t) => !t.is_archived);
  const archivedTodos = snapshot.todos.filter((t) => t.is_archived);
  const filteredTransactions =
    selectedDateFilter === 'ALL'
      ? snapshot.transactions
      : snapshot.transactions.filter((tx) => tx.tx_date === selectedDateFilter);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 max-w-md mx-auto border-x border-slate-900 shadow-2xl flex flex-col">
      {/* Top User Header */}
      <header className="px-4 pt-3 pb-2 flex items-center justify-between bg-slate-950/90 backdrop-blur border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-950/50">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-bold text-sm tracking-tight text-white">
                MMK Finance Tracker
              </h1>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium">
                {snapshot.isLiveSupabase ? 'Supabase Live' : 'Local Sync'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <UserCheck className="w-3 h-3 text-emerald-400" />
              {tgUser.first_name} • ID: <code className="text-slate-300">{tgUser.telegram_id}</code>
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
            ယနေ့ရက်စွဲ
          </span>
          <span className="text-xs font-semibold text-slate-200">
            {getMyanmarDateISO(0)}
          </span>
        </div>
      </header>

      {/* Sticky Burmese Voice/Text Quick-Log Bar (Always accessible on Tab 1 & top) */}
      <div className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur-md px-4 py-3 border-b border-slate-800/80 shadow-lg">
        <form onSubmit={handleQuickLogSubmit} className="space-y-2">
          <div className="relative flex items-center gap-1.5">
            <div className="relative flex-1">
              <input
                type="text"
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
                placeholder="ဥပမာ - ထမင်းဖိုး ၁၀၀၀၀ (သို့) လစာ ၁၄သိန်း ရပြီ"
                className="w-full bg-slate-900/90 border border-slate-700/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 rounded-xl pl-3.5 pr-9 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none transition"
              />
              <button
                type="button"
                onClick={handleVoiceToggle}
                title="မြန်မာအသံဖြင့် မှတ်တမ်းတင်ရန်"
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition ${
                  isListening
                    ? 'bg-rose-500/20 text-rose-400 animate-pulse'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="submit"
              disabled={submittingLog || !quickInput.trim()}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-semibold px-3.5 py-2.5 rounded-xl text-sm flex items-center gap-1.5 shadow-md shadow-emerald-950/40 transition shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>မှတ်မယ်</span>
            </button>
          </div>

          {/* Live Burmese Parser Preview Badge */}
          {livePreview && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs">
              <div className="flex items-center gap-1.5">
                <span
                  className={`px-2 py-0.5 rounded font-semibold uppercase text-[10px] ${
                    livePreview.type === 'income'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : livePreview.type === 'transfer'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      : livePreview.type === 'advice_only'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : livePreview.type === 'date_summary'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  {livePreview.type}
                </span>
                <span className="text-slate-300 font-medium">
                  {livePreview.type === 'transfer'
                    ? `${livePreview.fromWallet} → ${livePreview.toWallet}`
                    : livePreview.wallet}
                </span>
              </div>
              <span className="font-bold text-emerald-400">
                {livePreview.amount > 0
                  ? `${livePreview.amount.toLocaleString()} MMK`
                  : livePreview.type === 'date_summary'
                  ? livePreview.summaryDateISO
                  : 'AI တွက်ချက်မည်'}
              </span>
            </div>
          )}

          {/* Quick Sample Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
            {QUICK_EXAMPLES.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setQuickInput(sample)}
                className="text-[11px] bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 px-2.5 py-1 rounded-full whitespace-nowrap transition shrink-0"
              >
                {sample}
              </button>
            ))}
          </div>
        </form>

        {/* Feedback / AI Advice Notification Banner */}
        {feedbackBanner && (
          <div
            className={`mt-2.5 p-3 rounded-xl border text-xs flex items-start justify-between gap-2 ${
              feedbackBanner.type === 'advice'
                ? 'bg-purple-950/60 border-purple-500/40 text-purple-100'
                : feedbackBanner.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-100'
                : 'bg-slate-900 border-slate-700 text-slate-200'
            }`}
          >
            <div className="flex items-start gap-2 leading-relaxed">
              {feedbackBanner.type === 'advice' ? (
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <span>{feedbackBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="text-slate-400 hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-4 space-y-5">
        {/* ===================================================================
            TAB 1: HOME DASHBOARD
        =================================================================== */}
        {activeTab === 'home' && (
          <div className="space-y-5">
            {/* Hero Card: Safe-to-Spend Today (MMK/day) & Days Until Payday */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-700 to-slate-900 p-5 shadow-xl border border-emerald-400/20">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-100/90 bg-black/20 px-2.5 py-1 rounded-full border border-white/10">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                    Safe-to-Spend Today (တစ်နေ့သုံးနိုင်ငွေ)
                  </span>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className="text-3xl font-extrabold tracking-tight text-white">
                      {Math.round(safeMetrics.safeToSpendToday).toLocaleString()}
                    </span>
                    <span className="text-xs font-semibold text-emerald-200">
                      MMK / day
                    </span>
                  </div>
                </div>

                <div className="bg-slate-950/40 backdrop-blur px-3 py-2 rounded-xl border border-white/10 text-right shrink-0">
                  <div className="flex items-center justify-end gap-1 text-[11px] text-emerald-200">
                    <Clock className="w-3 h-3" />
                    <span>Days Until Payday</span>
                  </div>
                  <p className="text-xl font-bold text-white mt-0.5">
                    {safeMetrics.daysUntilPayday}{' '}
                    <span className="text-xs font-normal text-emerald-200">ရက်</span>
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-white/15 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-emerald-100/75 block">
                    Total Liquid Wallets (လက်ကျန်စုစုပေါင်း)
                  </span>
                  <span className="font-bold text-white text-sm">
                    {safeMetrics.totalLiquidMmk.toLocaleString()} MMK
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-emerald-100/75 block">
                    Next Payday (လစာထုတ်ရက်)
                  </span>
                  <span className="font-semibold text-white text-sm">
                    {safeMetrics.nextPayday}
                  </span>
                </div>
              </div>

              <p className="mt-2.5 text-[10px] text-emerald-100/70 font-mono">
                Formula: Total Liquid ({safeMetrics.totalLiquidMmk.toLocaleString()}) ÷ MAX(1,{' '}
                {safeMetrics.daysUntilPayday} days)
              </p>
            </div>

            {/* 2-Column Grid of Wallet Cards */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                  ပိုက်ဆံအိတ်များ (Wallets & Credit Debt)
                </h2>
                <span className="text-[11px] text-slate-400">
                  နှိပ်ပြီး လက်ကျန်ငွေ ပြင်နိုင်သည်
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {snapshot.wallets.map((w) => {
                  const isCreditCard = w.is_credit || w.name === 'AYA Credit Card';
                  const displayName =
                    w.name === 'AYA Credit Card' ? 'Credit Card Debt' : w.name;

                  return (
                    <div
                      key={w.id}
                      onClick={() => {
                        setEditingWallet(w);
                        setEditBalanceInput(String(w.balance_mmk));
                      }}
                      className={`group cursor-pointer rounded-2xl p-3.5 border transition relative overflow-hidden ${
                        isCreditCard
                          ? 'bg-rose-950/25 border-rose-500/30 hover:border-rose-400/60'
                          : 'bg-slate-900/90 border-slate-800 hover:border-emerald-500/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div>
                          <span
                            className={`text-xs font-bold block ${
                              isCreditCard ? 'text-rose-300' : 'text-slate-200'
                            }`}
                          >
                            {displayName}
                          </span>
                          {w.name === 'AYA Credit Card' && (
                            <span className="text-[10px] text-rose-400/80 block">
                              AYA Credit Card
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingWallet(w);
                            setEditBalanceInput(String(w.balance_mmk));
                          }}
                          className="p-1.5 rounded-lg bg-slate-800/80 text-slate-400 group-hover:text-white transition"
                          title="Edit Balance"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="mt-3">
                        <span
                          className={`text-base font-extrabold block ${
                            isCreditCard ? 'text-rose-400' : 'text-white'
                          }`}
                        >
                          {Number(w.balance_mmk).toLocaleString()}
                        </span>
                        <span className="text-[10px] text-slate-400 flex items-center justify-between mt-0.5">
                          <span>MMK</span>
                          <span className="underline decoration-dotted">Edit Balance</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 2: DAILY SUMMARY & TRANSACTIONS
        =================================================================== */}
        {activeTab === 'summary' && (
          <div className="space-y-5">
            {/* Date Selector / Cards reading from `daily_summary` view */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  နေ့စဉ်စာရင်းချုပ် (Daily Summary View)
                </h2>
                {selectedDateFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setSelectedDateFilter('ALL')}
                    className="text-xs text-emerald-400 hover:underline"
                  >
                    ရက်အားလုံးပြန်ပြရန်
                  </button>
                )}
              </div>

              {/* Date Picker Filter */}
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="date"
                  value={selectedDateFilter === 'ALL' ? '' : selectedDateFilter}
                  onChange={(e) =>
                    setSelectedDateFilter(e.target.value ? e.target.value : 'ALL')
                  }
                  className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setSelectedDateFilter(getMyanmarDateISO(0))}
                  className={`px-3 py-2 rounded-xl text-xs font-medium border transition ${
                    selectedDateFilter === getMyanmarDateISO(0)
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-300'
                  }`}
                >
                  ဒီနေ့ (Today)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDateFilter(getMyanmarDateISO(-1))}
                  className={`px-3 py-2 rounded-xl text-xs font-medium border transition ${
                    selectedDateFilter === getMyanmarDateISO(-1)
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-300'
                  }`}
                >
                  မနေ့က (Yesterday)
                </button>
              </div>

              {/* Daily Summary Cards (Date | Net Total MMK | Pure Spent MMK) */}
              <div className="space-y-2.5">
                {snapshot.dailySummaries.length === 0 ? (
                  <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                    နေ့စဉ်စာရင်း မရှိသေးပါ။
                  </div>
                ) : (
                  snapshot.dailySummaries.map((row) => {
                    const isSelected = selectedDateFilter === row.tx_date;
                    return (
                      <div
                        key={row.tx_date}
                        onClick={() =>
                          setSelectedDateFilter(isSelected ? 'ALL' : row.tx_date)
                        }
                        className={`cursor-pointer rounded-2xl p-3.5 border transition grid grid-cols-3 gap-2 items-center ${
                          isSelected
                            ? 'bg-emerald-950/30 border-emerald-500/60'
                            : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase block">
                            Date
                          </span>
                          <span className="text-xs font-bold text-white">
                            {row.tx_date}
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            {row.tx_count} ကြောင်း
                          </span>
                        </div>

                        <div className="text-center">
                          <span className="text-[10px] text-slate-400 uppercase block">
                            Net Total MMK
                          </span>
                          <span
                            className={`text-xs font-bold ${
                              row.net_total_mmk >= 0
                                ? 'text-emerald-400'
                                : 'text-amber-300'
                            }`}
                          >
                            {row.net_total_mmk >= 0 ? '+' : ''}
                            {Number(row.net_total_mmk).toLocaleString()}
                          </span>
                        </div>

                        <div className="text-right">
                          <span className="text-[10px] text-slate-400 uppercase block">
                            Pure Spent MMK
                          </span>
                          <span className="text-xs font-extrabold text-rose-400">
                            {Number(row.pure_spent_mmk).toLocaleString()} MMK
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Recent Transactions List with 1-tap Undo (ဖျက်မယ်) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-200">
                  လတ်တလော စာရင်းများ (Recent Transactions)
                </h3>
                <span className="text-xs text-slate-400">
                  {filteredTransactions.length} ကြောင်း
                </span>
              </div>

              <div className="space-y-2.5">
                {filteredTransactions.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                    ရွေးချယ်ထားသော ရက်အတွက် စာရင်းမရှိပါ။
                  </div>
                ) : (
                  filteredTransactions.map((tx) => {
                    const isPositive = tx.amount_mmk > 0;
                    return (
                      <div
                        key={tx.id}
                        className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                              tx.type === 'transfer'
                                ? 'bg-sky-500/15 text-sky-400'
                                : isPositive
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {tx.type === 'transfer' ? (
                              <ArrowRightLeft className="w-4 h-4" />
                            ) : isPositive ? (
                              <TrendingUp className="w-4 h-4" />
                            ) : (
                              <TrendingDown className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">
                              {tx.description}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-slate-400">
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                                {tx.wallet}
                              </span>
                              <span>•</span>
                              <span>{tx.tx_date}</span>
                              {tx.transfer_pair_id && (
                                <span className="text-[10px] text-sky-400 bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-500/30">
                                  Pair #{tx.transfer_pair_id.slice(0, 6)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                          <span
                            className={`text-xs font-extrabold ${
                              isPositive ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {isPositive ? '+' : ''}
                            {Number(tx.amount_mmk).toLocaleString()} MMK
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUndoTransaction(tx)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-medium transition"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Undo (ဖျက်မယ်)</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 3: MONTHLY TODOS & HISTORY
        =================================================================== */}
        {activeTab === 'todos' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4 text-emerald-400" />
                  လစဉ်ပေးရန်စာရင်း (Active Monthly TODOs)
                </h2>
                <p className="text-[11px] text-slate-400">
                  done_mmk / target_mmk प्रोगရက်စ်နှင့် အမြန်ပေးချေမှု
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddTodoModal(true)}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-3 py-2 rounded-xl text-xs flex items-center gap-1 shadow-md"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add TODO</span>
              </button>
            </div>

            {/* Active Monthly TODO Checklist */}
            <div className="space-y-3">
              {activeTodos.length === 0 ? (
                <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                  ယခုလအတွက် Active TODO မရှိသေးပါ။ "+ Add TODO" နှိပ်ပြီး ထည့်နိုင်ပါသည်။
                </div>
              ) : (
                activeTodos.map((todo) => {
                  const pct =
                    todo.target_mmk > 0
                      ? Math.min(100, Math.round((todo.done_mmk / todo.target_mmk) * 100))
                      : 0;
                  const isCompleted =
                    todo.target_mmk > 0 && todo.done_mmk >= todo.target_mmk;
                  const remaining = Math.max(0, todo.target_mmk - todo.done_mmk);

                  return (
                    <div
                      key={todo.id}
                      className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white">
                              {todo.title}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                              {todo.month_label}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 mt-1">
                            <span className="text-emerald-400 font-bold">
                              {Number(todo.done_mmk).toLocaleString()}
                            </span>{' '}
                            / {Number(todo.target_mmk).toLocaleString()} MMK ({pct}%)
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setPayingTodo(todo);
                            setPayTodoAmount(
                              String(remaining > 0 ? remaining : todo.target_mmk)
                            );
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition shrink-0 ${
                            isCompleted
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                          }`}
                        >
                          {isCompleted ? '✓ ပေးပြီး (ထပ်ပေးမည်)' : 'Pay TODO'}
                        </button>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isCompleted ? 'bg-emerald-400' : 'bg-teal-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Archive & Start New Month Card */}
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Archive className="w-4 h-4 text-amber-400" />
                    လအသစ် စတင်ရန် (Archive & Start New Month)
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    လက်ရှိ TODO များကို <code className="text-amber-300">is_archived = true</code> သတ်မှတ်ပြီး History သို့ ပို့မည်
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cloneOnArchive}
                  onChange={(e) => setCloneOnArchive(e.target.checked)}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500"
                />
                <span>လအသစ်အတွက် TODO ခေါင်းစဉ်များကို done_mmk = 0 ဖြင့် ပြန်ပွားမည်</span>
              </label>

              <button
                type="button"
                onClick={handleArchiveMonth}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition"
              >
                <Archive className="w-4 h-4" />
                <span>Archive & Start New Month</span>
              </button>
            </div>

            {/* Past Months' History (is_archived = true) */}
            <div>
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5 mb-2.5">
                <History className="w-4 h-4 text-slate-400" />
                ပြီးခဲ့သောလများမှ မှတ်တမ်း (Archived TODO History)
              </h3>
              <div className="space-y-2">
                {archivedTodos.length === 0 ? (
                  <p className="text-xs text-slate-500 bg-slate-900/40 p-4 rounded-xl border border-slate-800/60 text-center">
                    Archived History မရှိသေးပါ။
                  </p>
                ) : (
                  archivedTodos.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl bg-slate-900/50 border border-slate-800/80 p-3 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-slate-300 block">
                          {item.title}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          လ: {item.month_label} • Archived
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-emerald-400">
                          {Number(item.done_mmk).toLocaleString()}
                        </span>
                        <span className="text-slate-500">
                          {' '}
                          / {Number(item.target_mmk).toLocaleString()} MMK
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 4: SETTINGS & PAYDAY
        =================================================================== */}
        {activeTab === 'settings' && (
          <div className="space-y-5">
            <form
              onSubmit={handleSaveSettings}
              className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-4"
            >
              <h2 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                <Settings className="w-4 h-4 text-emerald-400" />
                လစာထုတ်ရက် နှင့် AI Settings
              </h2>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Next Payday (လာမည့် လစာထုတ်ရက်)
                </label>
                <input
                  type="date"
                  value={paydayInput}
                  onChange={(e) => setPaydayInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Safe-to-Spend တွက်ချက်ရန် လက်ရှိကျန်ရက်: {safeMetrics.daysUntilPayday} ရက်
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-purple-400" />
                  Personal Gemini API Key (Optional - gemini-3.5-flash-lite)
                </label>
                <input
                  type="password"
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  placeholder="AIzaSy... (သင့်ကိုယ်ပိုင် Gemini API Key ထည့်သွင်းနိုင်သည်)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  "သင့်လား / မလား / လား / လဲ" မေးခွန်းများအတွက် Gemini 3.5 Flash-Lite ကို ခေါ်ယူပေးပါသည်။
                </p>
              </div>

              <button
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition shadow-md"
              >
                Settings သိမ်းဆည်းမည်
              </button>
            </form>

            {/* Add / Rename Custom Wallets */}
            <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-emerald-400" />
                    ပိုက်ဆံအိတ်များ စီမံရန် (Add / Rename Wallets)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    ပိုက်ဆံအိတ် အသစ်ထည့်ခြင်း သို့မဟုတ် အမည်ပြောင်းခြင်း
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setCustomWalletModal({
                      mode: 'add',
                      name: '',
                      balance: '0',
                      isCredit: false,
                    })
                  }
                  className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Wallet</span>
                </button>
              </div>

              <div className="divide-y divide-slate-800">
                {snapshot.wallets.map((w) => (
                  <div
                    key={w.id}
                    className="py-2.5 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-semibold text-white">{w.name}</span>
                      <span className="text-slate-400 ml-2">
                        ({Number(w.balance_mmk).toLocaleString()} MMK)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCustomWalletModal({
                          mode: 'rename',
                          walletId: w.id,
                          name: w.name,
                          balance: String(w.balance_mmk),
                          isCredit: w.is_credit,
                        })
                      }
                      className="text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Rename</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* =====================================================================
          MODAL 1: EDIT WALLET BALANCE (Tab 1)
      ===================================================================== */}
      {editingWallet && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveWalletBalance}
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editingWallet.name} — လက်ကျန်ငွေ ပြင်ရန်
              </h3>
              <button
                type="button"
                onClick={() => setEditingWallet(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                လက်ကျန်ပမာဏအသစ် (MMK သို့မဟုတ် မြန်မာလို ဥပမာ ၅သိန်းခွဲ)
              </label>
              <input
                type="text"
                autoFocus
                value={editBalanceInput}
                onChange={(e) => setEditBalanceInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditingWallet(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                မလုပ်တော့ပါ
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold"
              >
                သိမ်းဆည်းမည်
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: ADD MONTHLY TODO (Tab 3)
      ===================================================================== */}
      {showAddTodoModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleAddTodoSubmit}
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">+ Add Monthly TODO</h3>
              <button
                type="button"
                onClick={() => setShowAddTodoModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                TODO ခေါင်းစဉ် (Title)
              </label>
              <input
                type="text"
                required
                placeholder="ဥပမာ - အိမ်လခ / မိဘထောက်ပံ့ငွေ"
                value={newTodoTitle}
                onChange={(e) => setNewTodoTitle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Target ပမာဏ (MMK သို့မဟုတ် ၃သိန်းခွဲ)
              </label>
              <input
                type="text"
                required
                placeholder="ဥပမာ - ၃သိန်းခွဲ သို့မဟုတ် 350000"
                value={newTodoTarget}
                onChange={(e) => setNewTodoTarget(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddTodoModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                ပိတ်မည်
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold"
              >
                ထည့်သွင်းမည်
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: PAY TODO QUICK ACTION (Tab 3)
      ===================================================================== */}
      {payingTodo && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handlePayTodoSubmit}
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                Pay TODO: {payingTodo.title}
              </h3>
              <button
                type="button"
                onClick={() => setPayingTodo(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                ပေးချေမည့် ပမာဏ (MMK)
              </label>
              <input
                type="text"
                required
                value={payTodoAmount}
                onChange={(e) => setPayTodoAmount(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                နှုတ်ယူမည့် ပိုက်ဆံအိတ် (Wallet)
              </label>
              <select
                value={payTodoWallet}
                onChange={(e) => setPayTodoWallet(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
              >
                {snapshot.wallets.map((w) => (
                  <option key={w.id} value={w.name}>
                    {w.name} ({Number(w.balance_mmk).toLocaleString()} MMK)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPayingTodo(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                မလုပ်တော့ပါ
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold"
              >
                ပေးချေမည်
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: ADD / RENAME CUSTOM WALLET (Tab 4)
      ===================================================================== */}
      {customWalletModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveCustomWallet}
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {customWalletModal.mode === 'add'
                  ? 'ပိုက်ဆံအိတ် အသစ်ထည့်ရန်'
                  : 'ပိုက်ဆံအိတ် အမည်ပြောင်းရန်'}
              </h3>
              <button
                type="button"
                onClick={() => setCustomWalletModal(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                ပိုက်ဆံအိတ်အမည် (Wallet Name)
              </label>
              <input
                type="text"
                required
                placeholder="ဥပမာ - WavePay / CB Pay"
                value={customWalletModal.name}
                onChange={(e) =>
                  setCustomWalletModal({ ...customWalletModal, name: e.target.value })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            {customWalletModal.mode === 'add' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  ကနဦး လက်ကျန်ငွေ (Initial Balance MMK)
                </label>
                <input
                  type="text"
                  value={customWalletModal.balance}
                  onChange={(e) =>
                    setCustomWalletModal({
                      ...customWalletModal,
                      balance: e.target.value,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={customWalletModal.isCredit}
                onChange={(e) =>
                  setCustomWalletModal({
                    ...customWalletModal,
                    isCredit: e.target.checked,
                  })
                }
                className="rounded border-slate-700 text-emerald-500"
              />
              <span>Credit Card / အကြွေးကတ် အဖြစ် သတ်မှတ်မည်</span>
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCustomWalletModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                ပိတ်မည်
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold"
              >
                သိမ်းဆည်းမည်
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          4 BOTTOM NAVIGATION TABS
      ===================================================================== */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 max-w-md mx-auto bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 px-2 py-1.5 grid grid-cols-4 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition ${
            activeTab === 'home'
              ? 'text-emerald-400 bg-emerald-500/10 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Wallet className="w-5 h-5" />
          <span className="text-[11px] mt-0.5">ပင်မ (Home)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('summary')}
          className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition ${
            activeTab === 'summary'
              ? 'text-emerald-400 bg-emerald-500/10 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[11px] mt-0.5">စာရင်း (Daily)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('todos')}
          className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition ${
            activeTab === 'todos'
              ? 'text-emerald-400 bg-emerald-500/10 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <CheckSquare className="w-5 h-5" />
          <span className="text-[11px] mt-0.5">လစဉ် (TODOs)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition ${
            activeTab === 'settings'
              ? 'text-emerald-400 bg-emerald-500/10 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[11px] mt-0.5">ပြင်ဆင်ရန်</span>
        </button>
      </nav>
    </div>
  );
}

