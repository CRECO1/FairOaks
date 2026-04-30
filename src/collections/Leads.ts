import type { CollectionConfig } from 'payload';

export const Leads: CollectionConfig = {
  slug: 'leads',
  admin: {
    useAsTitle: 'name',
    group: 'Administration',
    defaultColumns: ['name', 'email', 'source', 'status', 'createdAt'],
    hideAPIURL: true,
  },
  access: {
    create: () => true,
    read: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'email',
      type: 'email',
      required: true,
    },
    {
      name: 'phone',
      type: 'text',
    },
    {
      name: 'message',
      type: 'textarea',
    },
    {
      name: 'source',
      type: 'select',
      options: [
        { label: 'Contact Form', value: 'contact' },
        { label: 'Quiz', value: 'quiz' },
        { label: 'Listing Inquiry', value: 'listing' },
        { label: 'Home Valuation', value: 'valuation' },
        { label: 'Schedule Call', value: 'schedule' },
      ],
      defaultValue: 'contact',
    },
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'New', value: 'new' },
        { label: 'Contacted', value: 'contacted' },
        { label: 'Qualified', value: 'qualified' },
        { label: 'Converted', value: 'converted' },
        { label: 'Closed', value: 'closed' },
      ],
      defaultValue: 'new',
    },
    {
      name: 'propertyInterest',
      type: 'text',
      admin: { description: 'Which property or area they inquired about' },
    },
    {
      name: 'quizData',
      type: 'json',
      admin: { description: 'Quiz answers (if lead came from quiz)' },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { description: 'Internal notes' },
    },
    {
      name: 'assignedAgent',
      type: 'relationship',
      relationTo: 'agents',
    },
  ],
};
