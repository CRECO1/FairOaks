import type { CollectionConfig } from 'payload';

export const Neighborhoods: CollectionConfig = {
  slug: 'neighborhoods',
  admin: {
    useAsTitle: 'name',
    group: 'Real Estate',
    defaultColumns: ['name', 'city', 'avgPrice', 'updatedAt'],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'city',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'avgPrice',
      type: 'number',
      admin: { description: 'Average home price in USD' },
    },
    {
      name: 'avgSqft',
      type: 'number',
    },
    {
      name: 'highlights',
      type: 'array',
      fields: [{ name: 'highlight', type: 'text' }],
      admin: { description: 'Key selling points (top schools, gated community, etc.)' },
    },
    {
      name: 'schoolDistrict',
      type: 'text',
    },
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'order',
      type: 'number',
      defaultValue: 99,
    },
  ],
};
