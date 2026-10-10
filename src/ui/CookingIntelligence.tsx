import { useState } from 'react';
import { ArrowRight, Compass, Lightbulb, LockKeyhole, SlidersHorizontal, X } from 'lucide-react';
import type { LocalRecipeRecord } from '../data/local-db.ts';
import type { PantryDocument } from '../library/ingredients.ts';
import { addHiddenIngredient, DEFAULT_COOKING_PREFERENCES, suggestCookingIdeas, type CookingPreferences } from '../intelligence/suggestions.ts';

interface Props {
 accountId:string;records:readonly LocalRecipeRecord[];pantry:PantryDocument;
 preferences:CookingPreferences;onChange:(p:CookingPreferences)=>void;
 onOpen:(r:LocalRecipeRecord)=>void;onPlan:()=>void;
}
export function CookingIntelligence({accountId,records,pantry,preferences,onChange,onOpen,onPlan}:Props){
 const [ingredientText,setIngredientText]=useState('');
 const [error,setError]=useState('');
 const ideas=suggestCookingIdeas(records,pantry,preferences,accountId);
 const byId=new Map(records.map(r=>[r.resourceId,r]));
 const add=(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  try{onChange(addHiddenIngredient(preferences,ingredientText));setIngredientText('');setError('');}
  catch(e){setError(e instanceof Error?e.message:'Invalid ingredient name');}
 };
 return <section className="cooking-intelligence" aria-labelledby="cooking-ideas-heading">
   <div className="cooking-ideas-heading">
     <div><p className="eyebrow"><Compass size={15}/> Personal · on device</p>
       <h2 id="cooking-ideas-heading">What could I cook?</h2>
       <p>Transparent ideas from your own saved recipes. No AI calls or data upload.</p>
     </div>
     <label className="cooking-ideas-toggle">
       <input type="checkbox" checked={preferences.enabled} onChange={e=>onChange({...preferences,enabled:e.target.checked})}/>
       <span>{preferences.enabled?'Suggestions on':'Enable suggestions'}</span>
     </label>
   </div>
   {!preferences.enabled?
     <div className="cooking-ideas-locked"><LockKeyhole size={19}/><p>Off by default. Enable for local, explainable suggestions.</p></div>:
     <>
       <div className="cooking-ideas-settings" aria-label="Suggestion preferences">
         <label>Maximum recorded time
           <select aria-label="Maximum cooking time" value={preferences.maxMinutes??'any'}
             onChange={e=>onChange({...preferences,maxMinutes:e.target.value==='any'?null:Number(e.target.value) as 15|30|45|60})}>
             <option value="any">Any (including unknown)</option><option value="15">15 minutes</option>
             <option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option>
           </select>
         </label>
         <label className="cooking-ideas-favorites">
           <input type="checkbox" checked={preferences.preferFavorites} onChange={e=>onChange({...preferences,preferFavorites:e.target.checked})}/>
           Prefer saved favorites
         </label>
         <form className="cooking-ideas-hidden-form" onSubmit={add}>
           <label htmlFor="p19-hide-ingredient"><SlidersHorizontal size={16}/> Hide named ingredients</label>
           <div><input id="p19-hide-ingredient" maxLength={100} autoComplete="off" value={ingredientText}
              placeholder="e.g. mushrooms" onChange={e=>{setIngredientText(e.target.value);setError('');}}/>
             <button type="submit" disabled={!ingredientText.trim()}>Hide</button></div>
         </form>
       </div>
       {error&&<p role="alert" className="cooking-ideas-error">{error}</p>}
       {preferences.hiddenIngredients.length>0&&<div className="cooking-ideas-hidden" aria-label="Hidden ingredient names">
         {preferences.hiddenIngredients.map(name=><button type="button" key={name}
           aria-label={'Remove hidden ingredient '+name} onClick={()=>onChange({...preferences,hiddenIngredients:preferences.hiddenIngredients.filter(x=>x!==name)})}>
           {name}<X size={13}/></button>)}
         <button type="button" onClick={()=>onChange({...preferences,hiddenIngredients:[]})}>Clear hidden names</button>
       </div>}
       <p className="cooking-ideas-disclaimer">Not an allergy or food-safety filter: hidden names cannot detect derivatives, cross-contact or incorrect ingredient lists. Pantry checks match ingredient types, not quantities. Always review the recipe.</p>
       {ideas.length===0?
         <div className="cooking-ideas-empty" role="status">
           <p>No saved recipes meet these filters. You can reset the preferences.</p>
           <button type="button" onClick={()=>onChange({...DEFAULT_COOKING_PREFERENCES,enabled:true})}>Reset suggestion filters</button>
         </div>:
         <div className="cooking-ideas-list">
           {ideas.map((idea,index)=><article className="cooking-idea" key={idea.recipeId}>
             <span className="cooking-idea-number" aria-hidden="true">{index+1}</span>
             <div className="cooking-idea-main">
               <h3>{idea.title}</h3>
               <ul>{idea.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
               {idea.missing.length>0&&<p className="cooking-idea-missing">Not listed in pantry: {idea.missing.join(', ')}</p>}
               {idea.substitutions.map(note=><p key={note} className="cooking-idea-option"><Lightbulb size={16}/>{note}</p>)}
             </div>
             <button type="button" aria-label={'Review '+idea.title}
               onClick={()=>{const r=byId.get(idea.recipeId);if(r)onOpen(r);}}>
               Review recipe <ArrowRight size={16}/>
             </button>
           </article>)}
         </div>}
       <div className="cooking-ideas-plan">
         <p><strong>Meal ideas are not scheduled meals.</strong> Your plan changes only when you choose a recipe yourself.</p>
         <button type="button" onClick={onPlan}>Open meal planner <ArrowRight size={16}/></button>
       </div>
     </>}
 </section>;
}
