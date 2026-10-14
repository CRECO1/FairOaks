/**
 * User agents that are never a person working in the CRM: headless browsers,
 * browser-automation drivers, HTTP libraries and command-line clients, and the
 * AI / search crawlers. Edge-safe (no Node imports) so middleware can use it.
 *
 * A user agent is a claim, and a determined scraper can send a normal Chrome
 * string. This is the first, cheap layer: it stops the off-the-shelf tools that
 * announce themselves. The in-browser check (navigator.webdriver, see
 * components/crm/CrmShield.tsx) and the per-user read budgets
 * (lib/crm-read-guard.ts) are the layers behind it.
 */
export const AUTOMATION_UA = new RegExp([
  // Headless / automation drivers
  'HeadlessChrome', 'PhantomJS', 'Puppeteer', 'Playwright', 'Selenium', 'WebDriver',
  'Cypress', 'Electron/.*Headless', 'SlimerJS', 'Splash', 'browserless', 'Nightmare',
  // HTTP libraries and CLIs
  'curl/', 'Wget', 'python-requests', 'python-urllib', 'aiohttp', 'httpx', 'Scrapy',
  'Go-http-client', 'node-fetch', 'axios/', 'undici', 'okhttp', 'Java/', 'Apache-HttpClient',
  'libwww-perl', 'HTTPie', 'PostmanRuntime', 'insomnia', 'Ruby', 'colly', 'httrack',
  // Crawlers, scrapers and AI agents
  'Bot/', 'crawler', 'spider', 'scraper', 'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'PerplexityBot',
  'Perplexity-User', 'CCBot', 'Bytespider', 'Amazonbot', 'meta-external', 'cohere-ai',
  'Diffbot', 'Firecrawl', 'Apify', 'ScrapingBee', 'ZenRows', 'Crawl4AI', 'Jina',
].join('|'), 'i');

export function isAutomationUA(ua: string | null | undefined): boolean {
  // No user agent at all is a script, not a browser.
  if (!ua || !ua.trim()) return true;
  return AUTOMATION_UA.test(ua);
}
