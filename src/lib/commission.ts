// Commission math + form helpers for the deal card's Commission tab.
//
// The numbers MUST match the generated columns on crm_commissions, because those feed every report (Commissions page, 1099 view, dashboard):
//   gross_commission = round(sale_price × rate / 100, 2)
//   agent_net        = round((sale_price × rate / 100 − referral_fee) × agent_split / 100, 2)
//   brokerage_net    = round((sale_price × rate / 100 − referral_fee) × (100 − agent_split) / 100 − transaction_fee, 2)
// i.e. a referral fee comes off the top and is shared by the split; the transaction fee is charged to the brokerage only.
// (The tab's live preview used to subtract both fees from the agent and none from the brokerage — it disagreed with what was saved.)

export type CommissionStatus = 'pending' | 'paid' | 'disputed';

export interface CommissionForm {
  sale_price: string; commission_rate: string; agent_split: string;
  referral_fee: string; referral_to: string; transaction_fee: string;
  status: CommissionStatus; close_date: string; paid_date: string; notes: string;
}

export const EMPTY_COMMISSION_FORM: CommissionForm = {
  sale_price: '', commission_rate: '3', agent_split: '70', referral_fee: '0', referral_to: '', transaction_fee: '0',
  status: 'pending', close_date: '', paid_date: '', notes: '',
};

/** The saved row (only the fields the form edits). */
export interface CommissionRowLike {
  sale_price?: number | null; commission_rate?: number | null; agent_split?: number | null; referral_fee?: number | null; referral_to?: string | null;
  transaction_fee?: number | null; status?: CommissionStatus | null; close_date?: string | null; paid_date?: string | null; notes?: string | null;
}

export function formFromCommission(c: CommissionRowLike): CommissionForm {
  return {
    sale_price: String(c.sale_price ?? ''), commission_rate: String(c.commission_rate ?? '3'), agent_split: String(c.agent_split ?? '70'),
    referral_fee: String(c.referral_fee ?? '0'), referral_to: c.referral_to ?? '', transaction_fee: String(c.transaction_fee ?? '0'),
    status: c.status ?? 'pending', close_date: c.close_date ?? '', paid_date: c.paid_date ?? '', notes: c.notes ?? '',
  };
}

const n = (s: string) => { const v = Number(s); return Number.isFinite(v) ? v : 0; };
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export interface CommissionFigures {
  /** price × rate */
  gross: number;
  referral: number;
  /** gross minus the referral fee — the amount the split applies to */
  pool: number;
  agentShare: number;      // = agent net
  brokerageShare: number;  // before the transaction fee
  transactionFee: number;
  brokerageNet: number;
}

export function figureCommission(f: Pick<CommissionForm, 'sale_price' | 'commission_rate' | 'agent_split' | 'referral_fee' | 'transaction_fee'>): CommissionFigures {
  const rawGross = n(f.sale_price) * n(f.commission_rate) / 100;
  const referral = n(f.referral_fee), tx = n(f.transaction_fee), split = n(f.agent_split);
  const rawPool = rawGross - referral;
  return {
    gross: r2(rawGross), referral, pool: r2(rawPool),
    agentShare: r2(rawPool * split / 100),
    brokerageShare: r2(rawPool * (100 - split) / 100),
    transactionFee: tx,
    brokerageNet: r2(rawPool * (100 - split) / 100 - tx),
  };
}

/** What would stop this from saving (the API rejects the same things). Empty = fine. Keyed by field. */
export function commissionErrors(f: CommissionForm): Partial<Record<'sale_price' | 'commission_rate' | 'agent_split' | 'referral_fee' | 'transaction_fee', string>> {
  const e: Partial<Record<'sale_price' | 'commission_rate' | 'agent_split' | 'referral_fee' | 'transaction_fee', string>> = {};
  const bad = (s: string) => s.trim() !== '' && !Number.isFinite(Number(s));
  if (!(n(f.sale_price) > 0)) e.sale_price = 'Enter the sale or lease price';
  else if (n(f.sale_price) > 1e11) e.sale_price = 'That price looks too large';
  if (bad(f.commission_rate) || n(f.commission_rate) < 0 || n(f.commission_rate) > 100) e.commission_rate = 'Between 0 and 100';
  if (bad(f.agent_split) || n(f.agent_split) < 0 || n(f.agent_split) > 100) e.agent_split = 'Between 0 and 100';
  if (bad(f.referral_fee) || n(f.referral_fee) < 0) e.referral_fee = 'Cannot be negative';
  else if (!e.sale_price && !e.commission_rate && n(f.referral_fee) > n(f.sale_price) * n(f.commission_rate) / 100 + 0.005) e.referral_fee = 'More than the gross commission';
  if (bad(f.transaction_fee) || n(f.transaction_fee) < 0) e.transaction_fee = 'Cannot be negative';
  return e;
}

export function sameCommissionForm(a: CommissionForm, b: CommissionForm): boolean {
  return (Object.keys(a) as (keyof CommissionForm)[]).every(k => String(a[k]).trim() === String(b[k]).trim());
}

/** $12,345 — cents only when there are some. */
export function money(v: number): string {
  const neg = v < 0; const a = Math.abs(v);
  const s = a.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(r2(a)) ? 0 : 2, maximumFractionDigits: 2 });
  return `${neg ? '−' : ''}$${s}`;
}

/** Today as yyyy-mm-dd in the browser's local time (what a date input expects). */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
