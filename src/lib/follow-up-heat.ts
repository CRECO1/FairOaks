/**
 * "Who to call first": a simple, explainable score for someone who asked about a property and has not been followed up. Higher = call sooner. Built only from what the
 * CRM already holds (how often they asked, whether they toured / asked for pricing / made an offer / wrote back, whether they are a broker with a client, how recent).
 * The reasons are shown next to each name so the order is never a mystery.
 */
export type HeatInput = { asks: number; signals: string[]; days: number; wroteBack: boolean };
export type Heat = { score: number; label: 'hot' | 'warm' | 'cool'; reasons: string[] };

export const SIGNAL_PATTERNS: [string, RegExp][] = [
  ['toured', /\b(toured|came on the tour|took a tour|tour request|showing|site visit|walked the (space|property))\b/i],
  ['made an offer', /\b(loi\b|letter of intent|proposal|offer|term sheet|lease draft)\b/i],
  ['asked about price', /\b(asking price|how much|lease rate|rent\b|nnn|ti allowance|cam charges?)\b/i],
  ['opened the brochure', /\b(brochure|opened brochure)\b/i],
];

/** Signals found in the words around someone's asks, plus whether they are a broker (a broker usually has a client waiting). */
export function signalsFrom(text: string, type?: string | null, hadMeeting = false): string[] {
  const out: string[] = [];
  for (const [name, re] of SIGNAL_PATTERNS) if (re.test(text)) out.push(name);
  if (hadMeeting) out.push('met with us');
  if (/\b(broker|tenant rep|agent)\b/i.test(String(type ?? '')) || /\b(has|have) a client|my client|their client|for a client\b/i.test(text)) out.push('broker with a client');
  return out;
}

export function heatFor(i: HeatInput): Heat {
  let score = 0; const reasons: string[] = [];
  if (i.asks >= 2) { score += 12 * (Math.min(i.asks, 4) - 1); reasons.push(`asked ${i.asks} times`); }
  const has = (s: string) => i.signals.includes(s);
  if (has('toured')) { score += 30; reasons.push('toured'); }
  if (has('made an offer')) { score += 30; reasons.push('mentioned an offer / LOI'); }
  if (has('met with us')) { score += 20; reasons.push('met with us'); }
  if (has('asked about price')) { score += 12; reasons.push('asked about price'); }
  if (has('opened the brochure')) { score += 8; reasons.push('looked at the brochure'); }
  if (has('broker with a client')) { score += 10; reasons.push('a broker with a client'); }
  if (i.wroteBack) { score += 15; reasons.push('wrote us back'); }
  const d = i.days;
  if (d <= 14) { score += 20; reasons.push('asked in the last 2 weeks'); } else if (d <= 30) { score += 12; reasons.push('asked this month'); } else if (d <= 60) score += 4; else if (d > 120) { score -= 15; reasons.push('asked over 4 months ago'); }
  return { score, label: score >= 45 ? 'hot' : score >= 20 ? 'warm' : 'cool', reasons };
}
