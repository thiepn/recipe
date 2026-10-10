import { z } from 'zod';
import type { LocalRecipeRecord } from '../data/local-db.ts';
import type { PantryDocument, RecipeCoverage } from '../library/ingredients.ts';
import { evaluateRecipe, ingredientKey, normalizeIngredientText } from '../library/ingredients.ts';

export const cookingPreferencesSchema=z.object({
 schemaVersion:z.literal(1),enabled:z.boolean(),maxMinutes:z.union([z.literal(15),z.literal(30),z.literal(45),z.literal(60),z.null()]),
 preferFavorites:z.boolean(),hiddenIngredients:z.array(z.string().trim().min(1).max(100)).max(12),
}).strict();
export type CookingPreferences=z.infer<typeof cookingPreferencesSchema>;
export const DEFAULT_COOKING_PREFERENCES:CookingPreferences={
 schemaVersion:1,enabled:false,maxMinutes:null,preferFavorites:false,hiddenIngredients:[],
};
export function cleanCookingPreferences(value:unknown):CookingPreferences{
 const parsed=cookingPreferencesSchema.safeParse(value);
 if(!parsed.success)return {...DEFAULT_COOKING_PREFERENCES,hiddenIngredients:[]};
 const seen=new Set<string>();
 return {...parsed.data,hiddenIngredients:parsed.data.hiddenIngredients.filter(name=>{
  const key=ingredientKey(name);
  if(key==='exact:' || seen.has(key))return false;
  seen.add(key);return true;
 })};
}
export function addHiddenIngredient(prefs:CookingPreferences,raw:string):CookingPreferences{
 const text=raw.trim();
 if(!text || !normalizeIngredientText(text) || /[,;\n]/.test(text))throw new Error('Enter one specific ingredient name.');
 const updated=cookingPreferencesSchema.parse({...prefs,hiddenIngredients:[...prefs.hiddenIngredients,text]});
 return cleanCookingPreferences(updated);
}
export interface CookingIdea {
 recipeId:string;title:string;minutes:number|null;favorite:boolean;coverage:RecipeCoverage;
 score:number;reasons:string[];missing:string[];substitutions:string[];
}
/** Never replaces ingredients or assumes equivalence; offers tightly scoped review-only notes. */
export function contextualSubstitutionNotes(record:LocalRecipeRecord,pantry:PantryDocument):string[]{
 const steps=record.working.steps.map(s=>s.instruction).join(' ').toLocaleLowerCase('en');
 const tag=record.working.version.categoryTags.concat(record.working.version.cuisineTags).join(' ').toLocaleLowerCase('en');
 const title=record.working.version.title.toLocaleLowerCase('en');
 if(/bake|baking|cake|cookie|pastry|bread|muffin|brot|kuchen/.test([steps,tag,title].join(' ')))return [];
 const owned=new Set(pantry.ingredients.map(ingredientKey));
 const required=new Set(record.working.ingredients.filter(i=>!i.optional).map(i=>ingredientKey(i.name)));
 const result:string[]=[];
 if(required.has('butter')&&!owned.has('butter')&&owned.has('olive oil')&&
    /saut[eé]|pan.fry|stir.fry|anbraten/i.test(steps))
  result.push('Review-only idea for explicitly stated pan sautéing: olive oil may change flavor and cooking behavior. Never assume equal amounts or use as a baking conversion.');
 if(required.has('lemon')&&!owned.has('lemon')&&owned.has('lime')&&
    /dressing|vinaigrette|marinad|season|abschmecken/i.test(steps))
  result.push('Review-only dressing/seasoning idea: lime has different flavor and acidity from lemon. Check the original instruction and decide yourself.');
 return result;
}
/** Derive only from verified owner-local records; no AI, network, cross-account or plan writes. */
export function suggestCookingIdeas(
 records:readonly LocalRecipeRecord[],pantry:PantryDocument,prefs:CookingPreferences,
 ownerId:string|null,limit=4,
):CookingIdea[]{
 if(!prefs.enabled||!ownerId||!cookingPreferencesSchema.safeParse(prefs).success)return [];
 const hidden=new Set(prefs.hiddenIngredients.map(ingredientKey));
 const result:CookingIdea[]=[];
 for(const r of records){
  if(r.accountId!==ownerId||r.tombstone||r.working.recipe.state==='archived')continue;
  const v=r.working.version;
  if(prefs.maxMinutes!==null&&(v.totalMinutes===null||v.totalMinutes>prefs.maxMinutes))continue;
  if(hidden.size&&(!r.working.ingredients.length||r.working.ingredients.some(i=>
   hidden.has(ingredientKey(i.name))||(i.canonicalKey?hidden.has(ingredientKey(i.canonicalKey)):false))))continue;
  const coverage=evaluateRecipe(r,pantry);
  const measured=coverage.status==='measured'&&pantry.ingredients.length>0;
  const fraction=measured&&coverage.required>0?coverage.available/coverage.required:0;
  const favorite=r.working.recipe.favorite;
  const score=Math.round(100*fraction)+(prefs.preferFavorites&&favorite?14:0)+
   (v.totalMinutes!==null?Math.max(0,12-Math.floor(v.totalMinutes/10)):0);
  const reasons=[measured?coverage.available+' of '+coverage.required+' required ingredient types on your pantry list'
   :'Ingredient availability and amounts not verified',
   ...(favorite?['Saved favorite']:[]),
   v.totalMinutes!==null?'Recipe lists '+v.totalMinutes+' minutes (estimate only)':'No recorded cooking time'];
  result.push({recipeId:r.resourceId,title:v.title,minutes:v.totalMinutes,favorite,coverage,
   score,reasons,missing:measured?coverage.missing:[],
   substitutions:contextualSubstitutionNotes(r,pantry)});
 }
 result.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)||a.recipeId.localeCompare(b.recipeId));
 return result.slice(0,Math.max(0,Math.min(12,Math.trunc(limit))));
}
