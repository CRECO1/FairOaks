import CRMAppClient from '@/components/crm/CRMAppClient';

export const metadata = { title: 'Fair Oaks CRM — Residential' };

export default function ResidentialCRM() {
  return <CRMAppClient businessUnit="residential" />;
}
