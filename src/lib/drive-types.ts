// Shared by the Drive API routes and the Transaction Docs "Drive" UI (supabase/drive-docs-2026-11.sql).

export type DriveVisibility = 'team' | 'private';

export interface DriveFolder {
  id: string;
  business_unit: string;
  parent_id: string | null;
  name: string;
  created_by: string | null;
  visibility: DriveVisibility;
  shared_with: string[];
  deal_id: string | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriveDoc {
  id: string;
  business_unit: string;
  folder_id: string | null;
  title: string;
  created_by: string | null;
  updated_by: string | null;
  visibility: DriveVisibility;
  shared_with: string[];
  deal_id: string | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  /** a reusable starting point (lives under Templates, outside the folders) */
  is_template?: boolean;
  /** search results only: a short plain-text excerpt around the match */
  snippet?: string;
}

/** An uploaded file (PDF, Word, Excel, image…) stored in the private `drive-files` bucket. */
export interface DriveFile {
  id: string;
  business_unit: string;
  folder_id: string | null;
  name: string;
  size: number | null;
  mime: string | null;
  created_by: string | null;
  visibility: DriveVisibility;
  shared_with: string[];
  deal_id: string | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A transaction form (TREC, TXR, lease, LOI …) filed in a Drive folder: the link row (crm_drive_forms) plus what it points at.
 * `visibility` / `shared_with` / `deal_id` are constant here (forms live only in team folders) so a form item looks like the others.
 */
export interface DriveFormItem {
  id: string;
  business_unit: string;
  folder_id: string | null;
  submission_id: string;
  created_by: string | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  form_id: string | null;
  form_name: string | null;
  form_code: string | null;
  status: string | null;
  has_pdf: boolean;
  visibility: 'team';
  shared_with: string[];
  deal_id: null;
}

export interface DriveListing {
  path: Array<{ id: string; name: string }>;
  folder: DriveFolder | null;
  folders: DriveFolder[];
  docs: DriveDoc[];
  files?: DriveFile[];
  forms?: DriveFormItem[];
}

export interface DriveTreeFolder { id: string; parent_id: string | null; name: string; visibility: DriveVisibility; deal_id: string | null }

export const FOLDER_COLS = 'id,business_unit,parent_id,name,created_by,visibility,shared_with,deal_id,trashed_at,created_at,updated_at';
export const DOC_COLS = 'id,business_unit,folder_id,title,created_by,updated_by,visibility,shared_with,deal_id,trashed_at,created_at,updated_at,version,is_template';

export const FILE_COLS = 'id,business_unit,folder_id,name,size,mime,created_by,visibility,shared_with,deal_id,trashed_at,created_at,updated_at';
/** Extension → content type for what the Drive accepts (the bucket enforces the same list). */
export const DRIVE_FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  txt: 'text/plain',
};
export const DRIVE_FILE_MAX = 50 * 1024 * 1024;

/** A comment or reply on a live document. A top-level comment's id is also the id of its highlight mark in the document. */
export interface DriveComment {
  id: string;
  doc_id: string;
  parent_id: string | null;
  author_id: string | null;
  body: string;
  mentions: string[];
  anchor_text: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface DriveVersion {
  id: string;
  doc_id: string;
  label: string | null;
  kind: 'auto' | 'manual' | 'restore';
  size: number | null;
  created_by: string | null;
  created_at: string;
}

export const FORM_LINK_COLS = 'id,business_unit,folder_id,submission_id,created_by,trashed_at,created_at,updated_at';
