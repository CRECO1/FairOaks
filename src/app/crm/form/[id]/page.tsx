import DriveFormPage from '@/components/crm/drive/DriveFormPage';

export const metadata = { title: 'My Drive' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DriveFormPage submissionId={id} />;
}
