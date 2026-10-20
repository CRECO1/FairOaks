// How a document's title reads to a person. Imported documents carry their file name as the
// title ("Commercial_Lease_Amendment__filled_"); an unbroken underscore run can't wrap on a
// phone and reads like a file path. Display only — the stored title is left alone.
export const friendlyTitle = (t?: string | null): string => {
  const s = String(t || '').replace(/\.pdf$/i, '').replace(/_+/g, ' ').replace(/\s*\(?\bfilled\b\)?\s*$/i, '').replace(/\s+/g, ' ').trim();
  return s || 'Document';
};
