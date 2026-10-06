create index collection_recipes_recipe_fk_idx
  on recipe.collection_recipes (recipe_id, user_id);

create index ingredient_groups_user_idx
  on recipe.ingredient_groups (user_id);

create index recipe_equipment_user_idx
  on recipe.recipe_equipment (user_id);

create index recipe_ingredients_group_fk_idx
  on recipe.recipe_ingredients (recipe_version_id, group_id, user_id)
  where group_id is not null;

create index recipe_sources_user_idx
  on recipe.recipe_sources (user_id);

create index recipe_sources_version_fk_idx
  on recipe.recipe_sources (recipe_id, version_id, user_id)
  where version_id is not null;

create index recipe_steps_user_idx
  on recipe.recipe_steps (user_id);

create index recipe_versions_parent_fk_idx
  on recipe.recipe_versions (recipe_id, parent_version_id, user_id)
  where parent_version_id is not null;

create index recipe_versions_user_idx
  on recipe.recipe_versions (user_id);

create index recipes_current_version_fk_idx
  on recipe.recipes (id, current_version_id, user_id)
  where current_version_id is not null;

create index step_equipment_equipment_fk_idx
  on recipe.step_equipment (recipe_version_id, equipment_id, user_id);

create index step_equipment_step_fk_idx
  on recipe.step_equipment (recipe_version_id, step_id, user_id);

create index step_equipment_user_idx
  on recipe.step_equipment (user_id);

create index step_ingredients_ingredient_fk_idx
  on recipe.step_ingredients (recipe_version_id, ingredient_id, user_id);

create index step_ingredients_step_fk_idx
  on recipe.step_ingredients (recipe_version_id, step_id, user_id);

create index step_ingredients_user_idx
  on recipe.step_ingredients (user_id);
