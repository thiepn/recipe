import { useEffect,useMemo,useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Clock3, Plus, Trash2 } from 'lucide-react';
import type { RecipeEditableDocument } from '../api/protocol.ts';
import type { LocalRecipeRecord } from '../data/local-db.ts';
import {
  finalizeRecipeEdits,moveRow,newIngredient,newStep,
  type IngredientRow,type StepRow,
} from '../library/editor.ts';

type TagCategory='cuisineTags'|'categoryTags'|'dietaryTags';

interface Props {
  record:LocalRecipeRecord;
  onClose:()=>void;
  onSave:(document:RecipeEditableDocument)=>Promise<void>;
}

export function RecipeStudio({record,onClose,onSave}:Props) {
  const [document,setDocument]=useState<RecipeEditableDocument>(record.working);
  const [tags,setTags]=useState<Record<TagCategory,string>>({
    cuisineTags:record.working.version.cuisineTags.join(', '),
    categoryTags:record.working.version.categoryTags.join(', '),
    dietaryTags:record.working.version.dietaryTags.join(', '),
  });
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const original=record.working;
  const hasChanges=useMemo(()=>
    JSON.stringify(document)!==JSON.stringify(original) ||
    (Object.keys(tags) as TagCategory[]).some(key=>tags[key]!==original.version[key].join(', ')),
    [document,original,tags]);
  const conflict=record.syncState==='conflict';

  const close=()=>{
    if(saving)return;
    if(hasChanges && !globalThis.confirm('Discard your unsaved recipe changes?'))return;
    onClose();
  };
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();close();}
    };
    globalThis.addEventListener('keydown',onKey);
    return ()=>globalThis.removeEventListener('keydown',onKey);
  });
  useEffect(()=>{
    // Route changes or reloads should not silently destroy unsaved work.
    const warn=(event:BeforeUnloadEvent)=>{
      if(!hasChanges)return;
      event.preventDefault();
      event.returnValue='';
    };
    globalThis.addEventListener('beforeunload',warn);
    return ()=>globalThis.removeEventListener('beforeunload',warn);
  },[hasChanges]);

  function updateVersion<K extends keyof RecipeEditableDocument['version']>(
    key:K,value:RecipeEditableDocument['version'][K],
  ){
    setDocument(doc=>({...doc,version:{...doc.version,[key]:value}}));
  }
  const updateIngredient=(id:string,edit:(row:IngredientRow)=>IngredientRow)=>{
    setDocument(doc=>({...doc,ingredients:doc.ingredients.map(item=>item.id===id?edit(item):item)}));
  };
  const updateStep=(id:string,edit:(row:StepRow)=>StepRow)=>{
    setDocument(doc=>({...doc,steps:doc.steps.map(item=>item.id===id?edit(item):item)}));
  };
  const changeDuration=(raw:string):number|null=>raw.trim()===''?null:Number(raw);
  const moveIngredient=(index:number,direction:-1|1)=>
    setDocument(doc=>({...doc,ingredients:moveRow(doc.ingredients,index,direction)}));
  const moveStep=(index:number,direction:-1|1)=>
    setDocument(doc=>({...doc,steps:moveRow(doc.steps,index,direction)}));

  const submit=async()=>{
    if(saving||conflict||!hasChanges)return;
    setSaving(true);setError('');
    try{
      const cleaned=finalizeRecipeEdits(document,tags);
      await onSave(cleaned);
      onClose();
    }catch(err){
      setError(err instanceof Error?err.message:'Could not save this recipe.');
    }finally{setSaving(false);}
  };
  const field=(id:string,title:string)=>({id,title});
  const items=document.ingredients;
  const steps=document.steps;
  return <div className="recipe-studio" role="dialog" aria-modal="true" aria-labelledby="studio-title">
    <header className="studio-topbar">
      <button className="studio-back" type="button" onClick={close} disabled={saving}>
        <ArrowLeft size={19}/> <span>Back to recipe</span>
      </button>
      <div className="studio-brand">RECIPE <span>/</span> EDIT</div>
      <button className="button button-primary studio-save" type="button" disabled={!hasChanges||saving||conflict}
        onClick={()=>void submit()}><Check size={17}/>{saving?'Saving…':'Save changes'}</button>
    </header>
    <main className="studio-main">
      <header className="studio-intro">
        <p className="eyebrow">Your cookbook / Recipe studio</p>
        <h1 id="studio-title">Make this recipe yours.</h1>
        <p>Adjust the original or imported recipe. Changes are saved privately and synced to your cookbook.</p>
      </header>
      <nav className="studio-outline" aria-label="Jump to editor section">
        <a href="#studio-section-recipe">Recipe</a>
        <a href="#studio-section-ingredients">Ingredients <span>{items.length}</span></a>
        <a href="#studio-section-method">Method <span>{steps.length}</span></a>
        <a href="#studio-section-organize">Organize</a>
        <a href="#studio-section-notes">Notes</a>
      </nav>
      {conflict && <p className="studio-alert" role="alert">
        This recipe has a sync conflict. Resolve the conflict before editing to avoid overwriting another version.
      </p>}
      {error && <p className="studio-alert" role="alert">{error}</p>}
      <div className="studio-layout">
        <div className="studio-main-fields">
          <section className="studio-panel" id="studio-section-recipe" tabIndex={-1}>
            <div className="studio-section-title"><span>01</span><div><h2>The recipe</h2><p>The details readers see first.</p></div></div>
            <label className="studio-field">Name
              <input autoFocus maxLength={240} value={document.version.title}
                onChange={e=>updateVersion('title',e.target.value)}
                placeholder="Your recipe name"/>
            </label>
            <label className="studio-field">Short description
              <textarea rows={3} maxLength={20_000} value={document.version.description??''}
                onChange={e=>updateVersion('description',e.target.value||null)}
                placeholder="What makes this recipe special?"/>
            </label>
            <div className="studio-fields-grid">
              <label className="studio-field">Servings
                <input type="number" min="0.1" step="0.5" value={document.version.servings??''}
                  onChange={e=>updateVersion('servings',changeDuration(e.target.value))}/>
              </label>
              <label className="studio-field">Total time (minutes)
                <input type="number" min="0" step="1" value={document.version.totalMinutes??''}
                  onChange={e=>updateVersion('totalMinutes',changeDuration(e.target.value))}/>
              </label>
              <label className="studio-field">Prep time (minutes)
                <input type="number" min="0" step="1" value={document.version.prepMinutes??''}
                  onChange={e=>updateVersion('prepMinutes',changeDuration(e.target.value))}/>
              </label>
              <label className="studio-field">Difficulty
                <select value={document.version.difficulty}
                  onChange={e=>updateVersion('difficulty',e.target.value as RecipeEditableDocument['version']['difficulty'])}>
                  <option value="unknown">Not specified</option><option value="easy">Easy</option>
                  <option value="medium">Medium</option><option value="hard">Hard</option>
                </select>
              </label>
            </div>
          </section>

          <section className="studio-panel" id="studio-section-ingredients" tabIndex={-1}>
            <div className="studio-section-title"><span>02</span><div><h2>Ingredients</h2><p>Use separate quantity, unit and name fields for accurate editing.</p></div></div>
            <div className="studio-row-list">
              {items.map((row,index)=>{
                const group=document.ingredientGroups.find(group=>group.id===row.groupId);
                return <div className="studio-ingredient-row" key={row.id}>
                  <span className="studio-row-index">{String(index+1).padStart(2,'0')}</span>
                  <div className="studio-ingredient-inputs">
                    {group&&<span className="studio-group-label">{group.name}</span>}
                    <div className="studio-ingredient-grid">
                      <label className="studio-field"><span>Amount</span><input type="number" min="0" step="any"
                        aria-label={`Ingredient ${index+1} amount`}
                        value={row.quantity??''} onChange={e=>updateIngredient(row.id,item=>({
                          ...item,quantity:changeDuration(e.target.value),
                          quantityMax:item.quantityMax!==null&&Number(e.target.value)>item.quantityMax?null:item.quantityMax,
                        }))}/></label>
                      <label className="studio-field"><span>Unit</span><input maxLength={80}
                        aria-label={`Ingredient ${index+1} unit`}
                        value={row.unit??''} placeholder="g, ml, tbsp"
                        onChange={e=>updateIngredient(row.id,item=>({...item,unit:e.target.value||null}))}/></label>
                      <label className="studio-field"><span>Ingredient</span><input maxLength={240}
                        aria-label={`Ingredient ${index+1} name`}
                        value={row.name} placeholder="e.g. tomato"
                        onChange={e=>updateIngredient(row.id,item=>({...item,name:e.target.value}))}/></label>
                    </div>
                    <div className="studio-row-extras">
                      <label className="studio-check"><input type="checkbox" checked={row.optional}
                        onChange={e=>updateIngredient(row.id,item=>({...item,optional:e.target.checked}))}/>Optional</label>
                      <label className="studio-inline-field">Preparation <input value={row.preparation??''}
                        maxLength={500} placeholder="chopped, softened…"
                        onChange={e=>updateIngredient(row.id,item=>({...item,preparation:e.target.value||null}))}/></label>
                    </div>
                  </div>
                  <div className="studio-row-actions">
                    <button type="button" className="icon-button" aria-label={`Move ingredient ${index+1} up`}
                      disabled={index===0} onClick={()=>moveIngredient(index,-1)}><ArrowUp size={16}/></button>
                    <button type="button" className="icon-button" aria-label={`Move ingredient ${index+1} down`}
                      disabled={index===items.length-1} onClick={()=>moveIngredient(index,1)}><ArrowDown size={16}/></button>
                    <button type="button" className="icon-button studio-delete" aria-label={`Remove ingredient ${index+1}`}
                      onClick={()=>setDocument(doc=>({...doc,ingredients:doc.ingredients.filter(item=>item.id!==row.id)}))}><Trash2 size={16}/></button>
                  </div>
                </div>;
              })}
            </div>
            <button className="studio-add" type="button" disabled={items.length>=500} onClick={()=>
              setDocument(doc=>({...doc,ingredients:[...doc.ingredients,newIngredient(doc.version.id,crypto.randomUUID(),doc.ingredients.length)]}))}>
              <Plus size={17}/> Add ingredient
            </button>
          </section>

          <section className="studio-panel" id="studio-section-method" tabIndex={-1}>
            <div className="studio-section-title"><span>03</span><div><h2>Method</h2><p>Arrange instructions in the order you actually cook.</p></div></div>
            <div className="studio-row-list">
              {steps.map((row,index)=><div className="studio-step-row" key={row.id}>
                <span className="studio-step-index">{String(index+1).padStart(2,'0')}</span>
                <div className="studio-step-fields">
                  <label className="studio-field">Step title (optional)
                    <input value={row.title??''} maxLength={240} placeholder="Prepare the vegetables"
                      onChange={e=>updateStep(row.id,item=>({...item,title:e.target.value||null}))}/>
                  </label>
                  <label className="studio-field">Instructions
                    <textarea rows={3} maxLength={20_000} value={row.instruction} placeholder="Describe what to do…"
                      onChange={e=>updateStep(row.id,item=>({...item,instruction:e.target.value}))}/>
                  </label>
                  <label className="studio-field studio-duration"><Clock3 size={14}/> Timer suggestion (minutes)
                    <input type="number" min="0" step="1" value={row.durationSecondsMin===null?'':row.durationSecondsMin/60}
                      onChange={e=>updateStep(row.id,item=>({...item,
                        durationSecondsMin:e.target.value===''?null:Math.round(Number(e.target.value)*60),
                        durationSecondsMax:null,
                      }))}/>
                  </label>
                </div>
                <div className="studio-row-actions">
                  <button type="button" className="icon-button" aria-label={`Move step ${index+1} up`}
                    disabled={index===0} onClick={()=>moveStep(index,-1)}><ArrowUp size={16}/></button>
                  <button type="button" className="icon-button" aria-label={`Move step ${index+1} down`}
                    disabled={index===steps.length-1} onClick={()=>moveStep(index,1)}><ArrowDown size={16}/></button>
                  <button type="button" className="icon-button studio-delete" aria-label={`Remove step ${index+1}`}
                    onClick={()=>setDocument(doc=>({...doc,steps:doc.steps.filter(item=>item.id!==row.id)}))}><Trash2 size={16}/></button>
                </div>
              </div>)}
            </div>
            <button className="studio-add" type="button" disabled={steps.length>=300} onClick={()=>
              setDocument(doc=>({...doc,steps:[...doc.steps,newStep(doc.version.id,crypto.randomUUID(),doc.steps.length)]}))}>
              <Plus size={17}/> Add step
            </button>
          </section>
        </div>

        <aside className="studio-side-fields">
          <section className="studio-panel" id="studio-section-organize" tabIndex={-1}>
            <div className="studio-section-title"><span>04</span><div><h2>Find & organize</h2><p>Make recipes easier to discover.</p></div></div>
            <label className="studio-field">Cuisine tags
              <input value={tags.cuisineTags} maxLength={900} placeholder="Korean, home cooking"
                onChange={e=>setTags(current=>({...current,cuisineTags:e.target.value}))}/>
            </label>
            <label className="studio-field">Category tags
              <input value={tags.categoryTags} maxLength={900} placeholder="Dinner, quick"
                onChange={e=>setTags(current=>({...current,categoryTags:e.target.value}))}/>
            </label>
            <label className="studio-field">Dietary tags
              <input value={tags.dietaryTags} maxLength={900} placeholder="Vegetarian"
                onChange={e=>setTags(current=>({...current,dietaryTags:e.target.value}))}/>
            </label>
            <small>Separate tags with commas. They help search your cookbook.</small>
          </section>
          <section className="studio-panel" id="studio-section-notes" tabIndex={-1}>
            <div className="studio-section-title"><span>05</span><div><h2>Kitchen notes</h2><p>Remember the details that matter.</p></div></div>
            <label className="studio-field">Personal notes
              <textarea rows={7} maxLength={20_000} value={document.version.authorNote??''}
                onChange={e=>updateVersion('authorNote',e.target.value||null)}
                placeholder="Changes for next time, family preferences, substitutions…"/>
            </label>
            {Object.keys(document.version.metadata).length>0&&
              <p className="studio-provenance">Import and source metadata remain attached to this recipe when you save edits.</p>}
          </section>
          <p className="studio-autosave-note">Edits stay on this screen until you save. Saving writes to the local cookbook first, then synchronizes through your Account.</p>
        </aside>
      </div>
      <footer className="studio-footer">
        <span>{hasChanges?'Unsaved changes':'No changes to save'}</span>
        <button type="button" className="button button-secondary" disabled={saving} onClick={close}>Cancel</button>
        <button className="button button-primary" type="button" disabled={!hasChanges||saving||conflict}
          onClick={()=>void submit()}>{saving?'Saving…':'Save recipe'}</button>
      </footer>
    </main>
  </div>;
}
