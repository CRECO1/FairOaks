/**
 * Generate the two recruiting one-pagers Zack hands to or emails an agent:
 * one Fair Oaks Realty Group (residential), one CRECO (commercial).
 *
 * The pitch is the same truthful set used on /join and /careers — a hands-on
 * broker/owner, the in-house CRM with e-signature and automation, the lead
 * generation we run, the search presence, and the two-brokerage referral path.
 *
 * Economics are deliberately absent. The broker has settled the terms, but
 * these sheets circulate, so they carry one neutral line and no figures — no
 * split percentage, cap, fee or contractor classification. See TERMS_LINE.
 *
 * Brand separation is absolute — each sheet carries only its own logo, colour,
 * suite number and business line. Fair Oaks is Suite 102 / (210) 390-9997;
 * CRECO is Suite 100 / (210) 817-3443.
 *
 * Output: /Users/creco/Documents/CRECO/Marketing/recruiting/
 * Usage:  node scripts/generate-recruiting-onepagers.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const OUT_DIR = '/Users/creco/Documents/CRECO/Marketing/recruiting';
const REPO = '/Users/creco/Documents/CRECO';

const PAGE = { w: 612, h: 792 };           // US Letter
const M = 48;                              // page margin
const CONTENT_W = PAGE.w - M * 2;

// ── Brands ──────────────────────────────────────────────────────────────────
const BRANDS = [
  {
    key: 'fair-oaks',
    file: 'Why-Join-Fair-Oaks-Realty-Group.pdf',
    name: 'Fair Oaks Realty Group',
    tagline: 'Residential · Texas Hill Country',
    logo: path.join(REPO, 'FairOaks-consolidate/public/images/logo.png'),
    ink: rgb(0.10, 0.10, 0.10),            // #1A1A1A
    accent: rgb(0.788, 0.663, 0.384),      // #C9A962 gold
    wash: rgb(0.961, 0.941, 0.902),        // #F5F0E6 cream
    phone: '(210) 390-9997',
    email: 'info@fairoaksrealtygroup.com',
    site: 'www.fairoaksrealtygroup.com',
    address: '8000 Fair Oaks Pkwy, Suite 102, Fair Oaks Ranch, TX 78015',
    applyUrl: 'www.fairoaksrealtygroup.com/join',
    headline: 'A brokerage where you can reach the broker directly.',
    intro:
      'Fair Oaks Realty Group is a Hill Country residential brokerage led hands-on by Zachary A. Stovall. Small by choice: you get a broker who answers, technology built for this office, and lead flow you inherit on day one.',
    props: [
      ['You work directly with the broker',
       'Zachary Stovall is a hands-on broker/owner, not a name on the wall. Bring him a deal question, get an answer the same day — from the person who signs off on the file.'],
      ['A CRM built for this brokerage',
       'Not a bolt-on you pay for separately. Contacts, action plans and campaigns, with e-signature built in so you send a document for signature and track it without leaving the system.'],
      ['Lead generation you inherit on day one',
       'Website capture, follow-up automation, and a CRM that routes new inquiries to an owner instead of letting them sit in an inbox.'],
      ['Found on Google and by AI search',
       'We invest in how this brokerage shows up in search — including the AI assistants buyers now ask first. Your listings sit on a site built to be found and cited.'],
      ['Two brokerages, one roof',
       'Residential here, commercial at our sister company CRECO. Your client with a business need has somewhere to go, and commercial clients needing a home come back the other way. You refer across instead of giving the deal away.'],
    ],
  },
  {
    key: 'creco',
    file: 'Why-Join-CRECO.pdf',
    name: 'CRECO',
    tagline: 'Commercial Real Estate Company · Texas',
    logo: path.join(REPO, 'CRECOWEBSITE/public/images/creco-logo-light.png'),
    ink: rgb(0.06, 0.09, 0.28),            // CRECO navy
    accent: rgb(0.788, 0.663, 0.384),
    wash: rgb(0.957, 0.961, 0.973),
    phone: '(210) 817-3443',
    email: 'info@crecotx.com',
    site: 'www.crecotx.com',
    address: '8000 Fair Oaks Pkwy, Suite 100, Fair Oaks Ranch, TX 78015',
    applyUrl: 'www.crecotx.com/careers',
    headline: 'Principal-led commercial brokerage. Real deals, direct access.',
    intro:
      'CRECO is a small, principal-led Texas commercial firm — tenant rep, owner services, leasing and investment advisory. You work assignments alongside the people making the decisions, on infrastructure that already exists.',
    props: [
      ['Principal-led, not an agent farm',
       'You work alongside Zachary Stovall, broker/owner, and Brian Blanco, who runs an active leasing pipeline. Small team, direct access, and you learn how deals actually get done.'],
      ['Deal infrastructure that already exists',
       'A custom CRM with e-signature and automation: LOIs and lease documents out for signature, tenant and landlord records, tasks and follow-up that runs itself. No rebuilding a tech stack on your own dime.'],
      ['Live leasing pipeline and lead flow',
       "Brian's leasing pipeline is active and we run ongoing lead generation into the CRM. Real product to work from your first week rather than a cold start."],
      ['Search presence that surfaces your listings',
       'Serious work goes into how CRECO ranks on Google and how AI search tools cite us. Tenants and investors researching Texas space find our listings — which means they find yours.'],
      ['Commercial and residential under one owner',
       'Commercial here, residential at our sister brokerage Fair Oaks Realty Group. Your tenant buying a house, your investor selling a residence — that referral stays in the family.'],
    ],
  },
];

/**
 * Economics line for the handout.
 *
 * The broker has settled the actual terms, but these sheets circulate — they
 * get emailed on, forwarded and left on desks — so they are treated as public.
 * No split percentage, cap, fee figure or contractor classification is printed
 * here. The real terms are recorded only in
 * /Users/creco/Documents/CRECO/Marketing/recruiting/INTERNAL-recruiting-terms.md.
 *
 * If a private candidate version carrying the numbers is ever wanted, it
 * should be a separate, clearly-marked output — never this file.
 */
const TERMS_LINE = 'Compensation & terms reviewed privately with you.';

// ── Layout helpers ──────────────────────────────────────────────────────────

/** Greedy wrap to a pixel width. Returns the lines. */
function wrap(text, font, size, maxW) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxW) {
      line = candidate;
    } else {
      if (line) out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

function drawParagraph(page, text, { x, y, font, size, color, maxW, leading }) {
  const lines = wrap(text, font, size, maxW);
  for (const line of lines) {
    page.drawText(line, { x, y, size, font, color });
    y -= leading;
  }
  return y;
}

async function buildBrand(brand) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE.w, PAGE.h]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const grey = rgb(0.38, 0.38, 0.40);
  const rule = rgb(0.85, 0.85, 0.87);

  // ── Header band ──
  const BAND_H = 92;
  page.drawRectangle({ x: 0, y: PAGE.h - BAND_H, width: PAGE.w, height: BAND_H, color: brand.ink });

  // Logo, right-aligned in the band, scaled to fit.
  if (fs.existsSync(brand.logo)) {
    const img = await pdf.embedPng(fs.readFileSync(brand.logo));
    const maxH = 46, maxW = 190;
    const scale = Math.min(maxH / img.height, maxW / img.width);
    const w = img.width * scale, h = img.height * scale;
    page.drawImage(img, { x: PAGE.w - M - w, y: PAGE.h - BAND_H / 2 - h / 2, width: w, height: h });
  } else {
    throw new Error(`logo missing: ${brand.logo}`);
  }

  page.drawText(brand.name, {
    x: M, y: PAGE.h - 46, size: 21, font: bold, color: rgb(1, 1, 1),
  });
  page.drawText(brand.tagline, {
    x: M, y: PAGE.h - 64, size: 9.5, font: reg, color: brand.accent,
  });
  page.drawText('NOW HIRING AGENTS', {
    x: M, y: PAGE.h - 80, size: 8, font: bold, color: rgb(1, 1, 1),
  });

  let y = PAGE.h - BAND_H - 36;

  // ── Headline ──
  y = drawParagraph(page, brand.headline, {
    x: M, y, font: bold, size: 17, color: brand.ink, maxW: CONTENT_W, leading: 22,
  });
  y -= 6;

  // ── Intro ──
  y = drawParagraph(page, brand.intro, {
    x: M, y, font: reg, size: 9.8, color: grey, maxW: CONTENT_W, leading: 14,
  });
  y -= 14;

  // ── Value props ──
  page.drawText('WHAT YOU GET', { x: M, y, size: 8.5, font: bold, color: brand.accent });
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: PAGE.w - M, y }, thickness: 0.8, color: rule });
  y -= 18;

  for (const [title, body] of brand.props) {
    page.drawRectangle({ x: M, y: y - 2, width: 3, height: 11, color: brand.accent });
    page.drawText(title, { x: M + 11, y, size: 10.5, font: bold, color: brand.ink });
    y -= 14;
    y = drawParagraph(page, body, {
      x: M + 11, y, font: reg, size: 9.2, color: grey, maxW: CONTENT_W - 11, leading: 12.4,
    });
    y -= 10;
  }

  // ── Compensation band ──
  // One neutral line, no figures: these sheets circulate — emailed on,
  // forwarded, left on desks — so they are treated as public.
  y -= 2;
  const boxTop = y;
  const boxH = 46;
  page.drawRectangle({
    x: M, y: boxTop - boxH, width: CONTENT_W, height: boxH,
    color: brand.wash, borderColor: brand.accent, borderWidth: 0.9,
  });
  page.drawText(TERMS_LINE, {
    x: M + 16, y: boxTop - 21, size: 10.5, font: bold, color: brand.ink,
  });
  page.drawText('Bring your questions to the first call — Zack answers them himself.', {
    x: M + 16, y: boxTop - 35, size: 8.5, font: italic, color: grey,
  });

  // ── Apply strip ──
  // Pinned just above the footer rather than left to flow, so the sheet ends
  // on the call to action instead of a band of dead white space.
  const contentBottom = boxTop - boxH;
  // Sits just under the compensation band, but never low enough to crowd the
  // footer — so the sheet reads as one block rather than trailing off.
  const APPLY_Y = Math.max(112, contentBottom - 44);
  if (contentBottom < 112 + 24) {
    throw new Error(
      `${brand.name}: content runs into the apply strip (bottom ${contentBottom.toFixed(0)}pt). Trim a value prop.`,
    );
  }
  y = APPLY_Y;
  page.drawRectangle({ x: M, y: y - 30, width: CONTENT_W, height: 34, color: brand.ink });
  page.drawText('Apply:', { x: M + 14, y: y - 19, size: 10, font: reg, color: rgb(1, 1, 1) });
  page.drawText(brand.applyUrl, { x: M + 56, y: y - 19, size: 10.5, font: bold, color: brand.accent });
  page.drawText(`or call ${brand.phone}`, {
    x: PAGE.w - M - 14 - reg.widthOfTextAtSize(`or call ${brand.phone}`, 9.5),
    y: y - 19, size: 9.5, font: reg, color: rgb(1, 1, 1),
  });

  // ── Footer: NAP ──
  const footY = 46;
  page.drawLine({
    start: { x: M, y: footY + 22 }, end: { x: PAGE.w - M, y: footY + 22 },
    thickness: 0.8, color: rule,
  });
  page.drawText(brand.name, { x: M, y: footY + 8, size: 8.5, font: bold, color: brand.ink });
  page.drawText(brand.address, { x: M, y: footY - 3, size: 8, font: reg, color: grey });
  page.drawText(`${brand.phone}  ·  ${brand.email}  ·  ${brand.site}`, {
    x: M, y: footY - 14, size: 8, font: reg, color: grey,
  });
  page.drawText('Zachary A. Stovall, Broker · TREC #9014367', {
    x: PAGE.w - M - reg.widthOfTextAtSize('Zachary A. Stovall, Broker · TREC #9014367', 7.5),
    y: footY - 14, size: 7.5, font: reg, color: grey,
  });

  pdf.setTitle(`Why join ${brand.name}`);
  pdf.setAuthor(brand.name);
  pdf.setSubject('Agent recruiting one-pager');
  pdf.setProducer('generate-recruiting-onepagers.mjs (pdf-lib)');

  const out = path.join(OUT_DIR, brand.file);
  fs.writeFileSync(out, await pdf.save());
  return out;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const brand of BRANDS) {
  const out = await buildBrand(brand);
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
}
