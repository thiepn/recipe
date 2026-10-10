import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KitchenHandsFree } from '../../src/ui/KitchenHandsFree.tsx';
import type { KitchenTimer } from '../../src/kitchen/session.ts';
import '../../src/ui/styles.css';
const UUIDS=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
function Fixture() {
  const [step,setStep]=useState(0);
  const [now,setNow]=useState(Date.now());
  const [timers,setTimers]=useState<KitchenTimer[]>([]);
  useEffect(()=>{const tick=window.setInterval(()=>setNow(Date.now()),100);return ()=>clearInterval(tick);},[]);
  const addTimer=()=>{
    const index=timers.length;
    const timestamp=Date.now();
    setTimers(items=>[...items,{
      id:UUIDS[index]!,label:index===0?'Quick timer':'Long timer',
      durationSeconds:index===0?1:3,remainingSeconds:index===0?1:3,
      deadlineAt:timestamp+(index===0?1000:3000),status:'running',createdAt:timestamp,
    }]);
  };
  return <main style={{maxWidth:850,margin:'0 auto',padding:16}}>
    <p data-testid="fixture-step">Step {step+1}</p>
    <button type="button" onClick={addTimer} disabled={timers.length>=2}>Start demo timer</button>
    <button type="button" onClick={()=>setTimers([])}>Dismiss demo timers</button>
    <KitchenHandsFree recipeId="33333333-3333-4333-8333-333333333333"
      stepIndex={step} stepCount={3} stepTitle="Simmer" stepInstruction="Stir gently and cook."
      timers={timers} now={now} onNext={()=>setStep(s=>Math.min(2,s+1))}
      onPrevious={()=>setStep(s=>Math.max(0,s-1))}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
