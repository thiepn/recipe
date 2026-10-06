create or replace function gateway.recipe_collection_book_apply(
  p_user_id uuid,
  p_mutation_id uuid,
  p_base_revision bigint,
  p_document jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hash text;
  v_existing_hash text;
  v_existing_result jsonb;
  v_current_revision bigint;
  v_next_revision bigint;
  v_result jsonb;
  v_collection jsonb;
  v_collection_id uuid;
  v_kind recipe.collection_kind;
  v_name text;
  v_position integer;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
begin
  if p_user_id is null or p_mutation_id is null or p_base_revision is null
     or p_base_revision < 0 or p_document is null
     or coalesce((p_document->>'schemaVersion')::integer,0) <> 1
     or jsonb_typeof(coalesce(p_document->'collections','null'::jsonb)) <> 'array'
     or jsonb_array_length(p_document->'collections') > 200 then
    raise exception 'RECIPE_COLLECTION_BAD_REQUEST';
  end if;

  v_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'baseRevision',p_base_revision,
          'document',p_document
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':recipe-collections',0)
  );

  select m.payload_hash,m.result
    into v_existing_hash,v_existing_result
  from recipe.collection_book_mutations m
  where m.user_id=p_user_id and m.mutation_id=p_mutation_id;

  if found then
    if v_existing_hash <> v_hash then
      raise exception 'RECIPE_COLLECTION_MUTATION_ID_REUSE';
    end if;
    return v_existing_result;
  end if;

  insert into recipe.collection_books(user_id,revision)
  values(p_user_id,0)
  on conflict (user_id) do nothing;

  select revision into v_current_revision
  from recipe.collection_books
  where user_id=p_user_id
  for update;

  if v_current_revision <> p_base_revision then
    v_result := jsonb_build_object(
      'status','conflict',
      'remoteRevision',v_current_revision,
      'remote',recipe.collection_book_json(p_user_id)
    );
    insert into recipe.collection_book_mutations(user_id,mutation_id,payload_hash,result)
    values(p_user_id,p_mutation_id,v_hash,v_result);
    return v_result;
  end if;

  for v_collection in
    select value from jsonb_array_elements(p_document->'collections')
  loop
    if jsonb_typeof(v_collection) <> 'object'
       or nullif(v_collection->>'id','') is null
       or nullif(btrim(v_collection->>'name'),'') is null then
      raise exception 'RECIPE_COLLECTION_BAD_REQUEST';
    end if;

    v_collection_id := (v_collection->>'id')::uuid;
    if v_collection_id = any(v_seen_ids) then
      raise exception 'RECIPE_COLLECTION_BAD_REQUEST';
    end if;
    v_seen_ids := array_append(v_seen_ids,v_collection_id);

    v_kind := coalesce(nullif(v_collection->>'kind',''),'manual')::recipe.collection_kind;
    if v_kind <> 'manual' then
      raise exception 'RECIPE_COLLECTION_BAD_REQUEST';
    end if;

    v_name := btrim(v_collection->>'name');
    if char_length(v_name) > 120 then
      raise exception 'RECIPE_COLLECTION_BAD_REQUEST';
    end if;

    v_position := coalesce((v_collection->>'position')::integer,0);
    if v_position < 0 then raise exception 'RECIPE_COLLECTION_BAD_REQUEST'; end if;

    insert into recipe.collections(
      id,user_id,kind,name,description,icon_key,cover_image_path,position,
      smart_filter,metadata,revision,deleted_at
    )
    values(
      v_collection_id,p_user_id,'manual',v_name,
      nullif(v_collection->>'description',''),
      nullif(v_collection->>'iconKey',''),
      nullif(v_collection->>'coverImagePath',''),
      v_position,
      null,
      coalesce(v_collection->'metadata','{}'::jsonb),
      v_current_revision+1,
      null
    )
    on conflict (id) do update
    set
      kind='manual',
      name=excluded.name,
      description=excluded.description,
      icon_key=excluded.icon_key,
      cover_image_path=excluded.cover_image_path,
      position=excluded.position,
      smart_filter=null,
      metadata=excluded.metadata,
      revision=v_current_revision+1,
      deleted_at=null
    where recipe.collections.user_id=p_user_id;

    if not found then
      raise exception 'RECIPE_COLLECTION_BAD_REQUEST';
    end if;

    delete from recipe.collection_recipes
    where user_id=p_user_id and collection_id=v_collection_id;

    insert into recipe.collection_recipes(user_id,collection_id,recipe_id,position)
    select
      p_user_id,
      v_collection_id,
      x.recipe_id,
      x.ordinality::integer - 1
    from (
      select value::uuid as recipe_id, ordinality
      from jsonb_array_elements_text(
        coalesce(v_collection->'recipeIds','[]'::jsonb)
      ) with ordinality
    ) x
    join recipe.recipes r
      on r.id=x.recipe_id
     and r.user_id=p_user_id
     and r.deleted_at is null;
  end loop;

  update recipe.collections
  set deleted_at=coalesce(deleted_at,now()),
      revision=v_current_revision+1
  where user_id=p_user_id
    and kind='manual'
    and deleted_at is null
    and not (id = any(v_seen_ids));

  v_next_revision := v_current_revision+1;
  update recipe.collection_books
  set revision=v_next_revision,updated_at=now()
  where user_id=p_user_id;

  v_result := jsonb_build_object(
    'status','applied',
    'revision',v_next_revision,
    'document',recipe.collection_book_json(p_user_id)
  );

  insert into recipe.collection_book_mutations(user_id,mutation_id,payload_hash,result)
  values(p_user_id,p_mutation_id,v_hash,v_result);

  return v_result;
exception
  when unique_violation or foreign_key_violation or check_violation
  then raise exception 'RECIPE_COLLECTION_BAD_REQUEST';
end;
$$;\n