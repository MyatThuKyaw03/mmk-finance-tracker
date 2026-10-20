import assert from 'node:assert/strict';
import {
  DEFAULT_WALLETS,
  detectTransferWallets,
  normalizeBurmeseDigits,
  parseBurmeseAmount,
  parseBurmeseFinanceInput,
} from './burmeseParser.ts';

// 1. Test Burmese digit normalization
assert.equal(normalizeBurmeseDigits('၁၂၃၄၅၆၇၈၉၀'), '1234567890');
assert.equal(normalizeBurmeseDigits('၁၀,၀၀၀'), '10000');

// 2. Test spoken multipliers
assert.equal(parseBurmeseAmount('ဆယ်သိန်း'), 1000000);
assert.equal(parseBurmeseAmount('၁၄သိန်း'), 1400000);
assert.equal(parseBurmeseAmount('၁သိန်းခွဲ'), 150000);
assert.equal(parseBurmeseAmount('သိန်းခွဲ'), 50000);
assert.equal(parseBurmeseAmount('၃သောင်းခွဲ'), 35000);
assert.equal(parseBurmeseAmount('သောင်းခွဲ'), 5000);
assert.equal(parseBurmeseAmount('၅ထောင်ခွဲ'), 5500);
assert.equal(parseBurmeseAmount('ထောင်ခွဲ'), 500);
assert.equal(parseBurmeseAmount('၂သောင်း ၅ထောင် ၅ရာ'), 25500);
assert.equal(parseBurmeseAmount('ထမင်းဖိုး ၁၀၀၀၀'), 10000);

// 3. Test 6 default wallets
assert.deepEqual(DEFAULT_WALLETS, [
  'Cash',
  'KPay',
  'AYA Pay',
  'AYA Bank',
  'Virtual Visa',
  'AYA Credit Card',
]);

// 4. Test deterministic classification: income
const inc1 = parseBurmeseFinanceInput('လစာ ၁၄သိန်း AYA Bank ရပြီ');
assert.equal(inc1.type, 'income');
assert.equal(inc1.amount, 1400000);
assert.equal(inc1.wallet, 'AYA Bank');

const inc2 = parseBurmeseFinanceInput('မုန့်ဖိုး ၅သောင်း KPay နဲ့ရ');
assert.equal(inc2.type, 'income');
assert.equal(inc2.amount, 50000);
assert.equal(inc2.wallet, 'KPay');

const inc3 = parseBurmeseFinanceInput('Bonus ၂သိန်း AYA Pay received');
assert.equal(inc3.type, 'income');
assert.equal(inc3.amount, 200000);
assert.equal(inc3.wallet, 'AYA Pay');

// 5. Test deterministic classification: transfer
const tr1 = parseBurmeseFinanceInput('AYA Bank ကနေ KPay ကို ၁သိန်းခွဲ လွှဲလိုက်တယ်');
assert.equal(tr1.type, 'transfer');
assert.equal(tr1.amount, 150000);
assert.equal(tr1.fromWallet, 'AYA Bank');
assert.equal(tr1.toWallet, 'KPay');

const tr2 = parseBurmeseFinanceInput('KPay ကနေ ၅သောင်း ထုတ်လိုက်တယ်');
assert.equal(tr2.type, 'transfer');
assert.equal(tr2.amount, 50000);
assert.equal(tr2.fromWallet, 'KPay');
assert.equal(tr2.toWallet, 'Cash');

const tr3 = detectTransferWallets('AYA Pay ကို AYA Bank ကနေ ၃သောင်း လဲပေး');
assert.equal(tr3.fromWallet, 'AYA Bank');
assert.equal(tr3.toWallet, 'AYA Pay');

// 6. Test deterministic classification: expense (default when amount > 0)
const exp1 = parseBurmeseFinanceInput('ထမင်းဖိုး ၁၀၀၀၀ KPay');
assert.equal(exp1.type, 'expense');
assert.equal(exp1.amount, 10000);
assert.equal(exp1.wallet, 'KPay');
assert.equal(exp1.category, 'Food');

const exp2 = parseBurmeseFinanceInput('Shopping ၄သောင်းခွဲ AYA Credit Card');
assert.equal(exp2.type, 'expense');
assert.equal(exp2.amount, 45000);
assert.equal(exp2.wallet, 'AYA Credit Card');
assert.equal(exp2.category, 'Shopping');

// 7. Test deterministic classification: date_summary
const sumToday = parseBurmeseFinanceInput('ဒီနေ့ဘယ်လောက်သုံးထားလဲ');
assert.equal(sumToday.type, 'date_summary');
assert.equal(sumToday.summaryDateOffset, 0);

const sumYesterday = parseBurmeseFinanceInput('မနေ့ကဘယ်လောက်သုံးလိုက်လဲ');
assert.equal(sumYesterday.type, 'date_summary');
assert.equal(sumYesterday.summaryDateOffset, -1);

// 8. Test deterministic classification: advice_only
const adv = parseBurmeseFinanceInput('ဖိနပ် ၅သောင်းတန် Virtual Visa နဲ့ ဝယ်သင့်လား');
assert.equal(adv.type, 'advice_only');
assert.equal(adv.amount, 50000);
assert.equal(adv.wallet, 'Virtual Visa');

// 9. Test TODO classifications
const todoAdd = parseBurmeseFinanceInput('todo ထည့် အိမ်လခ ၃သိန်းခွဲ');
assert.equal(todoAdd.type, 'todo_add');
assert.equal(todoAdd.amount, 350000);

const todoPay = parseBurmeseFinanceInput('todo ဆပ် အိမ်လခ ၃သိန်းခွဲ KPay');
assert.equal(todoPay.type, 'todo_pay');
assert.equal(todoPay.amount, 350000);
assert.equal(todoPay.wallet, 'KPay');

const todoUpdate = parseBurmeseFinanceInput('todo ပြင် အိမ်လခ ၄သိန်း');
assert.equal(todoUpdate.type, 'todo_update');
assert.equal(todoUpdate.amount, 400000);

console.log('✅ All Burmese Parser & Wallet tests passed!');

