// .pptx peek for the composer's attachment cards: PowerPoint files are zips, so we read the slide text (and the embedded
// thumbnail PowerPoint/Keynote/Google Slides usually save) in the browser. Text only — no layout, images or fonts.

export interface Slide { lines: string[] }
export interface PptxPeek { thumb: string | null; slides: Slide[] }

const unent = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

export async function readPptx(bytes: ArrayBuffer): Promise<PptxPeek> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n)).sort((a, b) => +/(\d+)\.xml$/i.exec(a)![1] - +/(\d+)\.xml$/i.exec(b)![1]);
  if (!names.length) throw new Error('not a presentation');
  const slides: Slide[] = [];
  for (const n of names.slice(0, 60)) {
    const xml = await zip.files[n].async('string');
    const lines = (xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) ?? [])
      .map(p => unent((p.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('')).trim())
      .filter(Boolean);
    slides.push({ lines });
  }
  let thumb: string | null = null;
  const t = Object.keys(zip.files).find(n => /^docProps\/thumbnail\.(jpe?g|png)$/i.test(n));
  if (t) { const b64 = await zip.files[t].async('base64'); thumb = `data:image/${/png$/i.test(t) ? 'png' : 'jpeg'};base64,${b64}`; }
  return { thumb, slides };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** One slide's text drawn as a 16:9 white card (inline styles only, safe to inject; text is escaped). */
export function slideHtml(s: Slide, w = 480): string {
  const [title, ...rest] = s.lines;
  return `<div style="width:${w}px;height:${Math.round(w * 9 / 16)}px;box-sizing:border-box;padding:${Math.round(w * 0.06)}px;background:#fff;color:#1a1a1a;font-family:-apple-system,'DM Sans',sans-serif;overflow:hidden">`
    + (title ? `<div style="font-size:${Math.round(w * 0.075)}px;font-weight:700;line-height:1.15;margin-bottom:${Math.round(w * 0.03)}px">${esc(title.slice(0, 90))}</div>` : '<div style="color:#9ca3af;font-size:20px">(no text on this slide)</div>')
    + rest.slice(0, 7).map(l => `<div style="font-size:${Math.round(w * 0.04)}px;line-height:1.35;color:#374151">• ${esc(l.slice(0, 80))}</div>`).join('')
    + '</div>';
}
