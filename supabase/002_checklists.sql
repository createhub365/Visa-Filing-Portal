-- Visa Filing Portal - checklist builder (run after schema.sql)
-- Admin builds checklists per country + visa type + applicant type (salaried / business).

alter table public.users add column if not exists applicant_type text not null default ''
  check (applicant_type in ('', 'salaried', 'business'));

-- library of document names the admin picks from (custom ones get added here too)
create table if not exists public.doc_types (
  id bigint generated always as identity primary key,
  name text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.checklist_templates (
  id bigint generated always as identity primary key,
  country text not null,
  visa_type text not null,
  applicant_type text not null check (applicant_type in ('salaried', 'business')),
  items jsonb not null default '[]'::jsonb, -- [{"name": "...", "description": "..."}]
  created_by bigint references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country, visa_type, applicant_type)
);
create index if not exists checklist_templates_created_by_idx on public.checklist_templates (created_by);

-- "please create a checklist for this customer" requests to the admin
create table if not exists public.checklist_requests (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.users (id) on delete cascade,
  requested_by bigint references public.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists checklist_requests_one_pending on public.checklist_requests (customer_id) where status = 'pending';
create index if not exists checklist_requests_requested_by_idx on public.checklist_requests (requested_by);

alter table public.doc_types enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.checklist_requests enable row level security;
revoke all on public.doc_types, public.checklist_templates, public.checklist_requests from anon, authenticated;

create or replace function public.portal_stats()
returns json language sql stable set search_path = '' as $$
  select json_build_object(
    'customers', (select count(*) from public.users where role = 'customer'),
    'staff',     (select count(*) from public.users where role = 'staff'),
    'in_review', (select count(*) from public.checklist_items where status = 'in_review'),
    'accepted',  (select count(*) from public.checklist_items where status = 'accepted'),
    'rejected',  (select count(*) from public.checklist_items where status = 'rejected'),
    'pending',   (select count(*) from public.checklist_items where status = 'pending'),
    'removals',  (select count(*) from public.removal_requests where status = 'pending'),
    'checklist_requests', (select count(*) from public.checklist_requests where status = 'pending'),
    'no_checklist', (select count(*) from public.users u where u.role = 'customer'
                       and not exists (select 1 from public.checklist_items i where i.customer_id = u.id))
  );
$$;
revoke execute on function public.portal_stats() from public, anon, authenticated;
grant execute on function public.portal_stats() to service_role;

insert into public.doc_types (name) values
  ('Passport (first & last page)'), ('Old passports'), ('Passport size photograph'), ('Aadhaar card'), ('PAN card'),
  ('Visa application form'), ('Cover letter'), ('Previous visa copies'),
  ('Bank statement (last 6 months)'), ('Bank balance certificate'), ('Income tax returns (last 3 years)'),
  ('Fixed deposit receipts'), ('Property documents'),
  ('Salary slips (last 3 months)'), ('Form 16'), ('Employment / NOC letter from employer'), ('Leave sanction letter'),
  ('Employee ID card'),
  ('Company registration certificate'), ('GST registration certificate'), ('Business bank statement (last 6 months)'),
  ('Business ITR (last 3 years)'), ('Partnership deed / MOA'), ('Udyam / MSME certificate'),
  ('Cover letter on company letterhead'),
  ('Flight booking'), ('Hotel booking'), ('Travel itinerary'), ('Travel insurance'),
  ('Invitation letter'), ('Sponsor letter'), ('Sponsor''s financial documents'),
  ('Marriage certificate'), ('Birth certificate'),
  ('Offer / admission letter'), ('Academic certificates & marksheets'), ('IELTS / TOEFL / PTE score card'),
  ('Statement of purpose'), ('Education loan sanction letter'),
  ('Job offer letter'), ('Employment contract'), ('Experience letters'), ('Updated resume / CV'),
  ('Police clearance certificate'), ('Medical certificate')
on conflict (name) do nothing;
