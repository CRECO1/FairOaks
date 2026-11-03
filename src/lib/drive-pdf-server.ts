import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { docToPdf, pdfName, type PMNode } from '@/lib/doc-pdf';
import { adminClient } from '@/lib/supabase-admin';

/** A My Drive document as a PDF, built on the server from its saved state (the same renderer the editor's "PDF" button uses). */
export async function driveDocPdf(docId: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const { data } = await adminClient().from('crm_drive_docs').select('title,ystate,trashed_at').eq('id', docId).maybeSingle();
  if (!data || data.trashed_at || !data.ystate) return null;
  const d = new Y.Doc();
  try {
    Y.applyUpdate(d, new Uint8Array(Buffer.from(data.ystate as string, 'base64')));
    const json = yXmlFragmentToProsemirrorJSON(d.getXmlFragment('default')) as PMNode;
    const letterhead = d.getMap('meta').get('letterhead') === true;
    const title = (data.title as string) || 'Document';
    return { name: pdfName(title), bytes: await docToPdf(json, title, { letterhead }) };
  } finally { d.destroy(); }
}
