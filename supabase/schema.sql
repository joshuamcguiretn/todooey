create table if not exists public.tasks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  due_date date not null default current_date,
  priority smallint not null default 2 check (priority in (1, 2)),
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'fibonacci')),
  recurrence_interval integer not null default 1 check (recurrence_interval >= 1),
  recurrence_anchored boolean not null default true,
  rotation_titles text[] not null default '{}',
  rotation_title_index integer not null default 0 check (rotation_title_index >= 0),
  description text not null default '',
  image_data_url text not null default '',
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  completed_today_count integer not null default 0 check (completed_today_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists tasks_user_due_idx on public.tasks (user_id, due_date);
create index if not exists tasks_user_recurrence_idx on public.tasks (user_id, recurrence);

alter table public.tasks
add column if not exists recurrence_anchored boolean not null default true;

alter table public.tasks
drop constraint if exists tasks_recurrence_check;

alter table public.tasks
add constraint tasks_recurrence_check
check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'fibonacci'));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists daily_progress_set_updated_at on public.daily_progress;
create trigger daily_progress_set_updated_at
before update on public.daily_progress
for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;
alter table public.daily_progress enable row level security;

grant usage on schema public to authenticated;

grant select, insert, update, delete
on table public.tasks
to authenticated;

grant select, insert, update, delete
on table public.daily_progress
to authenticated;

drop policy if exists "Users can read own tasks" on public.tasks;
create policy "Users can read own tasks"
on public.tasks for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own tasks" on public.tasks;
create policy "Users can insert own tasks"
on public.tasks for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own tasks" on public.tasks;
create policy "Users can update own tasks"
on public.tasks for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own tasks" on public.tasks;
create policy "Users can delete own tasks"
on public.tasks for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own daily progress" on public.daily_progress;
create policy "Users can read own daily progress"
on public.daily_progress for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own daily progress" on public.daily_progress;
create policy "Users can insert own daily progress"
on public.daily_progress for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own daily progress" on public.daily_progress;
create policy "Users can update own daily progress"
on public.daily_progress for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
