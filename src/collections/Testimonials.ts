import type { CollectionConfig } from 'payload';

export const Testimonials: CollectionConfig = {
  slug: 'testimonials',
  admin: {
    useAsTitle: 'clientName',
    group: 'Content',
    defaultColumns: ['clientName', 'rating', 'featured', 'updatedAt'],
  },
  fields: [
    {
      name: 'clientName',
      type: 'text',
      required: true,
    },
    {
      name: 'clientLocation',
      type: 'text',
      admin: { description: 'e.g. Fair Oaks Ranch, TX' },
    },
    {
      name: 'quote',
      type: 'textarea',
      required: true,
    },
    {
      name: 'rating',
      type: 'number',
      required: true,
      min: 1,
      max: 5,
      defaultValue: 5,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'agent',
      type: 'relationship',
      relationTo: 'agents',
    },
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Show on home page' },
    },
    {
      name: 'order',
      type: 'number',
      defaultValue: 99,
    },
  ],
};
