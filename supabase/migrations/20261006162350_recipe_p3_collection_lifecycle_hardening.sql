create or replace function gateway.recipe_delete_all(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recipes integer;
  v_mutations integer;
  v_changes integer;
  v_collections integer;
  v_collection_mutations integer;
  v_collection_books integer;
begin
  delete from recipe.collection_book_mutations where user_id=p_user_id;
  get diagnostics v_collection_mutations=row_count;

  delete from recipe.collection_recipes where user_id=p_user_id;

  delete from recipe.collections where user_id=p_user_id;
  get diagnostics v_collections=row_count;

  delete from recipe.collection_books where user_id=p_user_id;
  get diagnostics v_collection_books=row_count;

  delete from recipe.sync_mutations where user_id=p_user_id;
  get diagnostics v_mutations=row_count;

  delete from recipe.sync_changes where user_id=p_user_id;
  get diagnostics v_changes=row_count;

  delete from recipe.recipes where user_id=p_user_id;
  get diagnostics v_recipes=row_count;

  return jsonb_build_object(
    'deleted',true,
    'recipes',v_recipes,
    'mutationReceipts',v_mutations,
    'changeRecords',v_changes,
    'collections',v_collections,
    'collectionMutationReceipts',v_collection_mutations,
    'collectionBooks',v_collection_books
  );
end;
$$;
