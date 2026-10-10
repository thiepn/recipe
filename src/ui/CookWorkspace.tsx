import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, ChefHat, Clock3,
  Pause, Play, RotateCcw, TimerReset, Utensils, X,
} from 'lucide-react';
import type { LocalRecipeRecord, RecipeLocalDb } from '../data/local-db.ts';
import { boundedServings, digitalTimer, kitchenIngredientText, stepProgress } from '../kitchen/model.ts';
import { KitchenHandsFree } from './KitchenHandsFree.tsx';
import {
  KitchenSessionStore, kitchenSessionStoreFor, createKitchenSession, dismissKitchenTimer, pauseKitchenTimer,
  remainingTimerSeconds, restoreKitchenSession, resumeKitchenTimer,
  startKitchenTimer, timerState, updateKitchenSession, type KitchenSession,
} from '../kitchen/session.ts';

interface Props {
  records:LocalRecipeRecord[];
  selectedId:string|null;
  onChoose:(id:string)=>void;
  onExit:()=>void;
  onEdit:(record:LocalRecipeRecord)=>void;
  db:RecipeLocalDb;
  accountId:string;
}

export function CookWorkspace({records,selectedId,onChoose,onExit,onEdit,db,accountId}:Props) {
  const store=useMemo(()=>kitchenSessionStoreFor(db,accountId),[db,accountId]);
  const [savedSessions,setSavedSessions]=useState<KitchenSession[]>([]);
  const [loadingSessions,setLoadingSessions]=useState(true);
  const [storageError,setStorageError]=useState('');
  useEffect(()=>{
    if(selectedId!==null)return;
    let cancelled=false;
    const refresh=()=>{
      setLoadingSessions(true);
      void store.list(records)
        .then(sessions=>{if(!cancelled){setSavedSessions(sessions);setStorageError('');}})
        .catch(()=>{if(!cancelled)setStorageError('Saved cooking sessions could not be loaded on this device.');})
        .finally(()=>{if(!cancelled)setLoadingSessions(false);});
    };
    refresh();
    globalThis.addEventListener('recipe:workspace-changed',refresh);
    return ()=>{
      cancelled=true;
      globalThis.removeEventListener('recipe:workspace-changed',refresh);
    };
  },[store,records,selectedId]);
  const selected=records.find(r=>r.resourceId===selectedId);
  if(selected)return <CookSession key={selected.resourceId} record={selected} store={store} onExit={onExit}/>;
  const eligible=records.filter(r=>r.working.steps.length>0);
  const sessionsByRecipe=new Map(savedSessions.map(session=>[session.recipeId,session]));
  return <section className="kitchen-library" aria-labelledby="cook-page-title">
    <div className="kitchen-intro">
      <p className="eyebrow">In the kitchen</p>
      <div className="kitchen-intro-line">
        <h1 id="cook-page-title">Cook</h1>
        <span>{eligible.length} ready to make</span>
      </div>
      <p>Choose a recipe to cook or resume where you stopped. Your steps and timers are saved on this device.</p>
      {storageError&&<p role="alert" className="kitchen-storage-error">{storageError}</p>}
      {loadingSessions&&<span className="kitchen-loading">Finding your saved cooking sessions…</span>}
    </div>
    {eligible.length===0?
      <div className="kitchen-empty">
        <Utensils size={36} strokeWidth={1.4}/>
        <h2>Nothing ready to cook yet.</h2>
        <p>Add ingredients and steps to a saved recipe, then return here to cook it.</p>
        {records.length>0&&<div className="kitchen-repair-list">
          {records.slice(0,8).map(record=>
            <button key={record.resourceId} type="button" onClick={()=>onEdit(record)}>
              Edit {record.working.version.title} <ArrowRight size={16}/>
            </button>)}
        </div>}
      </div>:
      <div className="kitchen-choice-grid">
        {eligible.map(record=>{
          const doc=record.working;
          const saved=sessionsByRecipe.get(record.resourceId);
          const done=saved?stepProgress(new Set(saved.completedStepIds),doc.steps):0;
          return <button className="kitchen-choice" key={record.resourceId} type="button" onClick={()=>onChoose(record.resourceId)}>
            <div className="kitchen-choice-image"><ChefHat size={36} strokeWidth={1.2}/></div>
            <div className="kitchen-choice-meta">
              <p>{doc.version.totalMinutes ? `${doc.version.totalMinutes} min` : 'No time set'} · {doc.steps.length} steps</p>
              {saved&&<span className="kitchen-resume-badge">Saved session · {done}% complete · {saved.timers.length} timers</span>}
              <h2>{doc.version.title}</h2>
              {doc.version.description&&<span>{doc.version.description}</span>}
              <strong>{saved?'Resume cooking':'Start cooking'} <ArrowRight size={17}/></strong>
            </div>
          </button>;
        })}
      </div>}
  </section>;
}

function CookSession({record,onExit,store}: {
  record:LocalRecipeRecord;onExit:()=>void;store:KitchenSessionStore;
}) {
  const doc=record.working;
  const ingredients=useMemo(()=>[...doc.ingredients].sort((a,b)=>a.position-b.position),[doc.ingredients]);
  const steps=useMemo(()=>[...doc.steps].sort((a,b)=>a.position-b.position),[doc.steps]);
  const [session,setSession]=useState<KitchenSession|null>(null);
  const sessionRef=useRef<KitchenSession|null>(null);
  const [storageError,setStorageError]=useState('');
  const [loading,setLoading]=useState(true);
  const [manualMinutes,setManualMinutes]=useState(5);
  const [focusMode,setFocusMode]=useState(false);
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      try{
        const existing=await store.load(record);
        if(cancelled)return;
        const value=existing??createKitchenSession(doc);
        if(!existing)await store.save(value);
        if(cancelled)return;
        sessionRef.current=value;
        setSession(value);
      }catch{
        if(!cancelled)setStorageError('Cannot access the local cooking session. Check browser storage settings.');
      }finally{if(!cancelled)setLoading(false);}
    })();
    return ()=>{cancelled=true;};
  },[store,record.resourceId]);
  useEffect(()=>{
    let cancelled=false;
    const refresh=()=>void store.load(record).then(value=>{
      if(cancelled)return;
      // A remote tombstone resets the visible session without resurrecting it
      // in IndexedDB until the user deliberately makes a new cooking edit.
      const current=value??createKitchenSession(doc);
      sessionRef.current=current;
      setSession(current);
    }).catch(()=>setStorageError('Could not refresh this cooking session.'));
    globalThis.addEventListener('recipe:workspace-changed',refresh);
    return ()=>{cancelled=true;globalThis.removeEventListener('recipe:workspace-changed',refresh);};
  },[store,record.resourceId]);

  const change=useCallback((transform:(current:KitchenSession)=>KitchenSession)=>{
    const current=sessionRef.current;
    if(!current)return;
    const next=transform(current);
    sessionRef.current=next;
    setSession(next);
    void store.save(next).catch(()=>setStorageError('Could not save the cooking session. Avoid closing this tab before retrying.'));
  },[store]);
  useEffect(()=>{
    if(!session?.timers.some(timer=>timer.status==='running'))return;
    const tick=()=>setNow(Date.now());
    const interval=globalThis.setInterval(tick,500);
    globalThis.addEventListener('visibilitychange',tick);
    return ()=>{
      globalThis.clearInterval(interval);
      globalThis.removeEventListener('visibilitychange',tick);
    };
  },[session?.timers]);
  useEffect(()=>{
    if(!session?.timers.some(timer=>timer.status==='running'&&remainingTimerSeconds(timer,now)===0))return;
    change(current=>restoreKitchenSession(current,doc,Date.now())??current);
  },[now,session,change,doc]);
  if(loading)return <div className="kitchen-loading-session" role="status">Restoring your kitchen session…</div>;
  if(!session)return <div className="kitchen-loading-session">
    <p role="alert">{storageError||'Your cooking session could not be opened.'}</p>
    <button className="button button-secondary" type="button" onClick={onExit}>Back to Cook</button>
  </div>;
  const stepIndex=Math.max(0,steps.findIndex(step=>step.id===session.currentStepId));
  const step=steps[stepIndex];
  const checkedIngredients=new Set(session.checkedIngredientIds);
  const completedSteps=new Set(session.completedStepIds);
  const factor=boundedServings(session.servings,doc.version.servings);
  const progress=stepProgress(completedSteps,steps);
  const complete=steps.length>0&&progress===100;
  const timers=session.timers;
  const leave=()=>onExit();
  const toggleIngredient=(id:string)=>{
    change(current=>{
      const ids=new Set(current.checkedIngredientIds);
      if(ids.has(id))ids.delete(id);else ids.add(id);
      return updateKitchenSession(current,{checkedIngredientIds:[...ids]},Date.now());
    });
  };
  const chooseStep=(index:number)=>{
    const selected=steps[index];
    if(selected)change(current=>updateKitchenSession(current,{currentStepId:selected.id},Date.now()));
  };
  const markStep=()=>{
    if(!step)return;
    change(current=>{
      const completed=new Set(current.completedStepIds);
      completed.add(step.id);
      return updateKitchenSession(current,{
        completedStepIds:[...completed],
        currentStepId:steps[stepIndex+1]?.id??step.id,
      },Date.now());
    });
  };
  const startTimer=(seconds:number,label:string)=>{
    try{
      change(current=>startKitchenTimer(current,label,seconds,crypto.randomUUID(),Date.now()));
      setStorageError('');
    }catch(err){setStorageError(err instanceof Error?err.message:'Unable to start timer.');}
  };
  const finishAndClear=async()=>{
    if(timers.some(timer=>timerState(timer,Date.now())==='running')&&
      !globalThis.confirm('Discard all timers and clear this completed cooking session?'))return;
    try{await store.clear(record.resourceId);sessionRef.current=null;onExit();}
    catch{setStorageError('Could not clear the saved cooking session.');}
  };
  const restart=()=>{
    change(()=>createKitchenSession(doc));
    setManualMinutes(5);
  };
  return <section className={focusMode?'kitchen-session is-focus':'kitchen-session'} aria-labelledby="cooking-title">
    <header className="kitchen-session-header">
      <button className="kitchen-return" type="button" onClick={leave}>
        <ArrowLeft size={18}/> Save & leave
      </button>
      <div className="kitchen-session-title">
        <p className="eyebrow">Now cooking</p>
        <h1 id="cooking-title">{doc.version.title}</h1>
        <span>{doc.version.totalMinutes?`${doc.version.totalMinutes} min estimated`:'Follow the steps at your pace'}</span>
      </div>
      <div className="kitchen-session-utilities">
        <button type="button" className="kitchen-focus-toggle" aria-pressed={focusMode}
          aria-controls="kitchen-ingredients-panel" onClick={()=>setFocusMode(mode=>!mode)}>
          {focusMode?'Show ingredients':'Focus on steps'}
        </button>
        <div className="kitchen-progress-label">{progress}% done</div>
      </div>
      {storageError&&<p className="kitchen-storage-error" role="alert">{storageError}</p>}
    </header>
    <div className="kitchen-progress" role="progressbar" aria-label="Completed cooking steps" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
      <div style={{width:`${progress}%`}}/>
    </div>
    <div className="kitchen-layout">
      <aside className="kitchen-supply" id="kitchen-ingredients-panel" hidden={focusMode}>
        <div className="kitchen-supply-header">
          <h2>Ingredients</h2>
          <span>{checkedIngredients.size}/{ingredients.length}</span>
        </div>
        {doc.version.servings!==null?
          <div className="kitchen-servings">
            <label htmlFor="kitchen-servings-input">Servings</label>
            <div className="kitchen-serving-adjust">
              <button type="button" onClick={()=>change(current=>updateKitchenSession(current,{
                servings:Math.max(doc.version.servings!*0.25,+(current.servings-1).toFixed(2)),
              },Date.now()))}
                disabled={session.servings<=doc.version.servings*0.25} aria-label="Decrease servings">−</button>
              <input id="kitchen-servings-input" type="number" min={doc.version.servings*0.25}
                max={doc.version.servings*8} step={0.5} value={session.servings}
                onChange={e=>{
                  const v=Number(e.target.value);
                  if(Number.isFinite(v)&&v>0)change(current=>updateKitchenSession(current,{
                    servings:Math.max(doc.version.servings!*0.25,Math.min(doc.version.servings!*8,v)),
                  },Date.now()));
                }}/>
              <button type="button" onClick={()=>change(current=>updateKitchenSession(current,{
                servings:Math.min(doc.version.servings!*8,current.servings+1),
              },Date.now()))}
                disabled={session.servings>=doc.version.servings*8} aria-label="Increase servings">+</button>
            </div>
            <small>Only linearly scaling quantities are adjusted. Seasonings and fixed amounts remain unchanged.</small>
          </div>:
          <p className="kitchen-no-servings">Servings not specified. Original quantities shown.</p>}
        {ingredients.length===0?
          <p className="kitchen-no-servings">No ingredient list in this recipe.</p>:
          <div className="kitchen-checklist" aria-label="Cooking ingredient checklist">
            {ingredients.map(row=><label key={row.id} className={checkedIngredients.has(row.id)?'kitchen-check is-checked':'kitchen-check'}>
              <input type="checkbox" checked={checkedIngredients.has(row.id)} onChange={()=>toggleIngredient(row.id)}/>
              <span className="kitchen-checkbox"><Check size={14}/></span>
              <span>{kitchenIngredientText(row,factor)}</span>
            </label>)}
          </div>}
      </aside>
      <div className="kitchen-instructions">
        <KitchenHandsFree recipeId={record.resourceId} stepIndex={stepIndex}
          stepCount={steps.length} stepTitle={step?.title??null}
          stepInstruction={step?.instruction??''} timers={timers} now={now}
          onNext={()=>chooseStep(Math.min(stepIndex+1,steps.length-1))}
          onPrevious={()=>chooseStep(Math.max(0,stepIndex-1))}/>
        {complete?
          <div className="kitchen-finished">
            <CheckCircle2 size={65} strokeWidth={1.25}/>
            <p className="eyebrow">All steps completed</p>
            <h2>Ready to serve.</h2>
            <p>Check seasoning, temperature and doneness before serving. Timers don't verify food safety.</p>
            <button type="button" className="button button-primary" onClick={()=>void finishAndClear()}>Finish and clear session</button>
            <button type="button" className="button button-secondary" onClick={leave}>Save and leave</button>
            <button type="button" className="button button-secondary" onClick={restart}><RotateCcw size={16}/> Cook again</button>
          </div>:
          <>
            <div className="kitchen-step-heading">
              <span>STEP {stepIndex+1} / {steps.length}</span>
              <div className="kitchen-step-jump" aria-label="Jump to a step">
                {steps.map((s,i)=><button type="button" key={s.id}
                  className={i===stepIndex?'is-active':completedSteps.has(s.id)?'is-completed':''}
                  aria-label={`Go to step ${i+1}`} aria-current={i===stepIndex?'step':undefined}
                  onClick={()=>chooseStep(i)}>{completedSteps.has(s.id)?<Check size={13}/>:i+1}</button>)}
              </div>
            </div>
            <article className="kitchen-step-card">
              {step?.title&&<p className="kitchen-step-subtitle">{step.title}</p>}
              <p className="kitchen-step-text">{step?.instruction}</p>
              {step?.temperatureC!==null&&step?.temperatureC!==undefined&&
                <span className="kitchen-heat-tag">{step.temperatureC} °C</span>}
              {step?.visualCue&&<p className="kitchen-cue"><strong>Look for:</strong> {step.visualCue}</p>}
              {step?.donenessCue&&<p className="kitchen-cue"><strong>Done when:</strong> {step.donenessCue}</p>}
              {step?.durationSecondsMin!==null&&step?.durationSecondsMin!==undefined&&step.durationSecondsMin>0&&
                <button className="kitchen-timer-suggestion" type="button"
                  disabled={timers.length>=8}
                  onClick={()=>startTimer(step.durationSecondsMin!,`Step ${stepIndex+1}`)}>
                  <TimerReset size={17}/> Start suggested timer: {Math.ceil(step.durationSecondsMin/60)} min
                </button>}
            </article>
            <nav className="kitchen-step-navigation" aria-label="Cooking step controls">
              <button className="button button-secondary" type="button" disabled={stepIndex===0}
                onClick={()=>chooseStep(stepIndex-1)}><ArrowLeft size={17}/> Previous</button>
              <button className="button button-primary" type="button" onClick={markStep}>
                {stepIndex===steps.length-1?'Finish cooking':'Done, next step'} <ArrowRight size={17}/>
              </button>
            </nav>
          </>}
        <div className="kitchen-timer" aria-labelledby="kitchen-timer-title">
          <div className="kitchen-timer-title"><Clock3 size={18}/><h2 id="kitchen-timer-title">Kitchen timers</h2>
            <span className="kitchen-timer-count">{timers.length}/8</span>
          </div>
          {timers.length===0&&<p className="kitchen-timer-placeholder">Start a suggested step timer or add your own. Each timer runs independently.</p>}
          <div className="kitchen-timer-stack">
            {timers.map(timer=>{
              const status=timerState(timer,now);
              const remaining=remainingTimerSeconds(timer,now);
              return <div className={status==='finished'?'kitchen-active-timer is-due':'kitchen-active-timer'} key={timer.id}>
                <div className="kitchen-active-timer-details">
                  <strong>{timer.label}</strong>
                  <span role={status==='finished'?'status':undefined}>
                    {status==='finished'?'Time is up':status==='paused'?'Paused':'Running'}
                  </span>
                </div>
                <div className="kitchen-active-timer-clock">{digitalTimer(remaining)}</div>
                <div className="kitchen-active-timer-actions">
                  {status==='running'&&<button type="button" className="icon-button"
                    aria-label={`Pause ${timer.label}`}
                    onClick={()=>change(current=>pauseKitchenTimer(current,timer.id,Date.now()))}>
                    <Pause size={18}/>
                  </button>}
                  {status==='paused'&&<button type="button" className="icon-button"
                    aria-label={`Resume ${timer.label}`}
                    onClick={()=>change(current=>resumeKitchenTimer(current,timer.id,Date.now()))}>
                    <Play size={18}/>
                  </button>}
                  <button type="button" className="icon-button"
                    aria-label={`Dismiss ${timer.label}`}
                    onClick={()=>change(current=>dismissKitchenTimer(current,timer.id,Date.now()))}>
                    <X size={18}/>
                  </button>
                </div>
              </div>;
            })}
          </div>
          <div className="kitchen-timer-controls">
            <label className="kitchen-custom-timer">Minutes
              <input type="number" min={1} max={180} step={1} value={manualMinutes}
                onChange={e=>setManualMinutes(Number(e.target.value))}/>
            </label>
            <button type="button" className="button button-primary"
              disabled={timers.length>=8||!Number.isInteger(manualMinutes)||manualMinutes<1||manualMinutes>180}
              onClick={()=>startTimer(manualMinutes*60,'Kitchen timer')}>
              <TimerReset size={16}/> Add timer
            </button>
          </div>
          <p className="kitchen-timer-note">Timers use real deadlines and restore after reload on this device. Browser tabs and operating systems may suppress alerts while closed; always check food safety yourself.</p>
        </div>
      </div>
    </div>
  </section>;
}
