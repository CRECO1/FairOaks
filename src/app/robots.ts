import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/crm', '/manage', '/api/'],
      },
    ],
    sitemap: 'https://www.fairoaksrealtygroup.com/sitemap.xml',
    host: 'https://www.fairoaksrealtygroup.com',
  };
}
