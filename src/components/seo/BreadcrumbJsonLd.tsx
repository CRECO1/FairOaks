import { jsonLdScript } from '@/lib/json-ld';
import { SITE_URL } from '@/lib/site-identity';

/** BreadcrumbList for a page: Home → …crumbs. Paths are site-relative. */
export function BreadcrumbJsonLd({ crumbs }: { crumbs: { name: string; path: string }[] }) {
  const all = [{ name: 'Home', path: '/' }, ...crumbs];
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: all.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.path === '/' ? '' : c.path}`,
    })),
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />;
}
