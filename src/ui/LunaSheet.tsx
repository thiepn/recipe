import { useEffect,useState } from 'react';
import { Sparkles, X, ShieldCheck } from 'lucide-react';
import type { LunaDraft, LunaHelp } from '../ai/contracts.ts';
import type { ImportDraft } from '../import/recipe-import.ts';

type SuggestionMode='generate'|'help';
type SaveResult='saved'|'duplicate';
interface Props {
 open:boolean;
 mode:SuggestionMode;
 title?:string|undefined;
 onClose:()=>void;
 onGenerate:(request:string,avoid:string[],servings:number)=>Promise<LunaDraft>;
 onHelp:(question:string)=>Promise<LunaHelp>;
 onSave:(draft:ImportDraft,allowDuplicate:boolean)=>Promise<SaveResult>;
 pantry:string[];
}

export function LunaSheet(props:Props) {
 const {open,mode,onClose,onGenerate,onHelp,onSave,pantry}=props;
 const [prompt,setPrompt]=useState('');
 const [avoidText,setAvoidText]=useState('');
 const [servings,setServings]=useState(2);
 const [draft,setDraft]=useState<LunaDraft|null>(null);
 const [ingredientsText,setIngredientsText]=useState('');
 const [stepsText,setStepsText]=useState('');
 const [help,setHelp]=useState<LunaHelp|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [duplicate,setDuplicate]=useState(false);
 useEffect(()=>{
  if(!open){
   setPrompt('');setAvoidText('');setServings(2);setDraft(null);setHelp(null);
   setIngredientsText('');setStepsText('');setBusy(false);setError('');setDuplicate(false);
  }
 },[open]);
 if(!open)return null;
 const generate=async()=>{
  if(busy||prompt.trim().length<3)return;
  setBusy(true);setError('');setDraft(null);setHelp(null);setDuplicate(false);
  try{
   if(mode==='generate'){
    const output=await onGenerate(
     prompt.trim(),
     avoidText.split(/[,;\n]/).map(v=>v.trim()).filter(Boolean).slice(0,20),
     servings,
    );
    setDraft(output);setIngredientsText(output.ingredients.join('\n'));
    setStepsText(output.steps.join('\n'));
   }else setHelp(await onHelp(prompt.trim()));
  }catch(err){
   setError(err instanceof Error?err.message:'Luna is unavailable. The cookbook and manual importing still work.');
  }finally{setBusy(false);}
 };
 const save=async()=>{
  if(!draft||busy)return;
  setBusy(true);setError('');
  const source=[draft.title,draft.description,...draft.ingredients,...draft.steps].join('\n');
  const recipe:ImportDraft={
   kind:'text',method:'text',title:draft.title,description:draft.description,
   ingredients:ingredientsText.split('\n').map(x=>x.trim()).filter(Boolean),
   steps:stepsText.split('\n').map(x=>x.trim()).filter(Boolean),
   servings:draft.servings,totalMinutes:draft.totalMinutes,sourceUrl:null,sourceName:null,
   originalText:source,
   warnings:[
    'This recipe was suggested by Luna and must be reviewed before cooking.',
    ...draft.uncertainties,
    ...draft.notes,
   ],
  };
  try{
   const result=await onSave(recipe,duplicate);
   if(result==='duplicate'){setDuplicate(true);setError('A similar recipe exists. Check before saving another copy.');}
   else onClose();
  }catch(err){setError(err instanceof Error?err.message:'Could not save the draft.');}
  finally{setBusy(false);}
 };
 return <div className="modal-layer" role="presentation" onMouseDown={()=>{if(!busy)onClose();}}>
  <section className="sheet luna-sheet" role="dialog" aria-modal="true" aria-labelledby="luna-title"
   onMouseDown={event=>event.stopPropagation()}>
   <header className="sheet-header">
    <div><p className="eyebrow">Optional cooking assistance</p><h2 id="luna-title">{mode==='generate'?'Create with Luna':'Ask about this recipe'}</h2></div>
    <button className="icon-button" type="button" aria-label="Close Luna" disabled={busy} onClick={onClose}><X size={20}/></button>
   </header>
   <p className="luna-notice"><ShieldCheck size={16}/> Luna drafts suggestions only. Nothing is saved without your review.</p>
   {mode==='help' && props.title && <p className="luna-context">About: <strong>{props.title}</strong></p>}
   {mode==='generate'&&pantry.length>0&&<p className="luna-context">Using your selected pantry: {pantry.slice(0,30).join(', ')}. Other ingredients may be suggested.</p>}
   <label className="luna-field" htmlFor="luna-prompt">{mode==='generate'?'What would you like to cook?':'Your cooking question'}</label>
   <textarea id="luna-prompt" value={prompt} maxLength={mode==='generate'?600:900}
    rows={3} onChange={event=>setPrompt(event.target.value)}
    placeholder={mode==='generate'?'A quick Korean rice dinner with vegetables…':'Can I prepare this ahead of time?'} />
   {mode==='generate'&&<div className="luna-constraints">
    <label className="luna-field">Avoid these ingredients (optional)
     <input value={avoidText} maxLength={1200} onChange={event=>setAvoidText(event.target.value)}
      placeholder="Peanuts, shellfish…" />
    </label>
    <label className="luna-field">Servings
     <input type="number" min={1} max={12} value={servings} onChange={event=>setServings(Number(event.target.value))}/>
    </label>
   </div>}
   <button className="button button-primary luna-action" type="button" disabled={busy||prompt.trim().length<3||servings<1||servings>12}
    onClick={()=>void generate()}><Sparkles size={17}/> {busy?'Working…':mode==='generate'?'Suggest a recipe':'Ask Luna'}</button>
   {help&&<div className="luna-answer" aria-live="polite">
    <h3>Suggestion</h3><p>{help.answer}</p>
    {help.cautions.length>0&&<section><h4>Important notes</h4><ul>{help.cautions.map((v,i)=><li key={i}>{v}</li>)}</ul></section>}
    {help.suggestedChanges.length>0&&<section><h4>Optional adjustments</h4><ul>{help.suggestedChanges.map((v,i)=><li key={i}>{v}</li>)}</ul></section>}
   </div>}
   {draft&&<div className="luna-draft" aria-live="polite">
    <h3>Review your draft</h3>
    <label className="luna-field">Recipe name<input maxLength={240} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
    <label className="luna-field">Description<input maxLength={1200} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
    <div className="luna-draft-grid">
     <label className="luna-field">Ingredients (one per line)
      <textarea rows={9} value={ingredientsText} onChange={e=>{setIngredientsText(e.target.value);setDuplicate(false);}}/>
     </label>
     <label className="luna-field">Steps (one per line)
      <textarea rows={9} value={stepsText} onChange={e=>{setStepsText(e.target.value);setDuplicate(false);}}/>
     </label>
    </div>
    {[...draft.uncertainties,...draft.notes].length>0&&<div className="luna-cautions">
      {[...draft.uncertainties,...draft.notes].map((v,i)=><p key={i}>{v}</p>)}
    </div>}
    <button type="button" className="button button-primary full-width" disabled={busy||!draft.title.trim()||!ingredientsText.trim()||!stepsText.trim()} onClick={()=>void save()}>
      {busy?'Saving…':duplicate?'Save duplicate anyway':'Save as private draft'}
    </button>
   </div>}
   {error&&<p role="alert" className="import-error">{error}</p>}
   <p className="luna-footnote">Optional AI processing sends only the fields above and selected recipe context to THIEPN AI. Never your whole cookbook or Account token.</p>
  </section>
 </div>;
}
