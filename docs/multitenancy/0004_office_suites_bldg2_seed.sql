-- 0004_office_suites_bldg2_seed.sql
-- Seeds Building 2 (3100s / 3200s) suites so the Properties tab's Building 2
-- view is backed by DB rows you can edit. Run AFTER 0002_office_suites.sql.
--
-- Idempotent: ON CONFLICT DO NOTHING — re-running won't overwrite later edits.
-- suite_key values must match SUITES[].key (building 'bldg2') in
-- src/components/crm/PropertiesFloorPlan.tsx.

begin;

insert into public.office_suites (business_unit, building, floor, suite_key, suite_number, tenant_name, status, color)
values
  -- Building 2 · Floor 1
  ('commercial', 'bldg2', 1, 'ceco_concrete',        '3100', 'Ceco Concrete',             'occupied', 'amber'),
  ('commercial', 'bldg2', 1, 'central_texas',        '3102', 'Central Texas Tree Service','occupied', 'green'),
  ('commercial', 'bldg2', 1, 'emergency_diagnostic', '3115', 'Emergency Diagnostic',      'occupied', 'rose'),
  ('commercial', 'bldg2', 1, 'cherie',               '3101', 'A. Cherie Coutour',         'occupied', 'purple'),
  ('commercial', 'bldg2', 1, 'open_3108',            '',     'Open',                      'vacant',   'gray'),
  ('commercial', 'bldg2', 1, 'fair_oaks_financial',  '3109', 'Fair Oaks Financial',       'occupied', 'blue'),
  ('commercial', 'bldg2', 1, 'donnelly',             '3117', 'Donnelly & Assoc.',         'occupied', 'teal'),
  -- Building 2 · Floor 2
  ('commercial', 'bldg2', 2, 'kjf_3200',  '3200', 'KJF Insurance', 'occupied', 'blue'),
  ('commercial', 'bldg2', 2, 'kjf_3204',  '3204', 'KJF Insurance', 'occupied', 'blue'),
  ('commercial', 'bldg2', 2, 'kjf_3206',  '3206', 'KJF Insurance', 'occupied', 'blue'),
  ('commercial', 'bldg2', 2, 'tbi_3216',  '3216', 'TBI Warrior',   'occupied', 'green'),
  ('commercial', 'bldg2', 2, 'tbi_3218',  '3218', 'TBI Warrior',   'occupied', 'green'),
  ('commercial', 'bldg2', 2, 'here_now',  '3201', 'Here & Now',    'occupied', 'amber'),
  ('commercial', 'bldg2', 2, 'open_3210', '',     'Open',          'vacant',   'gray'),
  ('commercial', 'bldg2', 2, 'mhs_parks', '3222', 'MHS Parks',     'occupied', 'purple'),
  ('commercial', 'bldg2', 2, 'tbi_3217a', '3217', 'TBI Warrior',   'occupied', 'green'),
  ('commercial', 'bldg2', 2, 'tbi_3217b', '3217', 'TBI Warrior',   'occupied', 'green')
on conflict (business_unit, building, floor, suite_key) do nothing;

commit;
