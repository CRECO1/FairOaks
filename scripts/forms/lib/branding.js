// Shared CRECO letterhead for the generated LOI templates: a page-1 logo header
// and an every-page footer, matching the branded LOI the user provided. Consumed
// by the LOI generators via require('../lib/branding').
const fs = require('fs');
const path = require('path');
const { rgb, StandardFonts } = require('pdf-lib');

const LOGO_BYTES = fs.readFileSync(path.join(__dirname, '..', 'assets', 'creco-logo.png'));
const BLACK = rgb(0.11, 0.11, 0.12);
const GRAY  = rgb(0.34, 0.36, 0.40);
const ITAL  = rgb(0.20, 0.20, 0.22);

const PH = 792;                 // US Letter height
const LOGO_W = 240;             // header logo width (points); height derives from aspect
const CONTENT_BOTTOM = 80;      // body must stay above this — the footer sits below it
const FOOTER_RULE_Y = 64;

const HEAD_CONTACT = '8000 Fair Oaks Pkwy, Suite 102, Fair Oaks Ranch, TX 78015      •      (210) 817-3443      •      crecotx.com';
const FOOT_TAG     = 'Where your real estate ventures find the support they deserve';
const FOOT_CONTACT = '8000 Fair Oaks Pkwy, Suite 102, Fair Oaks Ranch, TX 78015   |   (210) 817-3443   |   info@crecotx.com   |   crecotx.com';

async function loadBranding(doc) {
  return {
    logo: await doc.embedPng(LOGO_BYTES),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  };
}

function center(page, text, y, size, font, color, PW) {
  page.drawText(text, { x: (PW - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
}

// Page-1 logo letterhead. Returns the y at which body content should begin.
function drawHeader(page, { logo, times, PW, M }) {
  const h = LOGO_W * (logo.height / logo.width);
  const logoY = PH - 30 - h;
  page.drawImage(logo, { x: (PW - LOGO_W) / 2, y: logoY, width: LOGO_W, height: h });
  let y = logoY - 13;
  center(page, HEAD_CONTACT, y, 8, times, GRAY, PW);
  y -= 9;
  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 2.4, color: BLACK });
  return y - 20;
}

// Footer band — drawn on every page.
function drawFooter(page, { times, italic, PW, M }) {
  page.drawLine({ start: { x: M, y: FOOTER_RULE_Y }, end: { x: PW - M, y: FOOTER_RULE_Y }, thickness: 2.4, color: BLACK });
  center(page, FOOT_TAG, FOOTER_RULE_Y - 13, 8.5, italic, ITAL, PW);
  center(page, FOOT_CONTACT, FOOTER_RULE_Y - 24, 7.5, times, GRAY, PW);
}

module.exports = { loadBranding, drawHeader, drawFooter, CONTENT_BOTTOM };
