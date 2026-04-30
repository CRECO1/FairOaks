import type { CollectionConfig } from 'payload';

export const Listings: CollectionConfig = {
  slug: 'listings',
  admin: {
    useAsTitle: 'title',
    group: 'Real Estate',
    defaultColumns: ['title', 'status', 'price', 'city', 'updatedAt'],
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
      admin: { description: 'URL-friendly identifier, e.g. 123-oak-trail-fair-oaks' },
    },
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Pending', value: 'pending' },
        { label: 'Sold', value: 'sold' },
        { label: 'Off Market', value: 'off-market' },
      ],
      defaultValue: 'active',
      required: true,
    },
    {
      name: 'price',
      type: 'number',
      required: true,
      admin: { description: 'Listing price in USD' },
    },
    {
      type: 'row',
      fields: [
        { name: 'address', type: 'text', required: true },
        { name: 'city', type: 'text', required: true, defaultValue: 'Fair Oaks Ranch' },
        { name: 'state', type: 'text', required: true, defaultValue: 'TX' },
        { name: 'zip', type: 'text', required: true },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'bedrooms', type: 'number', required: true },
        { name: 'bathrooms', type: 'number', required: true },
        { name: 'sqft', type: 'number', required: true },
        { name: 'lotSize', type: 'text' },
        { name: 'yearBuilt', type: 'number' },
      ],
    },
    {
      name: 'propertyType',
      type: 'select',
      options: [
        { label: 'Single Family', value: 'single-family' },
        { label: 'Condo / Townhome', value: 'condo' },
        { label: 'Land', value: 'land' },
        { label: 'Multi-Family', value: 'multi-family' },
      ],
      defaultValue: 'single-family',
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'features',
      type: 'array',
      fields: [{ name: 'feature', type: 'text' }],
      admin: { description: 'Key features (pool, fireplace, etc.)' },
    },
    {
      name: 'images',
      type: 'array',
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          required: true,
        },
      ],
    },
    {
      name: 'mlsNumber',
      type: 'text',
      admin: { description: 'MLS listing number' },
    },
    {
      name: 'virtualTourUrl',
      type: 'text',
    },
    {
      name: 'neighborhood',
      type: 'relationship',
      relationTo: 'neighborhoods',
    },
    {
      name: 'agent',
      type: 'relationship',
      relationTo: 'agents',
    },
    {
      name: 'listingDate',
      type: 'date',
    },
    {
      name: 'soldPrice',
      type: 'number',
      admin: { condition: (data) => data.status === 'sold' },
    },
    {
      name: 'soldDate',
      type: 'date',
      admin: { condition: (data) => data.status === 'sold' },
    },
    {
      name: 'daysOnMarket',
      type: 'number',
      admin: { condition: (data) => data.status === 'sold' },
    },
  ],
};
