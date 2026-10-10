import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChefHat, ClipboardCopy, Plus, ShoppingBasket, Trash2,
} from 'lucide-react';
import type { LocalRecipeRecord, RecipeLocalDb } from '../data/local-db.ts';
import type { PantryDocument } from '../library/ingredients.ts';
import {
  MEAL_SLOTS, mealPlannerStoreFor, addDays, addManualItem, amountLabel, assignMeal,
  localToday, mondayOf, removeManualItem, shoppingRows, shoppingText, toggleManualItem,
  togglePurchased, weekDays, type MealPlannerState, type MealSlot,
} from '../planning/model.ts';

interface Props {
  records: LocalRecipeRecord[];
  db: RecipeLocalDb;
  accountId: string;
  pantry: PantryDocument;
  onCook: (record: LocalRecipeRecord) => void;
  onEdit: (record: LocalRecipeRecord) => void;
  onAdd: () => void;
}

function longDay(value: string): string {
  return new Intl.DateTimeFormat(undefined,{weekday:'long',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
}
function shortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
}
function prettyWeek(start: string): string {
  return `${shortDate(start)} – ${shortDate(addDays(start,6))}`;
}
function slotLabel(slot:MealSlot):string {
  return slot==='breakfast'?'Breakfast':slot==='lunch'?'Lunch':slot==='dinner'?'Dinner':'Snack';
}

export function MealPlanner({records,db,accountId,pantry,onCook,onEdit,onAdd}:Props) {
  const store=useMemo(()=>mealPlannerStoreFor(db,accountId),[db,accountId]);
  const [plan,setPlan]=useState<MealPlannerState|null>(null);
  const planRef=useRef<MealPlannerState|null>(null);
  const [week,setWeek]=useState(()=>mondayOf(localToday()));
  const [manualText,setManualText]=useState('');
  const [showNeededOnly,setShowNeededOnly]=useState(false);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);
  const shoppingRef=useRef<HTMLElement|null>(null);
  const savedRecipes=useMemo(()=>[...records]
    .filter(item=>!item.tombstone&&item.working.recipe.state!=='archived')
    .sort((a,b)=>a.working.version.title.localeCompare(b.working.version.title)),[records]);
  const recipeById=useMemo(()=>new Map(savedRecipes.map(r=>[r.resourceId,r])),[savedRecipes]);

  useEffect(()=>{
    let cancelled=false;
    const refresh=()=>void store.load().then(value=>{
      if(cancelled)return;
      planRef.current=value;
      setPlan(value);
    }).catch(()=>{
      if(!cancelled)setError('Your meal plan could not be opened. Check browser storage permissions.');
    });
    refresh();
    globalThis.addEventListener('recipe:workspace-changed',refresh);
    return ()=>{
      cancelled=true;
      globalThis.removeEventListener('recipe:workspace-changed',refresh);
    };
  },[store]);

  const change=(update:(current:MealPlannerState)=>MealPlannerState)=>{
    const current=planRef.current;
    if(!current)return;
    try{
      const next=update(current);
      planRef.current=next;
      setPlan(next);
      setCopied(false);
      void store.save(next).then(()=>setError('')).catch(()=>
        setError('Saving this change failed. Keep this tab open and check device storage before continuing.'));
    }catch(e){
      setError(e instanceof Error?e.message:'This change could not be saved.');
    }
  };
  const weekEntries=useMemo(()=>plan?.entries.filter(item=>
    item.day>=week&&item.day<=addDays(week,6))??[],[plan,week]);
  const rows=useMemo(()=>plan?shoppingRows(plan,week,savedRecipes,pantry.ingredients):[],
    [plan,week,savedRecipes,pantry.ingredients]);
  const manual=useMemo(()=>plan?.manualItems.filter(item=>item.week===week)??[],[plan,week]);
  const visibleRows=showNeededOnly?rows.filter(row=>!row.available):rows;
  const shoppingCount=rows.filter(row=>!row.checked).length+
    manual.filter(item=>!item.checked).length;
  const plannedDays=weekDays(week);
  const today=localToday();
  const populatedSlots=weekEntries.length;

  const chooseRecipe=(day:string,slot:MealSlot,recipeId:string)=>{
    const record=recipeById.get(recipeId);
    change(current=>assignMeal(current,day,slot,recipeId||null,record?.working.version.servings??null));
  };
  const updateServings=(day:string,slot:MealSlot,recipeId:string,text:string)=>{
    if(!text.trim())return change(current=>assignMeal(current,day,slot,recipeId,null));
    const value=Number(text);
    if(!Number.isFinite(value)||value<=0)return;
    change(current=>assignMeal(current,day,slot,recipeId,Math.min(100,value)));
  };
  const addOther=()=>{
    const name=manualText.trim();
    if(!name)return;
    change(current=>addManualItem(current,week,name,crypto.randomUUID()));
    setManualText('');
  };
  const copy=async()=>{
    if(!plan)return;
    const text=shoppingText(rows,manual,`Shopping list · ${prettyWeek(week)}`);
    try{
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard access unavailable');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError('');
    }catch{
      setError('Could not copy the shopping list. Check clipboard permission or use another browser.');
    }
  };

  if(!plan)return <div className="planner-loading" role="status">
    {error||'Opening your meal planner…'}
  </div>;

  return <section className="meal-planner" aria-labelledby="meal-plan-heading">
    <header className="planner-head">
      <div>
        <p className="eyebrow">Kitchen / Planning</p>
        <h1 id="meal-plan-heading">Meal plan</h1>
        <p>Choose recipes for each day. The shopping list follows your menu.</p>
      </div>
      <button type="button" className="planner-shop-jump" onClick={()=>{
        const target=shoppingRef.current;
        if(!target)return;
        target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
        target.focus({preventScroll:true});
      }}>
        <ShoppingBasket size={18}/> Shopping list <span>{shoppingCount}</span>
      </button>
    </header>
    {error&&<p role="alert" className="planner-error">{error}</p>}
    {savedRecipes.length===0&&<div className="planner-first-recipe">
      <div><strong>Your cookbook is empty.</strong>
        <span>Add a recipe to begin planning meals; you can still write manual groceries below.</span>
      </div>
      <button type="button" className="button button-primary" onClick={onAdd}><Plus size={17}/> Add first recipe</button>
    </div>}
    <div className="planner-weekbar">
      <div className="planner-week-controls">
        <button type="button" aria-label="Previous week" onClick={()=>setWeek(w=>addDays(w,-7))}><ArrowLeft size={18}/></button>
        <div><span>Week of</span><strong>{prettyWeek(week)}</strong></div>
        <button type="button" aria-label="Next week" onClick={()=>setWeek(w=>addDays(w,7))}><ArrowRight size={18}/></button>
      </div>
      <button type="button" className="planner-today" disabled={mondayOf(today)===week} onClick={()=>setWeek(mondayOf(today))}>Current week</button>
    </div>
    <div className="planner-week-summary" aria-live="polite">
      <span><strong>{populatedSlots}</strong> of {plannedDays.length*MEAL_SLOTS.length} meal slots planned</span>
      <span><strong>{shoppingCount}</strong> shopping items still unchecked</span>
      <span className="planner-week-note">Personal plan · saved on this device</span>
    </div>
    <div className="planner-layout">
      <div className="planner-days" aria-label="Weekly meal assignments">
        {plannedDays.map(day=>{
          const isToday=day===today;
          return <article className={isToday?'planner-day is-today':'planner-day'} key={day}>
            <header className="planner-day-heading">
              <div><span>{shortDate(day)}</span><h2>{longDay(day)}</h2></div>
              {isToday&&<span className="planner-today-tag">Today</span>}
            </header>
            <div className="planner-meals">
              {MEAL_SLOTS.map(slot=>{
                const assigned=weekEntries.find(item=>item.day===day&&item.slot===slot);
                const record=assigned?recipeById.get(assigned.recipeId):undefined;
                return <div className="planner-meal" key={slot}>
                  <label htmlFor={`meal-${day}-${slot}`}>{slotLabel(slot)}</label>
                  <div className="planner-meal-input">
                    <select
                      id={`meal-${day}-${slot}`}
                      aria-label={`${longDay(day)} ${slotLabel(slot)} recipe`}
                      value={assigned?.recipeId??''}
                      disabled={savedRecipes.length===0}
                      onChange={event=>chooseRecipe(day,slot,event.target.value)}>
                      <option value="">{savedRecipes.length===0?'Add a recipe to your cookbook':'Add a recipe…'}</option>
                      {assigned&&!record&&<option value={assigned.recipeId}>Unavailable recipe — select another</option>}
                      {savedRecipes.map(item=>
                        <option key={item.resourceId} value={item.resourceId}>{item.working.version.title}</option>)}
                    </select>
                    {record&&<button type="button" title={record.working.steps.length>0?'Start cooking':'Add cooking steps'}
                      aria-label={record.working.steps.length>0?`Cook ${record.working.version.title}`:`Edit ${record.working.version.title} to add steps`}
                      onClick={()=>record.working.steps.length>0?onCook(record):onEdit(record)}><ChefHat size={17}/></button>}
                  </div>
                  {record&&<div className="planner-meal-details">
                    <span>{record.working.version.totalMinutes===null?'Time not set':`${record.working.version.totalMinutes} min`}</span>
                    {record.working.version.servings!==null&&<label>
                      Servings
                      <input type="number" min={0.1} max={100} step={0.5}
                        aria-label={`Servings for ${longDay(day)} ${slotLabel(slot)}`}
                        value={assigned?.servings??''}
                        placeholder={String(record.working.version.servings)}
                        onChange={event=>updateServings(day,slot,record.resourceId,event.target.value)}/>
                    </label>}
                  </div>}
                </div>;
              })}
            </div>
          </article>;
        })}
      </div>
      <aside className="planner-shopping" ref={shoppingRef} tabIndex={-1} aria-labelledby="planner-shopping-title">
        <div className="planner-shopping-heading">
          <div className="planner-shopping-icon"><ShoppingBasket size={22}/></div>
          <div><p className="eyebrow">For this week</p><h2 id="planner-shopping-title">Shopping list</h2></div>
          <button type="button" className="planner-copy" disabled={rows.length+manual.length===0}
            onClick={()=>void copy()} title="Copy shopping list"><ClipboardCopy size={18}/><span>{copied?'Copied':'Copy'}</span></button>
        </div>
        <p className="planner-shopping-summary">
          {shoppingCount} items left to check. Ingredients are grouped only when units and quantities are compatible.
        </p>
        {pantry.ingredients.length>0&&<label className="planner-pantry-switch">
          <input type="checkbox" checked={showNeededOnly} onChange={e=>setShowNeededOnly(e.target.checked)}/>
          Hide ingredients marked as available in my pantry
        </label>}
        {rows.length===0&&manual.length===0&&<div className="planner-shopping-empty">
          <ShoppingBasket size={27}/>
          <p>Assign a few meals to see what to buy, or add another grocery item below.</p>
        </div>}
        <div className="planner-shopping-lines" aria-label="Ingredients for planned recipes">
          {visibleRows.map(row=><label key={row.key} className={row.checked?'planner-shopping-item is-checked':'planner-shopping-item'}>
            <input type="checkbox" checked={row.checked}
              onChange={()=>change(current=>togglePurchased(current,week,row.key))}/>
            <span className="planner-shopping-checkbox"><Check size={13}/></span>
            <span className="planner-shopping-item-body">
              <strong>{row.name}</strong>
              <small>{amountLabel(row)}</small>
              {row.available&&<small className="planner-have">In pantry — quantity not verified</small>}
              {row.note&&<small className="planner-hint">{row.note}</small>}
            </span>
          </label>)}
          {manual.map(item=><div className="planner-manual-item" key={item.id}>
            <label className={item.checked?'planner-shopping-item is-checked':'planner-shopping-item'}>
              <input type="checkbox" checked={item.checked}
                onChange={()=>change(current=>toggleManualItem(current,item.id))}/>
              <span className="planner-shopping-checkbox"><Check size={13}/></span>
              <strong>{item.name}</strong>
            </label>
            <button type="button" aria-label={`Remove ${item.name}`}
              onClick={()=>change(current=>removeManualItem(current,item.id))}><Trash2 size={16}/></button>
          </div>)}
        </div>
        <form className="planner-manual-entry" onSubmit={event=>{event.preventDefault();addOther();}}>
          <label htmlFor="planner-manual-text">Other groceries</label>
          <div>
            <input id="planner-manual-text" maxLength={160} value={manualText}
              onChange={event=>setManualText(event.target.value)} placeholder="Milk, tea, soap…"/>
            <button type="submit" disabled={!manualText.trim()} aria-label="Add shopping item"><Plus size={19}/></button>
          </div>
        </form>
        <p className="planner-shop-note">This is an ingredient checklist, not an inventory calculation. Confirm quantities you already own. Saved privately on this device.</p>
      </aside>
    </div>
  </section>;
}
