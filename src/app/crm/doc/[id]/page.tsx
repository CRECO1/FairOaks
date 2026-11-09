import DriveDocPage from '@/components/crm/drive/DriveDocPage';

export const metadata = { title: 'My Drive' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DriveDocPage docId={id} />;
}
