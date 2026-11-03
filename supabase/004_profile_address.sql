-- Visa Filing Portal - extra profile fields filled by "Auto-fetch from documents" (run after 003)
alter table public.users add column if not exists address text not null default '';
alter table public.users add column if not exists passport_expiry text not null default '';
