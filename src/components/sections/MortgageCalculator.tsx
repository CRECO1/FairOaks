'use client';

import { useState, useEffect } from 'react';
import { Calculator } from 'lucide-react';

interface Props {
  listingPrice?: number;
}

export function MortgageCalculator({ listingPrice }: Props) {
  const [price, setPrice] = useState(listingPrice ?? 500000);
  const [downPct, setDownPct] = useState(20);
  const [rate, setRate] = useState(7.0);
  const [term, setTerm] = useState(30);
  const [monthly, setMonthly] = useState(0);

  useEffect(() => {
    const principal = price * (1 - downPct / 100);
    const r = rate / 100 / 12;
    const n = term * 12;
    if (r === 0) { setMonthly(principal / n); return; }
    const m = (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    setMonthly(isFinite(m) ? m : 0);
  }, [price, downPct, rate, term]);

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const downAmount = price * (downPct / 100);
  const loanAmount = price - downAmount;
  // Rough estimates for taxes + insurance
  const taxEst = (price * 0.0175) / 12;
  const insEst = (price * 0.004) / 12;
  const totalEst = monthly + taxEst + insEst;

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <div className="flex items-center gap-2 mb-4">
        <Calculator className="h-4 w-4 text-gold" />
        <h4 className="font-heading text-body-sm font-semibold text-primary">Mortgage Calculator</h4>
      </div>

      <div className="space-y-3">
        {/* Home Price */}
        <div>
          <div className="flex justify-between mb-1">
            <label className="text-caption text-foreground-muted">Home Price</label>
            <span className="text-caption font-semibold text-primary">{fmt(price)}</span>
          </div>
          <input type="range" min={100000} max={3000000} step={5000} value={price}
            onChange={e => setPrice(Number(e.target.value))}
            className="w-full accent-gold h-1.5 rounded-full" />
        </div>

        {/* Down Payment */}
        <div>
          <div className="flex justify-between mb-1">
            <label className="text-caption text-foreground-muted">Down Payment</label>
            <span className="text-caption font-semibold text-primary">{downPct}% ({fmt(downAmount)})</span>
          </div>
          <input type="range" min={3} max={50} step={1} value={downPct}
            onChange={e => setDownPct(Number(e.target.value))}
            className="w-full accent-gold h-1.5 rounded-full" />
        </div>

        {/* Rate + Term */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-caption text-foreground-muted block mb-1">Interest Rate</label>
            <div className="relative">
              <input type="number" min={1} max={15} step={0.05} value={rate}
                onChange={e => setRate(Number(e.target.value))}
                className="w-full rounded-lg border border-border px-3 py-2 pr-7 text-sm text-primary focus:border-gold focus:outline-none" />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-caption text-foreground-muted">%</span>
            </div>
          </div>
          <div className="flex-1">
            <label className="text-caption text-foreground-muted block mb-1">Loan Term</label>
            <select value={term} onChange={e => setTerm(Number(e.target.value))}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-primary focus:border-gold focus:outline-none">
              <option value={30}>30 yr</option>
              <option value={20}>20 yr</option>
              <option value={15}>15 yr</option>
              <option value={10}>10 yr</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mt-4 rounded-xl bg-primary/5 border border-primary/10 p-4">
        <div className="text-center mb-3">
          <p className="text-caption text-foreground-muted">Est. Monthly Payment</p>
          <p className="font-heading text-2xl font-bold text-primary">{fmt(totalEst)}<span className="text-caption font-normal text-foreground-muted">/mo</span></p>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-primary/10 pt-3">
          <div className="text-center">
            <p className="text-caption text-foreground-muted">Principal & Interest</p>
            <p className="text-body-sm font-semibold text-primary">{fmt(monthly)}</p>
          </div>
          <div className="text-center">
            <p className="text-caption text-foreground-muted">Est. Taxes</p>
            <p className="text-body-sm font-semibold text-primary">{fmt(taxEst)}</p>
          </div>
          <div className="text-center">
            <p className="text-caption text-foreground-muted">Est. Insurance</p>
            <p className="text-body-sm font-semibold text-primary">{fmt(insEst)}</p>
          </div>
        </div>
        <p className="mt-3 text-center text-[10px] text-foreground-subtle leading-relaxed">
          Loan amount: {fmt(loanAmount)} · Estimates only. Actual payments vary. Contact us for pre-approval.
        </p>
      </div>
    </div>
  );
}
