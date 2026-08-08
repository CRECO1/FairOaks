-- 0003_office_suites_seed.sql
-- Seeds the office_suites table with the current tenants of 8000 Fair Oaks Pkwy,
-- Bldg 1 so the Properties tab is editable immediately (rather than relying on
-- the component's built-in defaults). Run AFTER 0002_office_suites.sql.
--
-- Idempotent: ON CONFLICT DO NOTHING means re-running will NOT overwrite any
-- edits made in the app. suite_key values must match SUITES[].key in
-- src/components/crm/PropertiesFloorPlan.tsx.

begin;

insert into public.office_suites (business_unit, building, floor, suite_key, suite_number, tenant_name, status, color)
values
  -- Floor 1
  ('commercial', 'bldg1', 1, 'therapy',        '101', 'Therapy',                'occupied', 'teal'),
  ('commercial', 'bldg1', 1, 'massage',         '105', 'Fair Oaks Massage',      'occupied', 'green'),
  ('commercial', 'bldg1', 1, 'am_massage',      '106', 'AM Massage',             'occupied', 'purple'),
  ('commercial', 'bldg1', 1, 'creco',           '100', 'CRECO',                  'occupied', 'amber'),
  ('commercial', 'bldg1', 1, 'forg',            '102', 'Fair Oaks Realty Group', 'occupied', 'blue'),
  ('commercial', 'bldg1', 1, 'genesis',         '104', 'Genesis Wealth Mgmt',    'occupied', 'rose'),
  -- Floor 2
  ('commercial', 'bldg1', 2, 'seamark',         '205', 'Seamark Counselling',    'occupied', 'teal'),
  ('commercial', 'bldg1', 2, 'windflower',      '206', 'Windflower',             'occupied', 'green'),
  ('commercial', 'bldg1', 2, 'marshall',        '103', 'Marshall Friday',        'occupied', 'amber'),
  ('commercial', 'bldg1', 2, 'pay_possible',    '204', 'Pay Possible',           'occupied', 'purple'),
  ('commercial', 'bldg1', 2, 'priority_power',  '201', 'Priority Power',         'occupied', 'blue'),
  ('commercial', 'bldg1', 2, 'home_lending',    '208', 'Home Lending',           'occupied', 'rose'),
  ('commercial', 'bldg1', 2, 'lg_construction', '202', 'L&G Construction',       'occupied', 'cyan')
on conflict (business_unit, building, floor, suite_key) do nothing;

commit;
