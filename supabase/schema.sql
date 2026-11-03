-- Visa Filing Portal - Supabase schema
-- Only the server (secret / service_role key) can read or write. Row Level Security is on with
-- no policies, and anon/authenticated roles have no grants, so the public API key exposes nothing.

create table if not exists public.users (
  id bigint generated always as identity primary key,
  username text unique not null,
  pw text not null,
  role text not null check (role in ('admin', 'staff', 'customer')),
  full_name text not null,
  email text not null default '',
  phone text not null default '',
  passport_no text not null default '',
  nationality text not null default '',
  dob text not null default '',
  visa_type text not null default '',
  country text not null default '',
  stage text not null default 'Documents Collection',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  token text primary key,
  user_id bigint not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_id_idx on public.sessions (user_id);

create table if not exists public.checklist_items (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'pending' check (status in ('pending', 'in_review', 'accepted', 'rejected')),
  file_path text,
  original_name text,
  mime text,
  uploaded_by bigint references public.users (id) on delete set null,
  uploaded_at timestamptz,
  reject_reasons jsonb not null default '[]'::jsonb,
  reject_note text not null default '',
  reviewed_by bigint references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists checklist_items_customer_idx on public.checklist_items (customer_id);
create index if not exists checklist_items_status_idx on public.checklist_items (status);
create index if not exists checklist_items_uploaded_by_idx on public.checklist_items (uploaded_by);
create index if not exists checklist_items_reviewed_by_idx on public.checklist_items (reviewed_by);

create table if not exists public.removal_requests (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.checklist_items (id) on delete cascade,
  requested_by bigint not null references public.users (id) on delete cascade,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  decided_by bigint references public.users (id) on delete set null,
  decided_at timestamptz
);
-- at most one pending removal request per document
create unique index if not exists removal_one_pending on public.removal_requests (item_id) where status = 'pending';
create index if not exists removal_requests_requested_by_idx on public.removal_requests (requested_by);
create index if not exists removal_requests_decided_by_idx on public.removal_requests (decided_by);

create table if not exists public.activity (
  id bigint generated always as identity primary key,
  customer_id bigint references public.users (id) on delete cascade,
  user_id bigint references public.users (id) on delete set null,
  action text not null,
  detail text not null default '',
  at timestamptz not null default now()
);
create index if not exists activity_customer_idx on public.activity (customer_id);
create index if not exists activity_user_idx on public.activity (user_id);

-- lock down: server-only access
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.checklist_items enable row level security;
alter table public.removal_requests enable row level security;
alter table public.activity enable row level security;
revoke all on public.users, public.sessions, public.checklist_items, public.removal_requests, public.activity
  from anon, authenticated;

-- dashboard numbers in one call
create or replace function public.portal_stats()
returns json language sql stable set search_path = '' as $$
  select json_build_object(
    'customers', (select count(*) from public.users where role = 'customer'),
    'staff',     (select count(*) from public.users where role = 'staff'),
    'in_review', (select count(*) from public.checklist_items where status = 'in_review'),
    'accepted',  (select count(*) from public.checklist_items where status = 'accepted'),
    'rejected',  (select count(*) from public.checklist_items where status = 'rejected'),
    'pending',   (select count(*) from public.checklist_items where status = 'pending'),
    'removals',  (select count(*) from public.removal_requests where status = 'pending')
  );
$$;

-- per-customer document counts for the customer list
create or replace function public.customer_progress()
returns table (customer_id bigint, pending bigint, in_review bigint, accepted bigint, rejected bigint, total bigint)
language sql stable set search_path = '' as $$
  select customer_id,
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'in_review'),
         count(*) filter (where status = 'accepted'),
         count(*) filter (where status = 'rejected'),
         count(*)
  from public.checklist_items group by customer_id;
$$;

revoke execute on function public.portal_stats() from public, anon, authenticated;
revoke execute on function public.customer_progress() from public, anon, authenticated;
grant execute on function public.portal_stats() to service_role;
grant execute on function public.customer_progress() to service_role;

-- private bucket for customer documents (no storage policies = server-only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
