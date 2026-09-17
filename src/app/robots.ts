import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-identity';

/**
 * robots.txt.
 *
 * Private surfaces are never crawled:
 *   /admin, /manage, /api/  — internal tools and endpoints
 *   /crm                    — the agent CRM
 *   /sign/                  — private e-signature links (each URL carries a signer's token)
 *   /signup                 — CRM account setup
 *   /billing, /client/      — kept in step with crecotx.com's rules
 *
 * AI crawlers: Fair Oaks Realty Group wants to be read, cited, and recommended by AI
 * assistants and answer engines. Each major AI user agent gets an explicit group that
 * allows the public site and the /llms.txt reference files. A crawler that matches a
 * named group ignores the `*` group, so the private disallows are repeated there.
 */
const PRIVATE_PATHS = ['/admin', '/crm', '/manage', '/api/', '/sign/', '/signup', '/billing', '/client/'];

const AI_CRAWLERS = [
  // OpenAI
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  // Anthropic
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'Claude-Web',
  // Perplexity
  'PerplexityBot', 'Perplexity-User',
  // Google (Gemini / AI training control) + Apple Intelligence
  'Google-Extended', 'Applebot', 'Applebot-Extended',
  // Common Crawl (feeds many LLM datasets), ByteDance, Amazon, Meta, Microsoft, others
  'CCBot', 'Bytespider', 'Amazonbot', 'Meta-ExternalAgent', 'FacebookBot', 'Bingbot',
  'DuckAssistBot', 'MistralAI-User', 'cohere-ai', 'YouBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: AI_CRAWLERS,
        allow: ['/', '/llms.txt', '/llms-full.txt'],
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
