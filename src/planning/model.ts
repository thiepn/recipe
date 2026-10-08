import { z } from 'zod';
import type { LocalRecipeRecord, RecipeLocalDb } from '../data/local-db.ts';
import { ingredientKey } from '../library/ingredients.ts';

export const MEAL_SLOTS = ['breakfast','lunch','dinner','snack'] as const;
export type MealSlot = typeof MEAL_SLOTS[number];
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(day => {
  const date = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}, 'Invalid calendar date');

const mealSchema = z.object({
  day: isoDay,
  slot: z.enum(MEAL_SLOTS),
  recipeId: z.string().uuid(),
  servings: z.number().finite().positive().max(100).nullable(),
}).strict();

const manualItemSchema = z.object({
  id: z.string().uuid(),
  week: isoDay,
  name: z.string().trim().min(1).max(160),
  checked: z.boolean(),
}).strict();

const shoppingCheckSchema = z.object({
  week: isoDay,
  key: z.string().min(1).max(1024),
}).strict();

export const mealPlannerSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(mealSchema).max(2000),
  manualItems: z.array(manualItemSchema).max(500),
  purchased: z.array(shoppingCheckSchema).max(3000),
  updatedAt: z.number().int().nonnegative(),
}).strict().superRefine((plan, ctx) => {
  const unique = (values: string[], path: string) => {
    const known = new Set<string>();
    for (const [index, key] of values.entries()) {
      if (known.has(key)) ctx.addIssue({
        code: 'custom', path: [path,index], message: 'Duplicate plan entry',
      });
      known.add(key);
    }
  };
  unique(plan.entries.map(entry => `${entry.day}:${entry.slot}`),'entries');
  unique(plan.manualItems.map(item => item.id),'manualItems');
  unique(plan.purchased.map(item => `${item.week}:${item.key}`),'purchased');
});
export type MealPlannerState = z.infer<typeof mealPlannerSchema>;
export type MealAssignment = z.infer<typeof mealSchema>;
export type ManualShoppingItem = z.infer<typeof manualItemSchema>;

export function emptyMealPlanner(now = Date.now()): MealPlannerState {
  return { schemaVersion: 1, entries: [], manualItems: [], purchased: [], updatedAt: now };
}
export function cleanMealPlanner(value: unknown): MealPlannerState {
  const result = mealPlannerSchema.safeParse(value);
  return result.success ? result.data : emptyMealPlanner();
}

function dayDate(day: string): Date {
  const checked = isoDay.parse(day);
  return new Date(`${checked}T12:00:00Z`);
}
function asDay(value: Date): string {
  return value.toISOString().slice(0,10);
}
export function localToday(date: Date = new Date()): string {
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,'0');
  const d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
export function addDays(day: string, delta: number): string {
  if (!Number.isInteger(delta) || Math.abs(delta)>4000) throw new RangeError('Invalid day offset');
  const date=dayDate(day);
  date.setUTCDate(date.getUTCDate()+delta);
  return asDay(date);
}
export function mondayOf(day: string): string {
  const date=dayDate(day);
  return addDays(day, -((date.getUTCDay()+6)%7));
}
export function weekDays(monday: string): string[] {
  const start=mondayOf(monday);
  return Array.from({length:7},(_,index)=>addDays(start,index));
}

export function assignMeal(
  plan: MealPlannerState, day: string, slot: MealSlot, recipeId: string | null,
  servings: number | null = null, now = Date.now(),
): MealPlannerState {
  isoDay.parse(day);
  if (!MEAL_SLOTS.includes(slot)) throw new RangeError('Invalid meal slot');
  const entries=plan.entries.filter(item=>item.day!==day||item.slot!==slot);
  if(recipeId!==null) entries.push(mealSchema.parse({day,slot,recipeId,servings}));
  return mealPlannerSchema.parse({...plan,entries,updatedAt:now});
}
export function addManualItem(
  plan: MealPlannerState, week: string, name: string, id: string, now = Date.now(),
): MealPlannerState {
  const manualItems=[...plan.manualItems,manualItemSchema.parse({id,week:mondayOf(week),name,checked:false})];
  return mealPlannerSchema.parse({...plan,manualItems,updatedAt:now});
}
export function toggleManualItem(
  plan: MealPlannerState, id: string, now = Date.now(),
): MealPlannerState {
  return mealPlannerSchema.parse({
    ...plan,manualItems:plan.manualItems.map(item=>item.id===id?{...item,checked:!item.checked}:item),
    updatedAt:now,
  });
}
export function removeManualItem(
  plan: MealPlannerState, id: string, now = Date.now(),
): MealPlannerState {
  return mealPlannerSchema.parse({
    ...plan,manualItems:plan.manualItems.filter(item=>item.id!==id),updatedAt:now,
  });
}
export function togglePurchased(
  plan: MealPlannerState, week: string, key: string, now = Date.now(),
): MealPlannerState {
  const monday=mondayOf(week);
  const found=plan.purchased.some(item=>item.week===monday&&item.key===key);
  const purchased=found?plan.purchased.filter(item=>item.week!==monday||item.key!==key)
    :[...plan.purchased,shoppingCheckSchema.parse({week:monday,key})];
  return mealPlannerSchema.parse({...plan,purchased,updatedAt:now});
}

export interface ShoppingRow {
  key: string;
  name: string;
  amount: number | null;
  amountMax: number | null;
  unit: string | null;
  contributions: number;
  recipeNames: string[];
  available: boolean;
  checked: boolean;
  note: string | null;
}

function normalizedUnit(unit: string | null): { unit: string | null; factor: number } {
  const cleaned=unit?.trim().toLocaleLowerCase()||null;
  if(cleaned==='kg') return {unit:'g',factor:1000};
  if(cleaned==='g') return {unit:'g',factor:1};
  if(cleaned==='l') return {unit:'ml',factor:1000};
  if(cleaned==='ml') return {unit:'ml',factor:1};
  return {unit:cleaned,factor:1};
}
const amount = (value: number): number => Number(value.toFixed(4));

/** Derived shopping rows: combine only equivalent ingredients with compatible
 * units, preparation and quantity semantics. No conversions between spoons,
 * cups, grams, pieces or unidentified units. */
export function shoppingRows(
  plan: MealPlannerState, week: string, records: readonly LocalRecipeRecord[],
  ownedIngredients: readonly string[] = [],
): ShoppingRow[] {
  const monday=mondayOf(week),days=new Set(weekDays(monday));
  const recipes=new Map(records.filter(r=>!r.tombstone&&r.working.recipe.state!=='archived')
    .map(r=>[r.resourceId,r]));
  const owned=new Set(ownedIngredients.map(ingredientKey));
  const groups=new Map<string,{
    name:string;unit:string|null;amount:number|null;amountMax:number|null;
    recipeNames:Set<string>;contributions:number;available:boolean;note:string|null;
  }>();

  for(const entry of plan.entries) {
    if(!days.has(entry.day))continue;
    const record=recipes.get(entry.recipeId);
    if(!record)continue;
    const document=record.working;
    const factor=entry.servings!==null&&document.version.servings!==null
      ? entry.servings/document.version.servings : 1;
    for(const ingredient of document.ingredients) {
      const canonical=ingredientKey(ingredient.name);
      const conversion=normalizedUnit(ingredient.unit);
      const preparation=ingredient.preparation?.trim().toLocaleLowerCase()||'';
      const qty=ingredient.quantity===null?null:amount(ingredient.quantity*conversion.factor*
        (ingredient.scalingMode==='linear'?factor:1));
      const max=ingredient.quantityMax===null?null:amount(ingredient.quantityMax*conversion.factor*
        (ingredient.scalingMode==='linear'?factor:1));
      const mode=ingredient.scalingMode;
      const qualifier=ingredient.optional?'optional':'required';
      // Keep unquantified, ranged, and non-linear quantities separate from
      // exact linear totals. All other compatible exact quantities may sum.
      const mergeable=qty!==null&&max===null&&mode==='linear';
      const kind=mergeable?'sum':qty===null?'unspecified':`individual:${entry.day}:${entry.slot}:${ingredient.id}`;
      const key=`${canonical}|${conversion.unit??''}|${preparation}|${qualifier}|${kind}`;
      const found=groups.get(key);
      if(found){
        if(mergeable&&found.amount!==null&&qty!==null)found.amount=amount(found.amount+qty);
        found.contributions++;
        found.recipeNames.add(document.version.title);
      }else{
        groups.set(key,{
          name:ingredient.name,unit:conversion.unit,amount:qty,amountMax:max,
          recipeNames:new Set([document.version.title]),contributions:1,
          available:owned.has(canonical),
          note:mode==='seasoning'||mode==='contextual'?'Adjust to taste or context'
            :mode==='fixed'?'Fixed quantity; verify for multiple batches'
            :ingredient.optional?'Optional ingredient':null,
        });
      }
    }
  }
  const checkedSet=new Set(plan.purchased.filter(item=>item.week===monday).map(item=>item.key));
  return [...groups].map(([baseKey,item])=>{
    const signature=[item.amount??'?',item.amountMax??'',item.contributions].join(':');
    const key=`${baseKey}|${signature}`;
    return {
      key,name:item.name,unit:item.unit,amount:item.amount,amountMax:item.amountMax,
      contributions:item.contributions,recipeNames:[...item.recipeNames],available:item.available,
      checked:checkedSet.has(key),note:item.note,
    };
  }).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||
    (a.unit??'').localeCompare(b.unit??''));
}
export function amountLabel(row: Pick<ShoppingRow,'amount'|'amountMax'|'unit'>): string {
  if(row.amount===null)return row.unit?`Amount needed (${row.unit})`:'Amount unspecified';
  const value=Number(row.amount.toFixed(2)).toLocaleString(undefined,{maximumFractionDigits:2});
  const max=row.amountMax===null?'':`–${Number(row.amountMax.toFixed(2)).toLocaleString(undefined,{maximumFractionDigits:2})}`;
  return `${value}${max}${row.unit?` ${row.unit}`:''}`;
}
export function shoppingText(
  rows: readonly ShoppingRow[],manual:readonly ManualShoppingItem[],title:string,
): string {
  return [
    title,
    ...rows.map(row=>`${row.checked?'[x]':'[ ]'} ${amountLabel(row)} — ${row.name}${row.available?' (in pantry, quantity not checked)':''}`),
    ...manual.map(item=>`${item.checked?'[x]':'[ ]'} ${item.name}`),
  ].join('\n');
}

const STORAGE_KEY='meal-plan-v1';
export class MealPlannerStore {
  readonly #db:Pick<RecipeLocalDb,'getMeta'|'setMeta'>;
  readonly #accountId:string;
  #writes:Promise<void>=Promise.resolve();
  constructor(db:Pick<RecipeLocalDb,'getMeta'|'setMeta'>,accountId:string) {
    this.#db=db;
    this.#accountId=accountId;
  }
  async load(): Promise<MealPlannerState> {
    await this.#writes.catch(() => undefined);
    return cleanMealPlanner(await this.#db.getMeta(this.#accountId,STORAGE_KEY));
  }
  save(state:MealPlannerState): Promise<void> {
    const value=mealPlannerSchema.parse(state);
    const next=this.#writes.catch(()=>undefined).then(()=>
      this.#db.setMeta(this.#accountId,STORAGE_KEY,value));
    this.#writes=next;
    return next;
  }
  clear(): Promise<void> {
    const next=this.#writes.catch(()=>undefined).then(()=>
      this.#db.setMeta(this.#accountId,STORAGE_KEY,null));
    this.#writes=next;
    return next;
  }
}

/** A stable store survives Plan tab unmount/remount for the same live database.
 * It preserves the write queue when a user navigates immediately after a change. */
const planStores = new WeakMap<RecipeLocalDb,Map<string,MealPlannerStore>>();
export function mealPlannerStoreFor(db:RecipeLocalDb,accountId:string):MealPlannerStore {
  let accounts=planStores.get(db);
  if(!accounts){accounts=new Map();planStores.set(db,accounts);}
  let store=accounts.get(accountId);
  if(!store){store=new MealPlannerStore(db,accountId);accounts.set(accountId,store);}
  return store;
}
