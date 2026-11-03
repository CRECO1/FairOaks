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
  /** search results only: a short plain-text excerpt around the match */
  snippet?: string;
}

export interface DriveListing {
  path: Array<{ id: string; name: string }>;
  folder: DriveFolder | null;
  folders: DriveFolder[];
  docs: DriveDoc[];
}

export interface DriveTreeFolder { id: string; parent_id: string | null; name: string; visibility: DriveVisibility; deal_id: string | null }

export const FOLDER_COLS = 'id,business_unit,parent_id,name,created_by,visibility,shared_with,deal_id,trashed_at,created_at,updated_at';
export const DOC_COLS = 'id,business_unit,folder_id,title,created_by,updated_by,visibility,shared_with,deal_id,trashed_at,created_at,updated_at,version';
