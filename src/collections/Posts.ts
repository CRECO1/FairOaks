import type { CollectionConfig } from 'payload';

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    group: 'Content',
    defaultColumns: ['title', 'category', 'publishedAt', 'featured'],
    description: 'Blog posts for the Hill Country Living editorial section.',
  },
  access: {
    read: () => true,
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'URL-friendly version of the title (auto-fill or type manually)',
      },
    },
    {
      name: 'excerpt',
      type: 'textarea',
      required: true,
      admin: {
        description: 'Short description shown in listing cards and meta description (150–200 chars)',
      },
    },
    {
      name: 'content',
      type: 'richText',
      required: true,
    },
    {
      name: 'featuredImage',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description: 'Hero image for the post (recommended: 1200×630px)',
      },
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      defaultValue: 'new-developments',
      options: [
        { label: 'New Developments', value: 'new-developments' },
        { label: 'Neighborhoods', value: 'neighborhoods' },
        { label: 'Market Update', value: 'market-update' },
        { label: 'Buyer Tips', value: 'buyer-tips' },
        { label: 'Seller Tips', value: 'seller-tips' },
        { label: 'Hill Country Lifestyle', value: 'lifestyle' },
      ],
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'agents',
      admin: {
        description: 'Byline agent (optional)',
      },
    },
    {
      name: 'publishedAt',
      type: 'date',
      required: true,
      admin: {
        date: { pickerAppearance: 'dayOnly', displayFormat: 'MMM d, yyyy' },
        description: 'Publication date shown on the post',
      },
    },
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Featured posts appear in the hero spot on the blog index',
      },
    },
    {
      name: 'seo',
      type: 'group',
      label: 'SEO',
      fields: [
        {
          name: 'metaTitle',
          type: 'text',
          admin: { description: 'Defaults to post title if left blank' },
        },
        {
          name: 'metaDescription',
          type: 'textarea',
          admin: { description: 'Defaults to excerpt if left blank' },
        },
      ],
    },
  ],
};
