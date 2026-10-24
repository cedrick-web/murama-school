-- Murama's supplementary Supabase profiles. Existing school records and
-- authorization roles remain managed by the application's MySQL database.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_length check (email is null or char_length(email) <= 320),
  constraint profiles_display_name_length check (char_length(display_name) <= 160),
  constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 1000),
  constraint profiles_avatar_url_https check (avatar_url is null or avatar_url ~ '^https://')
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon;
grant select, insert, update on table public.profiles to authenticated;

create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

comment on table public.profiles is
  'Supplementary profile only. School authorization roles remain in Murama MySQL.';
