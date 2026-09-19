import CRMAppClient from '@/components/crm/CRMAppClient';

export const metadata = { title: 'CRECO CRM — Commercial' };

export default function CommercialCRM() {
  return <CRMAppClient businessUnit="commercial" />;
}
