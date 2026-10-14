// Dev harness: render the flyer from MOCK photos + listing fields (no Supabase, no
// network) so a layout change can be eyeballed at 1–4 extra photos.
//   npx tsx scripts/flyer-mock-render.ts <out-dir> [extraPhotos=0,1,2,4] [--before <path-to-old-flyer-doc.ts>]
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OSWALD_BOLD_B64, CRECO_LOGO_PNG_B64 } from '../src/lib/flyer-assets';
import { flyerFacts } from '../src/lib/flyer-facts';

const outDir = process.argv[2] ?? '.';
const counts = (process.argv[3] ?? '0,1,2,4').split(',').map(Number);
const beforeIdx = process.argv.indexOf('--before');
const beforePath = beforeIdx > 0 ? process.argv[beforeIdx + 1] : null;

async function mock(w: number, h: number, bg: string, fg: string, label: string, shape: 'building' | 'room' | 'aerial' | 'map') {
  const art = shape === 'building'
    ? `<rect x="${w * .12}" y="${h * .38}" width="${w * .76}" height="${h * .42}" fill="${fg}"/><rect x="${w * .2}" y="${h * .5}" width="${w * .6}" height="${h * .14}" fill="#dfe6ee"/><rect x="0" y="${h * .8}" width="${w}" height="${h * .2}" fill="#555"/>`
    : shape === 'room'
    ? `<rect x="0" y="${h * .62}" width="${w}" height="${h * .38}" fill="#b9a68a"/><rect x="${w * .1}" y="${h * .12}" width="${w * .8}" height="${h * .5}" fill="${fg}"/><rect x="${w * .4}" y="${h * .25}" width="${w * .2}" height="${h * .37}" fill="#fff" opacity=".6"/>`
    : shape === 'aerial'
    ? `<rect x="${w * .3}" y="${h * .3}" width="${w * .4}" height="${h * .35}" fill="none" stroke="#f0b400" stroke-width="${w * .006}"/><path d="M0 ${h * .75} L${w} ${h * .7}" stroke="#ddd" stroke-width="${h * .04}"/>`
    : `<circle cx="${w / 2}" cy="${h / 2}" r="${h * .07}" fill="#ee8a00"/><path d="M0 ${h * .3} H${w} M0 ${h * .7} H${w} M${w * .3} 0 V${h} M${w * .75} 0 V${h}" stroke="#fff" stroke-width="${h * .03}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${art}<text x="${w * .03}" y="${h * .08}" font-family="Helvetica" font-size="${Math.max(14, h * .045)}" fill="#fff" opacity=".9">${label} (mock)</text></svg>`;
  return sharp(Buffer.from(svg));
}
const jpg = async (b: sharp.Sharp) => ({ bytes: new Uint8Array(await b.jpeg({ quality: 85 }).toBuffer()), png: false });

(async () => {
  mkdirSync(outDir, { recursive: true });
  const modAfter = await import('../src/lib/flyer-doc');
  const modBefore = beforePath ? await import(path.resolve(beforePath)) : null;
  const L = { type: 'Retail', year_built: '2008' };
  const rawHighlights = [
    'Two-building retail center on 1.39 acres with C-3 zoning',
    'Ample on-site parking (±30 spaces)',
    'Demisable into two suites',
    'Pylon and monument signage on Montego Rd',
    'Minutes from Loop 1604 and Bandera Rd',
    'Landlord to deliver in vanilla-shell condition',
  ];
  const { facts, highlights } = flyerFacts(L, rawHighlights);
  console.log('facts:', facts.map(f => `${f.label}=${f.value}`).join(' | '));
  console.log('bullets kept:', highlights.length, '/', rawHighlights.length);

  const interiors = ['Interior - sales floor', 'Interior - suite B', 'Storefront', 'Rear elevation'];
  for (const n of counts) {
    const hero = await jpg(await mock(1224, 744, '#8fb3d6', '#c9b79c', '7743 Montego Rd street view', 'building'));
    const gallery = [];
    for (let i = 0; i < n; i++) gallery.push(await jpg(await mock(640, 480, ['#9aa7b4', '#b5a48c', '#8e9b8a', '#a89aa8'][i % 4], ['#d9d2c4', '#cfd6dc', '#c8cfc0', '#d6c9d0'][i % 4], interiors[i % 4], 'room')));
    const siteAerial = [await jpg(await mock(1400, 1000, '#6f8a5d', '#fff', '7747 Montego Rd aerial', 'aerial'))];
    const mapBytes = new Uint8Array(await (await mock(544, 288, '#e8e6df', '#000', 'OSM', 'map')).png().toBuffer());
    const base = {
      badge: 'FOR LEASE', address: '7743 & 7747 Montego Rd, San Antonio, TX 78250',
      description: 'Two retail buildings totalling 6,000 SF on 1.39 acres with strong visibility on Montego Rd. Zoned C-3 for general commercial use. Flexible floor plates suit a range of retail and service users. Dedicated parking sits at the front of both buildings.',
      statPrice: '$22.00 /SF/YR', statSize: '6,000 SF', statLot: '1.39 AC', statZoning: 'C-3',
      agentNames: ['Zachary Stovall'], contacts: ['zack@crecotx.com', '(210) 817-3443', 'crecotx.com'],
      hero, galleryPhotos: gallery, mapBytes, siteAerials: siteAerial,
      fontBold: new Uint8Array(Buffer.from(OSWALD_BOLD_B64, 'base64')),
      logoPng: new Uint8Array(Buffer.from(CRECO_LOGO_PNG_B64, 'base64')),
    };
    if (modBefore) writeFileSync(path.join(outDir, `before-${n}photos.pdf`), await modBefore.renderFlyer({ ...base, highlights: rawHighlights }));
    writeFileSync(path.join(outDir, `after-${n}photos.pdf`), await modAfter.renderFlyer({ ...base, highlights, facts }));
    console.log('rendered', n);
  }
})().catch(e => { console.error(e); process.exit(1); });
