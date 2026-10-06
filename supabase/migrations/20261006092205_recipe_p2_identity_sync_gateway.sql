do $$
declare r record;
begin
  for r in
    select conrelid::regclass::text as table_name, conname
    from pg_constraint
    where contype='f'
      and connamespace='recipe'::regnamespace
      and confrelid='auth.users'::regclass
  loop
    execute format('alter table %s drop constraint %I', r.table_name, r.conname);
  end loop;
end $$;

revoke all on schema recipe from anon, authenticated;
revoke all on all tables in schema recipe from anon, authenticated;

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname='recipe'
  loop
    execute format('drop policy %I on recipe.%I', r.policyname, r.tablename);
  end loop;
end $$;

create table recipe.sync_mutations (
  user_id uuid not null,
  mutation_id uuid not null,
  resource_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

create table recipe.sync_changes (
  change_sequence bigint generated always as identity primary key,
  user_id uuid not null,
  recipe_id uuid not null,
  recipe_revision bigint not null check (recipe_revision > 0),
  change_kind text not null check (change_kind in ('upsert','deleted')),
  changed_at timestamptz not null default now()
);

create index recipe_sync_mutations_resource_idx
  on recipe.sync_mutations (user_id, resource_id, created_at desc);
create index recipe_sync_changes_user_seq_idx
  on recipe.sync_changes (user_id, change_sequence);
create index recipe_sync_changes_recipe_idx
  on recipe.sync_changes (user_id, recipe_id, change_sequence desc);

grant select, insert, update, delete, references, trigger on recipe.sync_mutations, recipe.sync_changes to service_role;
grant usage, select on sequence recipe.sync_changes_change_sequence_seq to service_role;

alter table recipe.sync_mutations enable row level security;
alter table recipe.sync_changes enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'recipes','recipe_versions','recipe_sources','ingredient_groups','recipe_ingredients',
    'recipe_steps','step_ingredients','recipe_equipment','step_equipment','collections',
    'collection_recipes','sync_mutations','sync_changes'
  ]
  loop
    execute format(
      'create policy %I on recipe.%I for all to authenticated using (false) with check (false)',
      t || '_gateway_only_deny',
      t
    );
  end loop;
end $$;

comment on column recipe.recipes.user_id is 'Canonical THIEPN Account UUID, verified by the Core Gateway; not a Core auth.users foreign key.';
comment on column recipe.recipe_versions.user_id is 'Canonical THIEPN Account UUID, verified by the Core Gateway.';
comment on table recipe.sync_mutations is 'Gateway-only idempotency receipts for Recipe local-first mutations.';
comment on table recipe.sync_changes is 'Gateway-only monotonic change stream for Recipe local-first synchronization.';

create or replace function recipe.document_json(p_user_id uuid, p_recipe_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'recipe', jsonb_build_object(
      'id', r.id,
      'currentVersionId', r.current_version_id,
      'state', r.state,
      'visibility', r.visibility,
      'favorite', r.favorite,
      'heroImagePath', r.hero_image_path,
      'lastCookedAt', r.last_cooked_at,
      'archivedAt', r.archived_at,
      'deletedAt', r.deleted_at,
      'revision', r.revision,
      'metadata', r.metadata,
      'createdAt', r.created_at,
      'updatedAt', r.updated_at
    ),
    'version', jsonb_build_object(
      'id', v.id,
      'recipeId', v.recipe_id,
      'parentVersionId', v.parent_version_id,
      'versionNumber', v.version_number,
      'kind', v.kind,
      'title', v.title,
      'description', v.description,
      'story', v.story,
      'yieldText', v.yield_text,
      'servings', v.servings,
      'servingUnit', v.serving_unit,
      'difficulty', v.difficulty,
      'prepMinutes', v.prep_minutes,
      'activeMinutes', v.active_minutes,
      'passiveMinutes', v.passive_minutes,
      'restMinutes', v.rest_minutes,
      'totalMinutes', v.total_minutes,
      'cuisineTags', to_jsonb(v.cuisine_tags),
      'categoryTags', to_jsonb(v.category_tags),
      'dietaryTags', to_jsonb(v.dietary_tags),
      'locale', v.locale,
      'authorNote', v.author_note,
      'changeSummary', v.change_summary,
      'revision', v.revision,
      'metadata', v.metadata,
      'createdAt', v.created_at,
      'updatedAt', v.updated_at
    ),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'recipeId', s.recipe_id,
        'versionId', s.version_id,
        'sourceType', s.source_type,
        'label', s.label,
        'personName', s.person_name,
        'sourceUrl', s.source_url,
        'originalStoragePath', s.original_storage_path,
        'originalText', s.original_text,
        'extractedText', s.extracted_text,
        'confidence', s.confidence,
        'uncertainties', s.uncertainties,
        'capturedAt', s.captured_at,
        'contentHash', s.content_hash,
        'metadata', s.metadata,
        'createdAt', s.created_at,
        'updatedAt', s.updated_at
      ) order by s.created_at, s.id)
      from recipe.recipe_sources s
      where s.user_id = p_user_id and s.recipe_id = r.id
    ), '[]'::jsonb),
    'ingredientGroups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'recipeVersionId', g.recipe_version_id,
        'name', g.name,
        'position', g.position
      ) order by g.position, g.id)
      from recipe.ingredient_groups g
      where g.user_id = p_user_id and g.recipe_version_id = v.id
    ), '[]'::jsonb),
    'ingredients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'recipeVersionId', i.recipe_version_id,
        'groupId', i.group_id,
        'position', i.position,
        'name', i.name,
        'quantity', i.quantity,
        'quantityMax', i.quantity_max,
        'unit', i.unit,
        'preparation', i.preparation,
        'note', i.note,
        'optional', i.optional,
        'scalingMode', i.scaling_mode,
        'canonicalKey', i.canonical_key,
        'metadata', i.metadata
      ) order by i.position, i.id)
      from recipe.recipe_ingredients i
      where i.user_id = p_user_id and i.recipe_version_id = v.id
    ), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', st.id,
        'recipeVersionId', st.recipe_version_id,
        'position', st.position,
        'title', st.title,
        'instruction', st.instruction,
        'durationSecondsMin', st.duration_seconds_min,
        'durationSecondsMax', st.duration_seconds_max,
        'timerLabel', st.timer_label,
        'temperatureC', st.temperature_c,
        'temperatureDisplay', st.temperature_display,
        'heatLevel', st.heat_level,
        'visualCue', st.visual_cue,
        'donenessCue', st.doneness_cue,
        'techniqueKeys', to_jsonb(st.technique_keys),
        'isPassive', st.is_passive,
        'canParallelize', st.can_parallelize,
        'metadata', st.metadata
      ) order by st.position, st.id)
      from recipe.recipe_steps st
      where st.user_id = p_user_id and st.recipe_version_id = v.id
    ), '[]'::jsonb),
    'stepIngredients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'recipeVersionId', si.recipe_version_id,
        'stepId', si.step_id,
        'ingredientId', si.ingredient_id,
        'quantity', si.quantity,
        'unit', si.unit,
        'note', si.note
      ) order by si.step_id, si.ingredient_id)
      from recipe.step_ingredients si
      where si.user_id = p_user_id and si.recipe_version_id = v.id
    ), '[]'::jsonb),
    'equipment', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'recipeVersionId', e.recipe_version_id,
        'position', e.position,
        'name', e.name,
        'quantity', e.quantity,
        'optional', e.optional,
        'note', e.note,
        'metadata', e.metadata
      ) order by e.position, e.id)
      from recipe.recipe_equipment e
      where e.user_id = p_user_id and e.recipe_version_id = v.id
    ), '[]'::jsonb),
    'stepEquipment', coalesce((
      select jsonb_agg(jsonb_build_object(
        'recipeVersionId', se.recipe_version_id,
        'stepId', se.step_id,
        'equipmentId', se.equipment_id,
        'note', se.note
      ) order by se.step_id, se.equipment_id)
      from recipe.step_equipment se
      where se.user_id = p_user_id and se.recipe_version_id = v.id
    ), '[]'::jsonb)
  )
  from recipe.recipes r
  join recipe.recipe_versions v
    on v.id = r.current_version_id
   and v.recipe_id = r.id
   and v.user_id = r.user_id
  where r.id = p_recipe_id
    and r.user_id = p_user_id;
$$;

revoke all on function recipe.document_json(uuid, uuid) from public, anon, authenticated;
grant execute on function recipe.document_json(uuid, uuid) to service_role;

create or replace function recipe.replace_version_children(
  p_user_id uuid,
  p_version_id uuid,
  p_document jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from recipe.step_ingredients where user_id=p_user_id and recipe_version_id=p_version_id;
  delete from recipe.step_equipment where user_id=p_user_id and recipe_version_id=p_version_id;
  delete from recipe.recipe_ingredients where user_id=p_user_id and recipe_version_id=p_version_id;
  delete from recipe.ingredient_groups where user_id=p_user_id and recipe_version_id=p_version_id;
  delete from recipe.recipe_equipment where user_id=p_user_id and recipe_version_id=p_version_id;
  delete from recipe.recipe_steps where user_id=p_user_id and recipe_version_id=p_version_id;

  insert into recipe.ingredient_groups (id,user_id,recipe_version_id,name,position)
  select (x->>'id')::uuid,p_user_id,p_version_id,x->>'name',coalesce((x->>'position')::integer,0)
  from jsonb_array_elements(coalesce(p_document->'ingredientGroups','[]'::jsonb)) x;

  insert into recipe.recipe_ingredients (
    id,user_id,recipe_version_id,group_id,position,name,quantity,quantity_max,unit,
    preparation,note,optional,scaling_mode,canonical_key,metadata
  )
  select
    (x->>'id')::uuid,p_user_id,p_version_id,nullif(x->>'groupId','')::uuid,
    coalesce((x->>'position')::integer,0),x->>'name',nullif(x->>'quantity','')::numeric,
    nullif(x->>'quantityMax','')::numeric,nullif(x->>'unit',''),nullif(x->>'preparation',''),
    nullif(x->>'note',''),coalesce((x->>'optional')::boolean,false),
    coalesce(nullif(x->>'scalingMode',''),'linear')::recipe.ingredient_scaling_mode,
    nullif(x->>'canonicalKey',''),coalesce(x->'metadata','{}'::jsonb)
  from jsonb_array_elements(coalesce(p_document->'ingredients','[]'::jsonb)) x;

  insert into recipe.recipe_steps (
    id,user_id,recipe_version_id,position,title,instruction,duration_seconds_min,
    duration_seconds_max,timer_label,temperature_c,temperature_display,heat_level,
    visual_cue,doneness_cue,technique_keys,is_passive,can_parallelize,metadata
  )
  select
    (x->>'id')::uuid,p_user_id,p_version_id,coalesce((x->>'position')::integer,0),
    nullif(x->>'title',''),x->>'instruction',nullif(x->>'durationSecondsMin','')::integer,
    nullif(x->>'durationSecondsMax','')::integer,nullif(x->>'timerLabel',''),
    nullif(x->>'temperatureC','')::numeric,nullif(x->>'temperatureDisplay',''),
    nullif(x->>'heatLevel',''),nullif(x->>'visualCue',''),nullif(x->>'donenessCue',''),
    coalesce(array(select jsonb_array_elements_text(coalesce(x->'techniqueKeys','[]'::jsonb))), '{}'::text[]),
    coalesce((x->>'isPassive')::boolean,false),coalesce((x->>'canParallelize')::boolean,false),
    coalesce(x->'metadata','{}'::jsonb)
  from jsonb_array_elements(coalesce(p_document->'steps','[]'::jsonb)) x;

  insert into recipe.step_ingredients (user_id,recipe_version_id,step_id,ingredient_id,quantity,unit,note)
  select p_user_id,p_version_id,(x->>'stepId')::uuid,(x->>'ingredientId')::uuid,
    nullif(x->>'quantity','')::numeric,nullif(x->>'unit',''),nullif(x->>'note','')
  from jsonb_array_elements(coalesce(p_document->'stepIngredients','[]'::jsonb)) x;

  insert into recipe.recipe_equipment (id,user_id,recipe_version_id,position,name,quantity,optional,note,metadata)
  select (x->>'id')::uuid,p_user_id,p_version_id,coalesce((x->>'position')::integer,0),
    x->>'name',nullif(x->>'quantity','')::numeric,coalesce((x->>'optional')::boolean,false),
    nullif(x->>'note',''),coalesce(x->'metadata','{}'::jsonb)
  from jsonb_array_elements(coalesce(p_document->'equipment','[]'::jsonb)) x;

  insert into recipe.step_equipment (user_id,recipe_version_id,step_id,equipment_id,note)
  select p_user_id,p_version_id,(x->>'stepId')::uuid,(x->>'equipmentId')::uuid,nullif(x->>'note','')
  from jsonb_array_elements(coalesce(p_document->'stepEquipment','[]'::jsonb)) x;
end;
$$;

revoke all on function recipe.replace_version_children(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function recipe.replace_version_children(uuid, uuid, jsonb) to service_role;

create or replace function gateway.recipe_get_document(p_user_id uuid, p_recipe_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select recipe.document_json(p_user_id, p_recipe_id);
$$;

create or replace function gateway.recipe_manifest(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'cursor', coalesce((select max(c.change_sequence) from recipe.sync_changes c where c.user_id=p_user_id),0),
    'recipes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'revision',r.revision,'state',r.state,'favorite',r.favorite,
        'currentVersionId',r.current_version_id,'title',v.title,'heroImagePath',r.hero_image_path,
        'deletedAt',r.deleted_at,'updatedAt',r.updated_at
      ) order by r.updated_at desc,r.id)
      from recipe.recipes r
      left join recipe.recipe_versions v on v.id=r.current_version_id and v.user_id=r.user_id
      where r.user_id=p_user_id
    ),'[]'::jsonb)
  );
$$;

create or replace function gateway.recipe_changes(
  p_user_id uuid,p_after bigint default 0,p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare v_changes jsonb; v_next bigint; v_more boolean;
begin
  if p_after<0 or p_limit<1 or p_limit>100 then raise exception 'RECIPE_BAD_REQUEST'; end if;
  with page as (
    select c.change_sequence,c.recipe_id,c.recipe_revision,c.change_kind,c.changed_at
    from recipe.sync_changes c
    where c.user_id=p_user_id and c.change_sequence>p_after
    order by c.change_sequence
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'sequence',p.change_sequence,'resourceId',p.recipe_id,'revision',p.recipe_revision,
      'kind',p.change_kind,'changedAt',p.changed_at
    ) order by p.change_sequence),'[]'::jsonb),
    coalesce(max(p.change_sequence),p_after)
  into v_changes,v_next from page p;
  select exists(select 1 from recipe.sync_changes c where c.user_id=p_user_id and c.change_sequence>v_next) into v_more;
  return jsonb_build_object('changes',v_changes,'nextCursor',v_next,'hasMore',v_more);
end;
$$;

create or replace function gateway.recipe_apply_mutation(
  p_user_id uuid,p_mutation_id uuid,p_resource_id uuid,p_base_revision bigint,
  p_operation text,p_document jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hash text; v_existing_hash text; v_existing_result jsonb;
  v_current_revision bigint; v_current_version_id uuid; v_deleted_at timestamptz;
  v_version jsonb; v_version_id uuid; v_recipe jsonb; v_state recipe.recipe_state;
  v_result jsonb; v_change_sequence bigint;
begin
  if p_user_id is null or p_mutation_id is null or p_resource_id is null
     or p_base_revision is null or p_base_revision<0
     or p_operation not in ('create','replace','delete') then
    raise exception 'RECIPE_BAD_REQUEST';
  end if;
  if p_operation in ('create','replace') then
    if p_document is null
       or coalesce((p_document->>'schemaVersion')::integer,0)<>1
       or (p_document#>>'{recipe,id}')::uuid<>p_resource_id then
      raise exception 'RECIPE_BAD_REQUEST';
    end if;
  end if;

  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'resourceId',p_resource_id,'baseRevision',p_base_revision,'operation',p_operation,'document',p_document
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text||':'||p_mutation_id::text,0));

  select m.payload_hash,m.result into v_existing_hash,v_existing_result
  from recipe.sync_mutations m where m.user_id=p_user_id and m.mutation_id=p_mutation_id;
  if found then
    if v_existing_hash<>v_hash then raise exception 'RECIPE_MUTATION_ID_REUSE'; end if;
    return v_existing_result;
  end if;

  if p_operation='create' then
    if p_base_revision<>0 then raise exception 'RECIPE_BAD_REQUEST'; end if;
    select r.revision into v_current_revision
    from recipe.recipes r where r.id=p_resource_id and r.user_id=p_user_id for update;
    if found then
      v_result:=jsonb_build_object('status','conflict','reason','already_exists','resourceId',p_resource_id,
        'remoteRevision',v_current_revision,'remote',recipe.document_json(p_user_id,p_resource_id));
      insert into recipe.sync_mutations(user_id,mutation_id,resource_id,payload_hash,result)
      values(p_user_id,p_mutation_id,p_resource_id,v_hash,v_result);
      return v_result;
    end if;

    v_recipe:=p_document->'recipe'; v_version:=p_document->'version';
    if v_version is null or (v_version->>'recipeId')::uuid<>p_resource_id
       or coalesce((v_version->>'versionNumber')::bigint,0)<>1 then
      raise exception 'RECIPE_BAD_REQUEST';
    end if;
    v_version_id:=(v_version->>'id')::uuid;
    v_state:=coalesce(nullif(v_recipe->>'state',''),'draft')::recipe.recipe_state;

    begin
      insert into recipe.recipes(id,user_id,state,visibility,favorite,revision,metadata,archived_at)
      values(p_resource_id,p_user_id,'draft','private',coalesce((v_recipe->>'favorite')::boolean,false),
        0,coalesce(v_recipe->'metadata','{}'::jsonb),null);

      insert into recipe.recipe_versions(
        id,user_id,recipe_id,parent_version_id,version_number,kind,title,description,story,
        yield_text,servings,serving_unit,difficulty,prep_minutes,active_minutes,passive_minutes,
        rest_minutes,total_minutes,cuisine_tags,category_tags,dietary_tags,locale,author_note,
        change_summary,revision,metadata
      ) values (
        v_version_id,p_user_id,p_resource_id,null,1,
        coalesce(nullif(v_version->>'kind',''),'original')::recipe.recipe_version_kind,
        v_version->>'title',nullif(v_version->>'description',''),nullif(v_version->>'story',''),
        nullif(v_version->>'yieldText',''),nullif(v_version->>'servings','')::numeric,
        nullif(v_version->>'servingUnit',''),coalesce(nullif(v_version->>'difficulty',''),'unknown')::recipe.recipe_difficulty,
        nullif(v_version->>'prepMinutes','')::integer,nullif(v_version->>'activeMinutes','')::integer,
        nullif(v_version->>'passiveMinutes','')::integer,nullif(v_version->>'restMinutes','')::integer,
        nullif(v_version->>'totalMinutes','')::integer,
        coalesce(array(select jsonb_array_elements_text(coalesce(v_version->'cuisineTags','[]'::jsonb))),'{}'::text[]),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_version->'categoryTags','[]'::jsonb))),'{}'::text[]),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_version->'dietaryTags','[]'::jsonb))),'{}'::text[]),
        nullif(v_version->>'locale',''),nullif(v_version->>'authorNote',''),nullif(v_version->>'changeSummary',''),
        0,coalesce(v_version->'metadata','{}'::jsonb)
      );
      perform recipe.replace_version_children(p_user_id,v_version_id,p_document);
      update recipe.recipes
      set current_version_id=v_version_id,state=v_state,
          archived_at=case when v_state='archived' then now() else null end,revision=1
      where id=p_resource_id and user_id=p_user_id;
    exception when unique_violation then
      raise exception 'RECIPE_BAD_REQUEST';
    end;

    insert into recipe.sync_changes(user_id,recipe_id,recipe_revision,change_kind)
    values(p_user_id,p_resource_id,1,'upsert') returning change_sequence into v_change_sequence;
    v_result:=jsonb_build_object('status','applied','resourceId',p_resource_id,'revision',1,'changeSequence',v_change_sequence);

  else
    select r.revision,r.current_version_id,r.deleted_at
    into v_current_revision,v_current_version_id,v_deleted_at
    from recipe.recipes r where r.id=p_resource_id and r.user_id=p_user_id for update;

    if not found then
      v_result:=jsonb_build_object('status','not_found','resourceId',p_resource_id);
    elsif v_current_revision<>p_base_revision then
      v_result:=jsonb_build_object('status','conflict',
        'reason',case when v_deleted_at is not null then 'deleted' else 'revision' end,
        'resourceId',p_resource_id,'remoteRevision',v_current_revision,
        'remote',recipe.document_json(p_user_id,p_resource_id));
    elsif p_operation='delete' then
      update recipe.recipes
      set state='archived',archived_at=coalesce(archived_at,now()),deleted_at=coalesce(deleted_at,now()),revision=revision+1
      where id=p_resource_id and user_id=p_user_id returning revision into v_current_revision;
      insert into recipe.sync_changes(user_id,recipe_id,recipe_revision,change_kind)
      values(p_user_id,p_resource_id,v_current_revision,'deleted') returning change_sequence into v_change_sequence;
      v_result:=jsonb_build_object('status','applied','resourceId',p_resource_id,'revision',v_current_revision,'changeSequence',v_change_sequence);
    else
      if v_deleted_at is not null then
        v_result:=jsonb_build_object('status','conflict','reason','deleted','resourceId',p_resource_id,
          'remoteRevision',v_current_revision,'remote',recipe.document_json(p_user_id,p_resource_id));
      else
        v_recipe:=p_document->'recipe'; v_version:=p_document->'version'; v_version_id:=(v_version->>'id')::uuid;
        if v_version_id<>v_current_version_id or (v_version->>'recipeId')::uuid<>p_resource_id then
          raise exception 'RECIPE_BAD_REQUEST';
        end if;
        v_state:=coalesce(nullif(v_recipe->>'state',''),'active')::recipe.recipe_state;

        update recipe.recipe_versions
        set title=v_version->>'title',description=nullif(v_version->>'description',''),story=nullif(v_version->>'story',''),
            yield_text=nullif(v_version->>'yieldText',''),servings=nullif(v_version->>'servings','')::numeric,
            serving_unit=nullif(v_version->>'servingUnit',''),
            difficulty=coalesce(nullif(v_version->>'difficulty',''),'unknown')::recipe.recipe_difficulty,
            prep_minutes=nullif(v_version->>'prepMinutes','')::integer,active_minutes=nullif(v_version->>'activeMinutes','')::integer,
            passive_minutes=nullif(v_version->>'passiveMinutes','')::integer,rest_minutes=nullif(v_version->>'restMinutes','')::integer,
            total_minutes=nullif(v_version->>'totalMinutes','')::integer,
            cuisine_tags=coalesce(array(select jsonb_array_elements_text(coalesce(v_version->'cuisineTags','[]'::jsonb))),'{}'::text[]),
            category_tags=coalesce(array(select jsonb_array_elements_text(coalesce(v_version->'categoryTags','[]'::jsonb))),'{}'::text[]),
            dietary_tags=coalesce(array(select jsonb_array_elements_text(coalesce(v_version->'dietaryTags','[]'::jsonb))),'{}'::text[]),
            locale=nullif(v_version->>'locale',''),author_note=nullif(v_version->>'authorNote',''),
            change_summary=nullif(v_version->>'changeSummary',''),metadata=coalesce(v_version->'metadata','{}'::jsonb),
            revision=revision+1
        where id=v_current_version_id and recipe_id=p_resource_id and user_id=p_user_id;

        perform recipe.replace_version_children(p_user_id,v_current_version_id,p_document);

        update recipe.recipes
        set state=v_state,favorite=coalesce((v_recipe->>'favorite')::boolean,favorite),
            archived_at=case when v_state='archived' then coalesce(archived_at,now()) else null end,
            metadata=coalesce(v_recipe->'metadata',metadata),revision=revision+1
        where id=p_resource_id and user_id=p_user_id returning revision into v_current_revision;

        insert into recipe.sync_changes(user_id,recipe_id,recipe_revision,change_kind)
        values(p_user_id,p_resource_id,v_current_revision,'upsert') returning change_sequence into v_change_sequence;
        v_result:=jsonb_build_object('status','applied','resourceId',p_resource_id,'revision',v_current_revision,'changeSequence',v_change_sequence);
      end if;
    end if;
  end if;

  insert into recipe.sync_mutations(user_id,mutation_id,resource_id,payload_hash,result)
  values(p_user_id,p_mutation_id,p_resource_id,v_hash,v_result);
  return v_result;
end;
$$;

create or replace function gateway.recipe_delete_all(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare v_recipes integer; v_mutations integer; v_changes integer;
begin
  delete from recipe.sync_mutations where user_id=p_user_id; get diagnostics v_mutations=row_count;
  delete from recipe.sync_changes where user_id=p_user_id; get diagnostics v_changes=row_count;
  delete from recipe.recipes where user_id=p_user_id; get diagnostics v_recipes=row_count;
  return jsonb_build_object('deleted',true,'recipes',v_recipes,'mutationReceipts',v_mutations,'changeRecords',v_changes);
end;
$$;

revoke all on function gateway.recipe_get_document(uuid,uuid) from public, anon, authenticated;
revoke all on function gateway.recipe_manifest(uuid) from public, anon, authenticated;
revoke all on function gateway.recipe_changes(uuid,bigint,integer) from public, anon, authenticated;
revoke all on function gateway.recipe_apply_mutation(uuid,uuid,uuid,bigint,text,jsonb) from public, anon, authenticated;
revoke all on function gateway.recipe_delete_all(uuid) from public, anon, authenticated;
grant execute on function gateway.recipe_get_document(uuid,uuid) to service_role;
grant execute on function gateway.recipe_manifest(uuid) to service_role;
grant execute on function gateway.recipe_changes(uuid,bigint,integer) to service_role;
grant execute on function gateway.recipe_apply_mutation(uuid,uuid,uuid,bigint,text,jsonb) to service_role;
grant execute on function gateway.recipe_delete_all(uuid) to service_role;;
