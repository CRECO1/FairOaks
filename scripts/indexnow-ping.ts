/**
 * IndexNow submission — pushes Fair Oaks Realty Group's key URLs to the IndexNow
 * network so a corrected page gets recrawled in hours instead of waiting on a
 * natural crawl. Mirrors the CRECO script, with the residential surface.
 *
 * One POST to api.indexnow.org fans out to every participating engine: Bing
 * (and therefore ChatGPT Search + Copilot, which read Bing's index), Yandex,
 * Seznam, Naver. Google does NOT consume IndexNow — for Google the owner still
 * has to request indexing in Search Console.
 *
 * The key is a public shared secret: it proves we control the host, because
 * IndexNow fetches `keyLocation` and checks the file contains the same string.
 * That is why the key file lives in /public and is committed — it is meant to be
 * served, not hidden.
 *
 * Usage:
 *   npx tsx scripts/indexnow-ping.ts                  # submit the key-page list
 *   npx tsx scripts/indexnow-ping.ts /some/new-page   # submit only these paths
 *
 * Every network call is bounded by REQUEST_TIMEOUT_MS; the script never hangs.
 */

const HOST = 'www.fairoaksrealtygroup.com';
const SITE_URL = `https://${HOST}`;
const KEY = '167e385bf37533a0d62e951d1ee3af41';
const KEY_LOCATION = `${SITE_URL}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The residential pages that matter most for AI answers and search: the core
 * buy/sell funnel, the geo surface, and the two files AI crawlers read first.
 */
export const KEY_PATHS = [
  '/',
  '/listings',
  '/homes-for-sale',
  '/sell',
  '/seller-guide',
  '/buyer-guide',
  '/neighborhoods',
  '/new-construction',
  '/luxury-homes',
  '/military-homebuying',
  '/relocation',
  '/investment-properties',
  '/schools',
  '/market-reports',
  '/team',
  '/contact',
  '/faq',
  '/services',
  '/sold',
  // Geo landing pages — the surface AI answers cite most.
  '/homes-for-sale/fair-oaks-ranch-tx',
  '/homes-for-sale/boerne-tx',
  '/homes-for-sale/helotes-tx',
  '/homes-for-sale/san-antonio-tx',
  '/homes-for-sale/bulverde-tx',
  '/homes-for-sale/new-braunfels-tx',
  '/homes-for-sale/canyon-lake-tx',
  '/homes-for-sale/spring-branch-tx',
  '/neighborhoods/fair-oaks-ranch',
  '/neighborhoods/cordillera-ranch',
  '/neighborhoods/the-dominion',
  // Read first by AI crawlers.
  '/llms.txt',
  '/llms-full.txt',
  '/sitemap.xml',
];

async function main() {
  const args = process.argv.slice(2).filter(a => a.startsWith('/'));
  const paths = args.length ? args : KEY_PATHS;
  const urlList = paths.map(p => `${SITE_URL}${p}`);

  // Fail fast if the key file is not actually being served — IndexNow will
  // reject the whole submission (422) and it is easier to diagnose here.
  const keyCheck = await fetch(KEY_LOCATION, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    .then(async r => ({ ok: r.ok, status: r.status, body: (await r.text()).trim() }))
    .catch(e => ({ ok: false, status: 0, body: String(e) }));

  if (!keyCheck.ok || keyCheck.body !== KEY) {
    console.error(`[indexnow] key file check FAILED at ${KEY_LOCATION}`);
    console.error(`           status=${keyCheck.status} body=${JSON.stringify(keyCheck.body).slice(0, 80)}`);
    console.error('           Deploy the key file before submitting.');
    process.exit(1);
  }
  console.log(`[indexnow] key file verified at ${KEY_LOCATION}`);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await res.text();
  // 200 = accepted, 202 = accepted pending key validation. Both are success.
  console.log(`[indexnow] submitted ${urlList.length} URLs → HTTP ${res.status} ${text || '(empty body)'}`);
  if (res.status !== 200 && res.status !== 202) process.exit(1);
}

main().catch(e => { console.error('[indexnow] failed:', e); process.exit(1); });
