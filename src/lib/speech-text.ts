// Make written text safe and natural for a text-to-speech voice. Applied ONLY to what is spoken (the TwiML), never
// to what is stored, so transcripts keep correct spelling while callers hear "Bernie", not "Boo-er-nee".

const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const digits = (s: string) => s.split('').map(d => DIGIT[Number(d)]).join(' ');

// Local names a generic US voice gets wrong. Respelled the way a San Antonio local says them.
const PRONOUNCE: [RegExp, string][] = [
  [/\bBoerne\b/g, 'Bernie'], [/\bDietz\b/g, 'Deets'], [/\bSchertz\b/g, 'Shirts'], [/\bGruene\b/g, 'Green'],
  [/\bSeguin\b/g, 'Seh-geen'], [/\bCibolo\b/g, 'See-bolo'], [/\bBulverde\b/g, 'Bul-vur-dee'], [/\bHelotes\b/g, 'Hello-tess'],
  [/\bCulebra\b/g, 'Cuh-lay-bra'], [/\bGuadalupe\b/g, 'Gwad-a-loop'], [/\bBandera\b/g, 'Ban-dair-a'],
];

// Abbreviations a voice would spell out or mangle.
const EXPAND: [RegExp, string][] = [
  [/\bN\.?N\.?N\.?\b/g, 'triple net'], [/\bNN\b/g, 'double net'],
  [/(\d)\s?(?:SF|sf|sq\.? ?ft\.?)\b/g, '$1 square feet'], [/\b(?:sq\.? ?ft\.?)\b/gi, 'square feet'], [/\bSF\b/g, 'square feet'],
  [/\bSte\.?(?=\s*\d|\s+[A-Z])/g, 'Suite'], [/\bPkwy\b\.?/g, 'Parkway'], [/\bHwy\b\.?/g, 'Highway'], [/\bBlvd\b\.?/g, 'Boulevard'],
  [/\b([A-Z][a-z]+) Rd\b\.?/g, '$1 Road'], [/\b([A-Z][a-z]+) Cir\b\.?/g, '$1 Circle'], [/\b([A-Z][a-z]+) Ln\b\.?/g, '$1 Lane'],
  [/\b([A-Z][a-z]+) Ct\b\.?/g, '$1 Court'], [/\b([A-Z][a-z]+) Ave\b\.?/g, '$1 Avenue'],
  [/\bLoop 1604\b/g, 'Loop sixteen oh four'], [/\bLoop 410\b/g, 'Loop four ten'], [/\bI-10\b/g, 'I ten'], [/\bI-35\b/g, 'I thirty-five'], [/\bI-37\b/g, 'I thirty-seven'],
  [/\bUS[- ]?281\b/g, 'U S two eighty-one'], [/\bw\//g, 'with '], [/&/g, ' and '], [/\bvs\.?\b/gi, 'versus'],
];

export function speechText(input: string): string {
  let t = String(input ?? '');
  // markdown / list debris a model sometimes leaves in
  t = t.replace(/[*_`#]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s*\n+\s*/g, '. ').replace(/([.!?])\s*\.\s/g, '$1 ');
  // phone numbers written as digits → spoken as digit groups with a beat between them
  t = t.replace(/\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-](\d{4})\b/g, (_m, a, b, c) => `${digits(a)}, ${digits(b)}, ${digits(c)}`);
  t = t.replace(/\b(\d{3})-(\d{4})\b/g, (_m, a, b) => `${digits(a)}, ${digits(b)}`);
  // The model sometimes cites its source out loud ("the sheet lists about…"); nobody would say that on a call.
  t = t.replace(/\b(?:the|my|our) (?:listing |fact )?(?:sheet|notes|data|system|records?) (?:lists|shows|says|has|gives|indicates)(?: it)?(?: at| as)?\s+(?=(?:about|approximately|around|roughly|an?|\d))/gi, "it's ");
  t = t.replace(/\b(?:the|my|our) (?:listing |fact )?(?:sheet|notes|data|system|records?) (?:has|have) (?:that|it|this)(?: one)?[:,]?\s*/gi, '');
  t = t.replace(/\b(?:according to|per) (?:the|my|our) (?:listing |fact )?(?:sheet|notes|data|system|records?),?\s*/gi, '');
  for (const [re, to] of EXPAND) t = t.replace(re, to);
  for (const [re, to] of PRONOUNCE) t = t.replace(re, to);
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}
