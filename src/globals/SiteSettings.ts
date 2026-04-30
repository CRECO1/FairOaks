import type { GlobalConfig } from 'payload';

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  admin: {
    group: 'Administration',
  },
  fields: [
    {
      name: 'siteName',
      type: 'text',
      defaultValue: 'Fair Oaks Realty Group',
    },
    {
      name: 'phone',
      type: 'text',
      defaultValue: '(210) 390-9997',
    },
    {
      name: 'email',
      type: 'email',
      defaultValue: 'info@fairoaksrealtygroup.com',
    },
    {
      name: 'address',
      type: 'group',
      fields: [
        { name: 'street', type: 'text', defaultValue: '7510 FM 1560 N, Ste 101' },
        { name: 'city', type: 'text', defaultValue: 'Fair Oaks Ranch' },
        { name: 'state', type: 'text', defaultValue: 'TX' },
        { name: 'zip', type: 'text', defaultValue: '78015' },
      ],
    },
    {
      name: 'socialLinks',
      type: 'group',
      fields: [
        { name: 'facebook', type: 'text' },
        { name: 'instagram', type: 'text' },
        { name: 'linkedin', type: 'text' },
        { name: 'youtube', type: 'text' },
      ],
    },
    {
      name: 'heroHeadline',
      type: 'text',
      defaultValue: 'Your Home in the Texas Hill Country',
    },
    {
      name: 'heroSubheadline',
      type: 'textarea',
      defaultValue: 'Trusted local experts helping families find the perfect home in Fair Oaks Ranch, Boerne, and the greater San Antonio area.',
    },
    {
      name: 'featuredListingsTitle',
      type: 'text',
      defaultValue: 'Featured Properties',
    },
    {
      name: 'stats',
      type: 'group',
      fields: [
        { name: 'homesSold', type: 'number', defaultValue: 500 },
        { name: 'yearsExperience', type: 'number', defaultValue: 20 },
        { name: 'clientSatisfaction', type: 'number', defaultValue: 98 },
        { name: 'avgDaysOnMarket', type: 'number', defaultValue: 21 },
      ],
    },
    {
      name: 'metaTitle',
      type: 'text',
    },
    {
      name: 'metaDescription',
      type: 'textarea',
    },
  ],
};
