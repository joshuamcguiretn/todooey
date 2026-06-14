alter table public.tasks
add column if not exists subtasks jsonb not null default '[]'::jsonb;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.tasks
add column if not exists completed_at timestamptz;

alter table public.tasks
add column if not exists buddy_group_id text;

alter table public.tasks
drop constraint if exists tasks_subtasks_array_check;

alter table public.tasks
add constraint tasks_subtasks_array_check
check (jsonb_typeof(subtasks) = 'array');

create table if not exists public.task_completion_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  task_id text not null,
  list_id text not null default 'home',
  title text not null default '',
  completed_at timestamptz not null default now(),
  recurring boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.buddy_task_groups (
  id text primary key,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.buddy_task_members (
  group_id text not null references public.buddy_task_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists tasks_buddy_group_idx on public.tasks (buddy_group_id);
create index if not exists task_completion_history_user_completed_idx on public.task_completion_history (user_id, completed_at desc);
create index if not exists task_completion_history_user_list_completed_idx on public.task_completion_history (user_id, list_id, completed_at desc);
create index if not exists buddy_task_members_user_idx on public.buddy_task_members (user_id);
create index if not exists buddy_task_members_group_idx on public.buddy_task_members (group_id);

drop trigger if exists task_completion_history_set_updated_at on public.task_completion_history;
create trigger task_completion_history_set_updated_at
before update on public.task_completion_history
for each row execute function public.set_updated_at();

drop trigger if exists buddy_task_groups_set_updated_at on public.buddy_task_groups;
create trigger buddy_task_groups_set_updated_at
before update on public.buddy_task_groups
for each row execute function public.set_updated_at();

drop trigger if exists buddy_task_members_set_updated_at on public.buddy_task_members;
create trigger buddy_task_members_set_updated_at
before update on public.buddy_task_members
for each row execute function public.set_updated_at();

alter table public.task_completion_history enable row level security;
alter table public.buddy_task_groups enable row level security;
alter table public.buddy_task_members enable row level security;

grant select, insert, update, delete
on table public.task_completion_history
to authenticated;

grant select, insert, update, delete
on table public.buddy_task_groups
to authenticated;

grant select, insert, update, delete
on table public.buddy_task_members
to authenticated;

drop policy if exists "Users can read own tasks" on public.tasks;
create policy "Users can read own tasks"
on public.tasks for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.buddy_task_members members
    where members.group_id = public.tasks.buddy_group_id
      and members.user_id = auth.uid()
  )
);

drop policy if exists "Users can update own tasks" on public.tasks;
create policy "Users can update own tasks"
on public.tasks for update
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.buddy_task_members members
    where members.group_id = public.tasks.buddy_group_id
      and members.user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.buddy_task_members members
    where members.group_id = public.tasks.buddy_group_id
      and members.user_id = auth.uid()
  )
);

drop policy if exists "Users can read own completion history" on public.task_completion_history;
create policy "Users can read own completion history"
on public.task_completion_history for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own completion history" on public.task_completion_history;
create policy "Users can insert own completion history"
on public.task_completion_history for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own completion history" on public.task_completion_history;
create policy "Users can update own completion history"
on public.task_completion_history for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own completion history" on public.task_completion_history;
create policy "Users can delete own completion history"
on public.task_completion_history for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read buddy groups they own or joined" on public.buddy_task_groups;
create policy "Users can read buddy groups they own or joined"
on public.buddy_task_groups for select
using (
  auth.uid() = created_by
  or exists (
    select 1
    from public.buddy_task_members members
    where members.group_id = public.buddy_task_groups.id
      and members.user_id = auth.uid()
  )
);

drop policy if exists "Users can create buddy groups" on public.buddy_task_groups;
create policy "Users can create buddy groups"
on public.buddy_task_groups for insert
with check (auth.uid() = created_by);

drop policy if exists "Users can update own buddy groups" on public.buddy_task_groups;
create policy "Users can update own buddy groups"
on public.buddy_task_groups for update
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

drop policy if exists "Users can delete own buddy groups" on public.buddy_task_groups;
create policy "Users can delete own buddy groups"
on public.buddy_task_groups for delete
using (auth.uid() = created_by);

drop policy if exists "Users can read own buddy memberships" on public.buddy_task_members;
create policy "Users can read own buddy memberships"
on public.buddy_task_members for select
using (auth.uid() = user_id);

drop policy if exists "Users can create own buddy memberships" on public.buddy_task_members;
create policy "Users can create own buddy memberships"
on public.buddy_task_members for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own buddy memberships" on public.buddy_task_members;
create policy "Users can update own buddy memberships"
on public.buddy_task_members for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own buddy memberships" on public.buddy_task_members;
create policy "Users can delete own buddy memberships"
on public.buddy_task_members for delete
using (auth.uid() = user_id);
