'use client';
// The deal card's Commission tab: the split at a glance, how it is figured, and the form that sets it.
// An agent can create the first commission on a deal they own but only an admin can change it once saved (the API enforces it),
// so for them a saved commission is shown read-only instead of an editable form that fails on Save.
import React, { useMemo } from 'react';
import {
  type CommissionForm, type CommissionRowLike, type CommissionStatus,
  figureCommission, commissionErrors, formFromCommission, sameCommissionForm, money, todayLocal,
} from '@/lib/commission';

const GOLD = '#c9922c';
const LABEL: React.CSSProperties = { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-6b7280)', fontWeight: 600 };
const CARD: React.CSSProperties = { background: 'var(--k-f9fafb)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, padding: '16px 18px' };
const SECTION: React.CSSProperties = { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 10 };
const GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 };

const STATUS: Record<CommissionStatus, { label: string; bg: string; color: string; dot: string }> = {
  pending:  { label: 'Pending',  bg: 'var(--k-fef3c7)', color: 'var(--k-92400e)', dot: '#d97706' },
  paid:     { label: 'Paid',     bg: 'var(--k-d1fae5)', color: 'var(--k-065f46)', dot: '#059669' },
  disputed: { label: 'Disputed', bg: 'var(--k-fee2e2)', color: 'var(--k-991b1b)', dot: '#dc2626' },
};

const niceDate = (s?: string) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const pct = (s: string) => { const v = Number(s); return Number.isFinite(v) ? `${Math.round(v * 100) / 100}%` : ''; };

function Field({ id, label, error, hint, prefix, suffix, children }: { id: string; label: string; error?: string; hint?: string; prefix?: string; suffix?: string; children: (p: { id: string; style: React.CSSProperties; 'aria-invalid'?: boolean }) => React.ReactNode }) {
  const pad: React.CSSProperties = { paddingLeft: prefix ? 24 : undefined, paddingRight: suffix ? 26 : undefined, marginTop: 4, borderColor: error ? '#dc2626' : undefined };
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={id} style={LABEL}>{label}</label>
      <div style={{ position: 'relative' }}>
        {prefix && <span aria-hidden style={{ position: 'absolute', left: 10, top: 4, bottom: 0, display: 'flex', alignItems: 'center', color: 'var(--k-9ca3af)', fontSize: 13.5, pointerEvents: 'none' }}>{prefix}</span>}
        {children({ id, style: pad, 'aria-invalid': error ? true : undefined })}
        {suffix && <span aria-hidden style={{ position: 'absolute', right: 10, top: 4, bottom: 0, display: 'flex', alignItems: 'center', color: 'var(--k-9ca3af)', fontSize: 13.5, pointerEvents: 'none' }}>{suffix}</span>}
      </div>
      {error ? <div role="alert" style={{ fontSize: 11.5, color: '#dc2626', marginTop: 3 }}>{error}</div> : hint ? <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', marginTop: 3 }}>{hint}</div> : null}
    </div>
  );
}

function Row({ label, value, sub, strong, minus, tone }: { label: React.ReactNode; value: string; sub?: string; strong?: boolean; minus?: boolean; tone?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderTop: strong ? '1px solid var(--k-e5e7eb)' : undefined, marginTop: strong ? 4 : 0 }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: strong ? 'var(--k-111)' : 'var(--k-374151)', fontWeight: strong ? 700 : 400 }}>
        {label}{sub && <span style={{ color: 'var(--k-9ca3af)', fontSize: 12, marginLeft: 6 }}>{sub}</span>}
      </div>
      <div style={{ fontSize: 14, fontWeight: strong ? 700 : 600, color: tone ?? 'var(--k-111)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{minus ? '− ' : ''}{value}</div>
    </div>
  );
}

export default function CommissionPanel({ form, setForm, saved, saving, canEdit, agentName, dealType, onSave }: {
  form: CommissionForm;
  setForm: React.Dispatch<React.SetStateAction<CommissionForm>>;
  saved: (CommissionRowLike & { id?: string }) | null;
  saving: boolean;
  /** false → show the saved commission read-only. */
  canEdit: boolean;
  agentName?: string;
  dealType?: string;
  onSave: () => void;
}) {
  const fig = useMemo(() => figureCommission(form), [form]);
  const errors = useMemo(() => commissionErrors(form), [form]);
  const hasPrice = Number(form.sale_price) > 0;
  const dirty = saved ? !sameCommissionForm(form, formFromCommission(saved)) : hasPrice;
  const blocked = Object.keys(errors).length > 0;
  const set = <K extends keyof CommissionForm>(k: K, v: CommissionForm[K]) => setForm(f => ({ ...f, [k]: v }));
  const st = STATUS[form.status] ?? STATUS.pending;
  const split = Number(form.agent_split) || 0;

  const pickStatus = (s: CommissionStatus) => setForm(f => ({ ...f, status: s, paid_date: s === 'paid' && !f.paid_date ? todayLocal() : f.paid_date }));

  const summary = (
    <div style={{ ...CARD, background: 'var(--k-f9f5ef)', borderColor: 'var(--k-e8dcc8)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: hasPrice ? 14 : 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...LABEL, color: '#8a6d3b' }}>Commission{agentName ? ` · ${agentName}` : ''}</div>
          {hasPrice && <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginTop: 3 }}>{pct(form.commission_rate)} of {money(Number(form.sale_price))}{dealType ? ` ${/lease/i.test(dealType) ? 'lease value' : 'sale price'}` : ''} · {split}/{100 - split} split</div>}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 11px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: st.bg, color: st.color }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: st.dot }} />{st.label}
        </span>
      </div>
      {hasPrice ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {[
            { label: 'Gross', v: fig.gross, color: GOLD },
            { label: 'Agent net', v: fig.agentShare, color: 'var(--k-059669)' },
            { label: 'Brokerage net', v: fig.brokerageNet, color: 'var(--k-374151)' },
          ].map(t => (
            <div key={t.label} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e8dcc8)', borderRadius: 8, padding: '9px 10px', minWidth: 0 }}>
              <div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 600, marginBottom: 3 }}>{t.label}</div>
              <div style={{ fontSize: 'clamp(15px, 4.6vw, 21px)', fontWeight: 700, color: t.color, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{money(t.v)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13.5, color: 'var(--k-6b7280)', marginTop: 8 }}>Enter the sale or lease price below and the split fills in here.</div>
      )}
    </div>
  );

  const breakdown = hasPrice && !errors.commission_rate && !errors.agent_split && (
    <div style={CARD}>
      <div style={SECTION}>How it’s figured</div>
      <Row label="Gross commission" sub={`${pct(form.commission_rate)} of ${money(Number(form.sale_price))}`} value={money(fig.gross)} />
      {fig.referral > 0 && <Row label="Referral fee" sub={form.referral_to ? `to ${form.referral_to}` : 'comes off the top'} value={money(fig.referral)} minus />}
      {fig.referral > 0 && <Row label="Left to split" value={money(fig.pool)} />}
      <Row label="Agent" sub={`${split}%`} value={money(fig.agentShare)} tone="var(--k-059669)" />
      <Row label="Brokerage" sub={`${100 - split}%`} value={money(fig.brokerageShare)} />
      {fig.transactionFee > 0 && <Row label="Transaction fee" sub="charged to the brokerage" value={money(fig.transactionFee)} minus />}
      {fig.transactionFee > 0 && <Row label="Brokerage net" value={money(fig.brokerageNet)} strong />}
    </div>
  );

  // ── Read-only: an agent looking at a commission an admin controls ──
  if (!canEdit && saved) {
    const kv: [string, string][] = [
      ['Sale / lease price', money(Number(saved.sale_price ?? 0))],
      ['Commission rate', pct(String(saved.commission_rate ?? ''))],
      ['Agent split', pct(String(saved.agent_split ?? ''))],
      ...(Number(saved.referral_fee) > 0 ? [['Referral fee', `${money(Number(saved.referral_fee))}${saved.referral_to ? ` · ${saved.referral_to}` : ''}`] as [string, string]] : []),
      ...(Number(saved.transaction_fee) > 0 ? [['Transaction fee', money(Number(saved.transaction_fee))] as [string, string]] : []),
      ['Close date', niceDate(saved.close_date ?? undefined) || '—'],
      ['Paid date', niceDate(saved.paid_date ?? undefined) || '—'],
    ];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {summary}
        {breakdown}
        <div style={CARD}>
          <div style={SECTION}>Details</div>
          <div style={GRID}>
            {kv.map(([k, v]) => (
              <div key={k} style={{ minWidth: 0 }}>
                <div style={LABEL}>{k}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--k-111)', marginTop: 3, overflowWrap: 'anywhere' }}>{v}</div>
              </div>
            ))}
          </div>
          {saved.notes && <div style={{ marginTop: 12, fontSize: 13.5, color: 'var(--k-374151)', whiteSpace: 'pre-wrap' }}>{saved.notes}</div>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--k-9ca3af)' }}>🔒 Only an admin can change a commission once it’s saved.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {summary}
      {breakdown}

      <div style={CARD}>
        <div style={SECTION}>Deal</div>
        <div style={GRID}>
          <Field id="cm-price" label="Sale / lease price" prefix="$" error={errors.sale_price && (form.sale_price !== '' || saved) ? errors.sale_price : undefined}>
            {p => <input {...p} className="crm-input" type="number" inputMode="decimal" min="0" value={form.sale_price} onChange={e => set('sale_price', e.target.value)} placeholder="0" />}
          </Field>
          <Field id="cm-rate" label="Commission rate" suffix="%" error={errors.commission_rate}>
            {p => <input {...p} className="crm-input" type="number" inputMode="decimal" step="0.1" min="0" max="100" value={form.commission_rate} onChange={e => set('commission_rate', e.target.value)} />}
          </Field>
          <Field id="cm-split" label="Agent split" suffix="%" error={errors.agent_split} hint={!errors.agent_split ? `Brokerage keeps ${100 - split}%` : undefined}>
            {p => <input {...p} className="crm-input" type="number" inputMode="decimal" min="0" max="100" value={form.agent_split} onChange={e => set('agent_split', e.target.value)} />}
          </Field>
        </div>
      </div>

      <div style={CARD}>
        <div style={SECTION}>Referral &amp; fees</div>
        <div style={GRID}>
          <Field id="cm-ref" label="Referral fee" prefix="$" error={errors.referral_fee} hint="Comes off the gross before the split">
            {p => <input {...p} className="crm-input" type="number" inputMode="decimal" min="0" value={form.referral_fee} onChange={e => set('referral_fee', e.target.value)} />}
          </Field>
          <Field id="cm-refto" label="Referral to">
            {p => <input {...p} className="crm-input" value={form.referral_to} onChange={e => set('referral_to', e.target.value)} placeholder="Agent or brokerage" />}
          </Field>
          <Field id="cm-tx" label="Transaction fee" prefix="$" error={errors.transaction_fee} hint="Charged to the brokerage">
            {p => <input {...p} className="crm-input" type="number" inputMode="decimal" min="0" value={form.transaction_fee} onChange={e => set('transaction_fee', e.target.value)} />}
          </Field>
        </div>
      </div>

      <div style={CARD}>
        <div style={SECTION}>Status &amp; dates</div>
        <div role="radiogroup" aria-label="Commission status" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {(Object.keys(STATUS) as CommissionStatus[]).map(s => {
            const on = form.status === s; const c = STATUS[s];
            return (
              <button key={s} type="button" role="radio" aria-checked={on} onClick={() => pickStatus(s)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 18, fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 36,
                  background: on ? c.bg : 'var(--k-fff)', color: on ? c.color : 'var(--k-6b7280)', border: `1px solid ${on ? c.dot : 'var(--k-e5e7eb)'}` }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: on ? c.dot : 'var(--k-d1d5db)' }} />{c.label}
              </button>
            );
          })}
        </div>
        <div style={GRID}>
          <Field id="cm-close" label="Close date">
            {p => <input {...p} className="crm-input" type="date" value={form.close_date} onChange={e => set('close_date', e.target.value)} />}
          </Field>
          <Field id="cm-paid" label="Paid date" hint={form.status === 'paid' && !form.paid_date ? 'Add the date it was paid' : undefined}>
            {p => <input {...p} className="crm-input" type="date" value={form.paid_date} onChange={e => set('paid_date', e.target.value)} />}
          </Field>
        </div>
      </div>

      <div style={CARD}>
        <label htmlFor="cm-notes" style={SECTION as React.CSSProperties}>Notes</label>
        <textarea id="cm-notes" className="crm-input" style={{ minHeight: 64, resize: 'vertical', width: '100%', boxSizing: 'border-box' }} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything worth remembering about this commission…" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap', position: 'sticky', bottom: 0, background: 'var(--k-fff)', padding: '10px 0', borderTop: '1px solid var(--k-f0f0f0)' }}>
        <span style={{ fontSize: 12.5, color: dirty ? 'var(--k-92400e)' : 'var(--k-9ca3af)' }}>
          {saving ? 'Saving…' : dirty ? (blocked ? 'Fix the highlighted fields to save' : 'Unsaved changes') : saved ? '✓ Saved' : 'Nothing to save yet'}
        </span>
        <button className="crm-btn crm-btn-gold" onClick={onSave} disabled={saving || !dirty || blocked} style={{ opacity: saving || !dirty || blocked ? 0.55 : 1, minHeight: 40 }}>
          {saving ? 'Saving…' : saved ? 'Update commission' : 'Save commission'}
        </button>
      </div>
    </div>
  );
}
