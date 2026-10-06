create or replace function gateway.recipe_apply_mutation_checked(
  p_user_id uuid,
  p_mutation_id uuid,
  p_resource_id uuid,
  p_base_revision bigint,
  p_operation text,
  p_document jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return gateway.recipe_apply_mutation(
    p_user_id,
    p_mutation_id,
    p_resource_id,
    p_base_revision,
    p_operation,
    p_document
  );
exception
  when unique_violation
    or foreign_key_violation
    or check_violation
    or not_null_violation
    or invalid_text_representation
    or numeric_value_out_of_range
    or string_data_right_truncation
  then
    raise exception 'RECIPE_BAD_REQUEST';
end;
$$;

revoke all on function gateway.recipe_apply_mutation_checked(uuid,uuid,uuid,bigint,text,jsonb)
  from public, anon, authenticated;
grant execute on function gateway.recipe_apply_mutation_checked(uuid,uuid,uuid,bigint,text,jsonb)
  to service_role;
