-- ============================================================================
-- Bucket-level upload size limits  (audit H3)
--
-- WHY: the presign routes hand the browser a signed upload URL, and the browser
-- then PUTs straight to storage. The API's size check is therefore advisory —
-- whatever it decides, the bucket is what actually enforces the ceiling. Only
-- `deal-docs` had a file_size_limit; the other four buckets accepted uploads of
-- unlimited size.
--
-- Limits are set at or above the caps the code already enforces, so no existing
-- flow changes:
--   images             25 MB   social upload caps at 12 MB; admin image uploads
--                              and the flyer extractor also write here
--   listing-files      50 MB   matches MAX_SIZE in listing-files/presign
--   transaction-forms  50 MB   e-sign source PDFs, lease drafts, CAM docs
--   receipts           25 MB   no writer in the codebase today
--   deal-docs          25 MB   unchanged (already set, matches DealDocUpload)
--
-- Idempotent: safe to re-run.
-- ============================================================================

update storage.buckets set file_size_limit = 26214400 where id = 'images'            and file_size_limit is distinct from 26214400;
update storage.buckets set file_size_limit = 52428800 where id = 'listing-files'     and file_size_limit is distinct from 52428800;
update storage.buckets set file_size_limit = 52428800 where id = 'transaction-forms' and file_size_limit is distinct from 52428800;
update storage.buckets set file_size_limit = 26214400 where id = 'receipts'          and file_size_limit is distinct from 26214400;

-- VERIFY
--   select id, public, file_size_limit from storage.buckets order by id;
