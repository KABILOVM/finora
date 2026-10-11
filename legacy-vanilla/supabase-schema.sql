-- Finora: minimal private cloud snapshot table.
-- Run in Supabase Dashboard > SQL Editor. This stores one JSON snapshot per user.
-- Row Level Security ensures users can only access their own row.
create table if not exists public.user_finance_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_finance_state enable row level security;

drop policy if exists "Users can read their own Finora state" on public.user_finance_state;
drop policy if exists "Users can insert their own Finora state" on public.user_finance_state;
drop policy if exists "Users can update their own Finora state" on public.user_finance_state;

create policy "Users can read their own Finora state"
on public.user_finance_state for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own Finora state"
on public.user_finance_state for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own Finora state"
on public.user_finance_state for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Do not enable public/anon access. Do not put service_role keys in frontend code.
