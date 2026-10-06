create schema if not exists recipe;
comment on schema recipe is 'Private product schema for recipe.thiepn.dev';

insert into core.apps (id, name, origin, namespace, backend_level, owner, enabled)
values ('recipe', 'Recipe', 'https://recipe.thiepn.dev', 'recipe', '5', 'private-core', true)
on conflict (id) do update
set name = excluded.name,
    origin = excluded.origin,
    namespace = excluded.namespace,
    backend_level = excluded.backend_level,
    owner = excluded.owner,
    enabled = excluded.enabled,
    updated_at = now();

create type recipe.recipe_state as enum ('draft', 'needs_review', 'verified', 'active', 'archived');
create type recipe.recipe_visibility as enum ('private', 'household', 'shared_link', 'public');
create type recipe.recipe_difficulty as enum ('unknown', 'easy', 'medium', 'hard');
create type recipe.recipe_source_type as enum ('manual', 'family', 'website', 'photo', 'screenshot', 'book', 'voice', 'video', 'social', 'chatgpt', 'import', 'unknown');
create type recipe.recipe_version_kind as enum ('original', 'revision', 'variant');
create type recipe.ingredient_scaling_mode as enum ('linear', 'seasoning', 'fixed', 'contextual');
create type recipe.collection_kind as enum ('manual', 'smart', 'system');

create or replace function recipe.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table recipe.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  current_version_id uuid,
  state recipe.recipe_state not null default 'draft',
  visibility recipe.recipe_visibility not null default 'private',
  favorite boolean not null default false,
  hero_image_path text,
  last_cooked_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint recipes_archive_state_check check ((state = 'archived') = (archived_at is not null)),
  constraint recipes_deleted_not_active_check check (deleted_at is null or state = 'archived')
);

create table recipe.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null,
  parent_version_id uuid,
  version_number bigint not null check (version_number > 0),
  kind recipe.recipe_version_kind not null default 'revision',
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text,
  story text,
  yield_text text,
  servings numeric(10,3) check (servings is null or servings > 0),
  serving_unit text,
  difficulty recipe.recipe_difficulty not null default 'unknown',
  prep_minutes integer check (prep_minutes is null or prep_minutes >= 0),
  active_minutes integer check (active_minutes is null or active_minutes >= 0),
  passive_minutes integer check (passive_minutes is null or passive_minutes >= 0),
  rest_minutes integer check (rest_minutes is null or rest_minutes >= 0),
  total_minutes integer check (total_minutes is null or total_minutes >= 0),
  cuisine_tags text[] not null default '{}',
  category_tags text[] not null default '{}',
  dietary_tags text[] not null default '{}',
  locale text,
  author_note text,
  change_summary text,
  revision bigint not null default 0 check (revision >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (recipe_id, id, user_id),
  unique (recipe_id, version_number),
  constraint recipe_versions_recipe_fk foreign key (recipe_id, user_id)
    references recipe.recipes(id, user_id) on delete cascade,
  constraint recipe_versions_parent_fk foreign key (recipe_id, parent_version_id, user_id)
    references recipe.recipe_versions(recipe_id, id, user_id)
    deferrable initially deferred
);

alter table recipe.recipes
  add constraint recipes_current_version_fk
  foreign key (id, current_version_id, user_id)
  references recipe.recipe_versions(recipe_id, id, user_id)
  deferrable initially deferred;

alter table recipe.recipes
  add constraint recipes_state_requires_current_version_check
  check (state in ('draft', 'needs_review') or current_version_id is not null);

create table recipe.recipe_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null,
  version_id uuid,
  source_type recipe.recipe_source_type not null,
  label text,
  person_name text,
  source_url text,
  original_storage_path text,
  original_text text,
  extracted_text text,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  uncertainties jsonb not null default '[]'::jsonb check (jsonb_typeof(uncertainties) = 'array'),
  captured_at timestamptz,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint recipe_sources_recipe_fk foreign key (recipe_id, user_id)
    references recipe.recipes(id, user_id) on delete cascade,
  constraint recipe_sources_version_fk foreign key (recipe_id, version_id, user_id)
    references recipe.recipe_versions(recipe_id, id, user_id)
    deferrable initially deferred
);

create table recipe.ingredient_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_version_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (recipe_version_id, id, user_id),
  constraint ingredient_groups_version_fk foreign key (recipe_version_id, user_id)
    references recipe.recipe_versions(id, user_id) on delete cascade,
  unique (recipe_version_id, position)
);

create table recipe.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_version_id uuid not null,
  group_id uuid,
  position integer not null default 0 check (position >= 0),
  name text not null check (char_length(btrim(name)) between 1 and 240),
  quantity numeric(14,4) check (quantity is null or quantity >= 0),
  quantity_max numeric(14,4) check (quantity_max is null or quantity_max >= 0),
  unit text,
  preparation text,
  note text,
  optional boolean not null default false,
  scaling_mode recipe.ingredient_scaling_mode not null default 'linear',
  canonical_key text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (recipe_version_id, id, user_id),
  constraint recipe_ingredients_version_fk foreign key (recipe_version_id, user_id)
    references recipe.recipe_versions(id, user_id) on delete cascade,
  constraint recipe_ingredients_group_fk foreign key (recipe_version_id, group_id, user_id)
    references recipe.ingredient_groups(recipe_version_id, id, user_id)
    deferrable initially deferred,
  constraint recipe_ingredients_quantity_range_check check (quantity_max is null or quantity is null or quantity_max >= quantity),
  unique (recipe_version_id, position)
);

create table recipe.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_version_id uuid not null,
  position integer not null check (position >= 0),
  title text,
  instruction text not null check (char_length(btrim(instruction)) > 0),
  duration_seconds_min integer check (duration_seconds_min is null or duration_seconds_min >= 0),
  duration_seconds_max integer check (duration_seconds_max is null or duration_seconds_max >= 0),
  timer_label text,
  temperature_c numeric(7,2),
  temperature_display text,
  heat_level text check (heat_level is null or heat_level in ('low', 'medium_low', 'medium', 'medium_high', 'high')),
  visual_cue text,
  doneness_cue text,
  technique_keys text[] not null default '{}',
  is_passive boolean not null default false,
  can_parallelize boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (recipe_version_id, id, user_id),
  constraint recipe_steps_version_fk foreign key (recipe_version_id, user_id)
    references recipe.recipe_versions(id, user_id) on delete cascade,
  constraint recipe_steps_duration_range_check check (duration_seconds_max is null or duration_seconds_min is null or duration_seconds_max >= duration_seconds_min),
  unique (recipe_version_id, position)
);

create table recipe.step_ingredients (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_version_id uuid not null,
  step_id uuid not null,
  ingredient_id uuid not null,
  quantity numeric(14,4) check (quantity is null or quantity >= 0),
  unit text,
  note text,
  created_at timestamptz not null default now(),
  primary key (step_id, ingredient_id),
  constraint step_ingredients_step_fk foreign key (recipe_version_id, step_id, user_id)
    references recipe.recipe_steps(recipe_version_id, id, user_id) on delete cascade,
  constraint step_ingredients_ingredient_fk foreign key (recipe_version_id, ingredient_id, user_id)
    references recipe.recipe_ingredients(recipe_version_id, id, user_id) on delete cascade
);

create table recipe.recipe_equipment (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_version_id uuid not null,
  position integer not null default 0 check (position >= 0),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  quantity numeric(10,2) check (quantity is null or quantity > 0),
  optional boolean not null default false,
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (recipe_version_id, id, user_id),
  constraint recipe_equipment_version_fk foreign key (recipe_version_id, user_id)
    references recipe.recipe_versions(id, user_id) on delete cascade,
  unique (recipe_version_id, position)
);

create table recipe.step_equipment (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_version_id uuid not null,
  step_id uuid not null,
  equipment_id uuid not null,
  note text,
  created_at timestamptz not null default now(),
  primary key (step_id, equipment_id),
  constraint step_equipment_step_fk foreign key (recipe_version_id, step_id, user_id)
    references recipe.recipe_steps(recipe_version_id, id, user_id) on delete cascade,
  constraint step_equipment_equipment_fk foreign key (recipe_version_id, equipment_id, user_id)
    references recipe.recipe_equipment(recipe_version_id, id, user_id) on delete cascade
);

create table recipe.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind recipe.collection_kind not null default 'manual',
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text,
  icon_key text,
  cover_image_path text,
  position integer not null default 0 check (position >= 0),
  smart_filter jsonb check (smart_filter is null or jsonb_typeof(smart_filter) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);

create table recipe.collection_recipes (
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid not null,
  recipe_id uuid not null,
  position integer not null default 0 check (position >= 0),
  added_at timestamptz not null default now(),
  primary key (collection_id, recipe_id),
  constraint collection_recipes_collection_fk foreign key (collection_id, user_id)
    references recipe.collections(id, user_id) on delete cascade,
  constraint collection_recipes_recipe_fk foreign key (recipe_id, user_id)
    references recipe.recipes(id, user_id) on delete cascade
);

create trigger recipes_set_updated_at before update on recipe.recipes
for each row execute function recipe.set_updated_at();
create trigger recipe_versions_set_updated_at before update on recipe.recipe_versions
for each row execute function recipe.set_updated_at();
create trigger recipe_sources_set_updated_at before update on recipe.recipe_sources
for each row execute function recipe.set_updated_at();
create trigger ingredient_groups_set_updated_at before update on recipe.ingredient_groups
for each row execute function recipe.set_updated_at();
create trigger recipe_ingredients_set_updated_at before update on recipe.recipe_ingredients
for each row execute function recipe.set_updated_at();
create trigger recipe_steps_set_updated_at before update on recipe.recipe_steps
for each row execute function recipe.set_updated_at();
create trigger recipe_equipment_set_updated_at before update on recipe.recipe_equipment
for each row execute function recipe.set_updated_at();
create trigger collections_set_updated_at before update on recipe.collections
for each row execute function recipe.set_updated_at();

revoke all on schema recipe from public, anon, authenticated;
grant usage on schema recipe to authenticated, service_role;

revoke all on all tables in schema recipe from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema recipe to authenticated;
grant select, insert, update, delete, references, trigger on all tables in schema recipe to service_role;

revoke all on function recipe.set_updated_at() from public, anon, authenticated;
grant execute on function recipe.set_updated_at() to service_role;

do $$
declare
  t text;
  tables text[] := array[
    'recipes','recipe_versions','recipe_sources','ingredient_groups','recipe_ingredients',
    'recipe_steps','step_ingredients','recipe_equipment','step_equipment','collections','collection_recipes'
  ];
begin
  foreach t in array tables loop
    execute format('alter table recipe.%I enable row level security', t);
    execute format('create policy %I on recipe.%I for select to authenticated using (((select auth.uid()) is not null) and ((select auth.uid()) = user_id))', t || '_select_own', t);
    execute format('create policy %I on recipe.%I for insert to authenticated with check (((select auth.uid()) is not null) and ((select auth.uid()) = user_id))', t || '_insert_own', t);
    execute format('create policy %I on recipe.%I for update to authenticated using (((select auth.uid()) is not null) and ((select auth.uid()) = user_id)) with check (((select auth.uid()) is not null) and ((select auth.uid()) = user_id))', t || '_update_own', t);
    execute format('create policy %I on recipe.%I for delete to authenticated using (((select auth.uid()) is not null) and ((select auth.uid()) = user_id))', t || '_delete_own', t);
  end loop;
end
$$;

create index recipes_user_state_updated_idx on recipe.recipes (user_id, state, updated_at desc) where deleted_at is null;
create index recipes_user_favorite_idx on recipe.recipes (user_id, favorite, updated_at desc) where deleted_at is null and favorite;
create index recipes_current_version_idx on recipe.recipes (current_version_id, user_id) where current_version_id is not null;
create index recipe_versions_recipe_idx on recipe.recipe_versions (recipe_id, user_id, version_number desc);
create index recipe_versions_parent_idx on recipe.recipe_versions (parent_version_id, user_id) where parent_version_id is not null;
create index recipe_sources_recipe_idx on recipe.recipe_sources (recipe_id, user_id, created_at desc);
create index recipe_sources_version_idx on recipe.recipe_sources (version_id, user_id) where version_id is not null;
create index ingredient_groups_version_idx on recipe.ingredient_groups (recipe_version_id, user_id, position);
create index recipe_ingredients_version_idx on recipe.recipe_ingredients (recipe_version_id, user_id, position);
create index recipe_ingredients_group_idx on recipe.recipe_ingredients (group_id, user_id) where group_id is not null;
create index recipe_ingredients_canonical_idx on recipe.recipe_ingredients (user_id, canonical_key) where canonical_key is not null;
create index recipe_steps_version_idx on recipe.recipe_steps (recipe_version_id, user_id, position);
create index step_ingredients_version_idx on recipe.step_ingredients (recipe_version_id, user_id);
create index step_ingredients_ingredient_idx on recipe.step_ingredients (ingredient_id, user_id);
create index recipe_equipment_version_idx on recipe.recipe_equipment (recipe_version_id, user_id, position);
create index step_equipment_version_idx on recipe.step_equipment (recipe_version_id, user_id);
create index step_equipment_equipment_idx on recipe.step_equipment (equipment_id, user_id);
create index collections_user_position_idx on recipe.collections (user_id, position, name);
create index collection_recipes_user_recipe_idx on recipe.collection_recipes (user_id, recipe_id);
create index collection_recipes_collection_position_idx on recipe.collection_recipes (collection_id, user_id, position);
