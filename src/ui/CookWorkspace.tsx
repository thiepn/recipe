import { useEffect,useMemo,useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, ChefHat, Clock3,
  Pause, Play, RotateCcw, TimerReset, Utensils, X,
} from 'lucide-react';
import type { LocalRecipeRecord } from '../data/local-db.ts';
import {
  boundedServings,digitalTimer,kitchenIngredientText,stepProgress,timerSeconds,
} from '../kitchen/model.ts';

interface Props {
  records:LocalRecipeRecord[];
  selectedId:string|null;
  onChoose:(id:string)=>void;
  onExit:()=>void;
  onEdit:(record:LocalRecipeRecord)=>void;
}

interface Countdown {
  endAt:number|null;
  remaining:number;
  label:string;
  finished:boolean;
}

export function CookWorkspace({records,selectedId,onChoose,onExit,onEdit}:Props) {
  const selected=records.find(r=>r.resourceId===selectedId);
  if(selected)return <CookSession key={selected.resourceId} record={selected} onExit={onExit}/>;
  const eligible=records.filter(r=>r.working.steps.length>0);
  return <section className="kitchen-library" aria-labelledby="cook-page-title">
    <div className="kitchen-intro">
      <p className="eyebrow">In the kitchen</p>
      <div className="kitchen-intro-line">
        <h1 id="cook-page-title">Cook</h1>
        <span>{eligible.length} ready to make</span>
      </div>
      <p>Choose a recipe to open a focused, hands-on view with ingredients, instructions and a timer.</p>
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
          return <button className="kitchen-choice" key={record.resourceId} type="button" onClick={()=>onChoose(record.resourceId)}>
            <div className="kitchen-choice-image"><ChefHat size={36} strokeWidth={1.2}/></div>
            <div className="kitchen-choice-meta">
              <p>{doc.version.totalMinutes ? `${doc.version.totalMinutes} min` : 'No time set'} · {doc.steps.length} steps</p>
              <h2>{doc.version.title}</h2>
              {doc.version.description&&<span>{doc.version.description}</span>}
              <strong>Start cooking <ArrowRight size={17}/></strong>
            </div>
          </button>;
        })}
      </div>}
  </section>;
}

function CookSession({record,onExit}: {record:LocalRecipeRecord;onExit:()=>void}) {
  const doc=record.working;
  const ingredients=useMemo(()=>[...doc.ingredients].sort((a,b)=>a.position-b.position),[doc.ingredients]);
  const steps=useMemo(()=>[...doc.steps].sort((a,b)=>a.position-b.position),[doc.steps]);
  const [stepIndex,setStepIndex]=useState(0);
  const [checkedIngredients,setCheckedIngredients]=useState<Set<string>>(()=>new Set());
  const [completedSteps,setCompletedSteps]=useState<Set<string>>(()=>new Set());
  const [servings,setServings]=useState(doc.version.servings??2);
  const [manualMinutes,setManualMinutes]=useState(5);
  const [now,setNow]=useState(()=>Date.now());
  const [timer,setTimer]=useState<Countdown>({endAt:null,remaining:0,label:'',finished:false});
  const step=steps[stepIndex];
  const factor=boundedServings(servings,doc.version.servings);
  const progress=stepProgress(completedSteps,steps);
  const countdown=timerSeconds(now,timer.endAt,timer.remaining);
  const timerRunning=timer.endAt!==null;
  const hasTimer=timerRunning||countdown>0||timer.finished;
  const complete=steps.length>0&&progress===100;

  useEffect(()=>{
    if(timer.endAt===null)return;
    const interval=globalThis.setInterval(()=>setNow(Date.now()),500);
    return ()=>globalThis.clearInterval(interval);
  },[timer.endAt]);
  useEffect(()=>{
    if(timer.endAt!==null&&countdown===0)
      setTimer(prev=>prev.endAt===null?prev:{...prev,endAt:null,remaining:0,finished:true});
  },[countdown,timer.endAt]);

  function leave() {
    if((completedSteps.size>0 || timerRunning)&&
      !globalThis.confirm('Leave this cooking session? Step checkmarks and the timer will reset.'))return;
    onExit();
  }
  function toggleIngredient(id:string) {
    setCheckedIngredients(prev=>{
      const next=new Set(prev);
      if(next.has(id))next.delete(id);else next.add(id);
      return next;
    });
  }
  function markStep() {
    if(!step)return;
    setCompletedSteps(prev=>new Set(prev).add(step.id));
    if(stepIndex<steps.length-1)setStepIndex(n=>n+1);
  }
  function chooseStep(index:number){
    if(index>=0&&index<steps.length)setStepIndex(index);
  }
  function startTimer(seconds:number,label:string) {
    if(!Number.isFinite(seconds)||seconds<=0||seconds>12*3600)return;
    const end=Date.now()+seconds*1000;
    setNow(Date.now());
    setTimer({endAt:end,remaining:seconds,label,finished:false});
  }
  function pauseTimer(){
    setTimer(prev=>prev.endAt===null?prev:{
      ...prev,remaining:timerSeconds(Date.now(),prev.endAt,prev.remaining),endAt:null,
    });
  }
  function resumeTimer(){
    if(timer.remaining<=0)return;
    setTimer(prev=>({...prev,endAt:Date.now()+prev.remaining*1000,finished:false}));
    setNow(Date.now());
  }
  function resetTimer(){setTimer({endAt:null,remaining:0,label:'',finished:false});}
  return <section className="kitchen-session" aria-labelledby="cooking-title">
    <header className="kitchen-session-header">
      <button className="kitchen-return" type="button" onClick={leave}>
        <ArrowLeft size={18}/> All recipes
      </button>
      <div className="kitchen-session-title">
        <p className="eyebrow">Now cooking</p>
        <h1 id="cooking-title">{doc.version.title}</h1>
        <span>{doc.version.totalMinutes?`${doc.version.totalMinutes} min estimated`:'Follow the steps at your pace'}</span>
      </div>
      <div className="kitchen-progress-label">{progress}% done</div>
    </header>
    <div className="kitchen-progress" role="progressbar" aria-label="Completed cooking steps" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
      <div style={{width:`${progress}%`}}/>
    </div>
    <div className="kitchen-layout">
      <aside className="kitchen-supply">
        <div className="kitchen-supply-header">
          <h2>Ingredients</h2>
          <span>{checkedIngredients.size}/{ingredients.length}</span>
        </div>
        {doc.version.servings!==null?
          <div className="kitchen-servings">
            <label htmlFor="kitchen-servings-input">Servings</label>
            <div className="kitchen-serving-adjust">
              <button type="button" onClick={()=>setServings(n=>Math.max(doc.version.servings!*0.25,+(n-1).toFixed(2)))}
                disabled={servings<=doc.version.servings*0.25} aria-label="Decrease servings">−</button>
              <input id="kitchen-servings-input" type="number" min={doc.version.servings*0.25}
                max={doc.version.servings*8} step={0.5} value={servings}
                onChange={e=>{
                  const v=Number(e.target.value);
                  if(Number.isFinite(v)&&v>0)setServings(Math.max(doc.version.servings!*0.25,Math.min(doc.version.servings!*8,v)));
                }}/>
              <button type="button" onClick={()=>setServings(n=>Math.min(doc.version.servings!*8,n+1))}
                disabled={servings>=doc.version.servings*8} aria-label="Increase servings">+</button>
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
        {complete?
          <div className="kitchen-finished">
            <CheckCircle2 size={65} strokeWidth={1.25}/>
            <p className="eyebrow">All steps completed</p>
            <h2>Ready to serve.</h2>
            <p>Check seasoning, temperature and doneness before serving. Timers don't verify food safety.</p>
            <button type="button" className="button button-primary" onClick={leave}>Back to cookbook</button>
            <button type="button" className="button button-secondary" onClick={()=>{
              setCompletedSteps(new Set());setCheckedIngredients(new Set());setStepIndex(0);resetTimer();
            }}><RotateCcw size={16}/> Cook again</button>
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
          <div className="kitchen-timer-title"><Clock3 size={18}/><h2 id="kitchen-timer-title">Kitchen timer</h2></div>
          <div className="kitchen-clock" aria-live={timer.finished?'polite':'off'}>
            <strong>{digitalTimer(countdown)}</strong>
            <span>{timer.finished?'Time is up':timer.label||'No timer running'}</span>
          </div>
          <div className="kitchen-timer-controls">
            {timerRunning?
              <button type="button" className="button button-secondary" onClick={pauseTimer}><Pause size={16}/> Pause</button>
              :countdown>0?
                <button type="button" className="button button-secondary" onClick={resumeTimer}><Play size={16}/> Resume</button>
              :null}
            {hasTimer&&<button type="button" className="button button-secondary" onClick={resetTimer}>
              <X size={16}/> Clear
            </button>}
            <label className="kitchen-custom-timer">Minutes
              <input type="number" min={1} max={180} step={1} value={manualMinutes}
                onChange={e=>setManualMinutes(Number(e.target.value))}/>
            </label>
            <button type="button" className="button button-primary" disabled={!Number.isInteger(manualMinutes)||manualMinutes<1||manualMinutes>180}
              onClick={()=>startTimer(manualMinutes*60,'Manual timer')}>
              <TimerReset size={16}/> Start
            </button>
          </div>
          <p className="kitchen-timer-note">Timer continues while this tab is open, even if the screen temporarily sleeps. It is not a substitute for checking food temperature or doneness.</p>
        </div>
      </div>
    </div>
  </section>;
}
