-- Visa Filing Portal - editable visa types + document type rename (run after 002_checklists.sql)

create table if not exists public.visa_types (
  id bigint generated always as identity primary key,
  name text unique not null,
  created_at timestamptz not null default now()
);
alter table public.visa_types enable row level security;
revoke all on public.visa_types from anon, authenticated;

insert into public.visa_types (name) values
  ('Tourist Visa'), ('Visitor / Family Visit Visa'), ('Business Visa'), ('Student Visa'), ('Work Visa'),
  ('Dependent / Spouse Visa'), ('Transit Visa'), ('PR / Immigration')
on conflict (name) do nothing;

-- Rename a document inside every checklist that uses it; returns how many checklists changed.
create or replace function public.rename_doc_in_checklists(old_name text, new_name text)
returns integer language sql set search_path = '' as $$
  with changed as (
    update public.checklist_templates t
    set items = (
          select jsonb_agg(case when e->>'name' = old_name then jsonb_set(e, '{name}', to_jsonb(new_name)) else e end order by ord)
          from jsonb_array_elements(t.items) with ordinality as x(e, ord)
        ),
        updated_at = now()
    where t.items @> jsonb_build_array(jsonb_build_object('name', old_name))
    returning 1
  )
  select count(*)::integer from changed;
$$;
revoke execute on function public.rename_doc_in_checklists(text, text) from public, anon, authenticated;
grant execute on function public.rename_doc_in_checklists(text, text) to service_role;
