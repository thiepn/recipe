import { useEffect,useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RecipeLocalDb,type LocalRecipeRecord } from '../../src/data/local-db.ts';
import { createBlankRecipe } from '../../src/library/create.ts';
import { newIngredient,newStep } from '../../src/library/editor.ts';
import { EMPTY_PANTRY } from '../../src/library/ingredients.ts';
import { CookingIntelligence } from '../../src/ui/CookingIntelligence.tsx';
import { cleanCookingPreferences,DEFAULT_COOKING_PREFERENCES,type CookingPreferences } from '../../src/intelligence/suggestions.ts';
import '../../src/ui/styles.css';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function seed(title:string,owner:string,ingredients:string[],minutes:number|null):LocalRecipeRecord{
 const d=createBlankRecipe(title);
 return {accountId:owner,resourceId:d.recipe.id,working:{
  ...d,version:{...d.version,totalMinutes:minutes},ingredients:ingredients.map((name,i)=>({
    ...newIngredient(d.version.id,crypto.randomUUID(),i),name
  })),steps:[{...newStep(d.version.id,crypto.randomUUID(),0),instruction:'Sauté for a few minutes.'}],
 },base:null,serverRevision:0,localRevision:1,syncState:'pending',tombstone:false,updatedAt:1};
}
const records=[seed('Tomato pasta',A,['tomato','garlic'],25),seed('Rice bowl',A,['rice'],15),
 seed('Other owner secret',B,['tomato'],10)];
function Fixture(){
 const [owner,setOwner]=useState(A);
 const [db,setDb]=useState<RecipeLocalDb|null>(null);
 const [prefs,setPrefs]=useState<CookingPreferences>(DEFAULT_COOKING_PREFERENCES);
 const [opened,setOpened]=useState('None');
 const [plan,setPlan]=useState(false);
 useEffect(()=>{let cancelled=false;let current:RecipeLocalDb|null=null;
  void RecipeLocalDb.open().then(async openedDb=>{
   current=openedDb;
   const value=cleanCookingPreferences(await openedDb.getMeta(owner,'cooking-preferences-v1'));
   if(cancelled){openedDb.close();return;}
   setDb(openedDb);setPrefs(value);
  });
  return ()=>{cancelled=true;current?.close();setDb(null);setPrefs(DEFAULT_COOKING_PREFERENCES);};
 },[owner]);
 const save=(next:CookingPreferences)=>{
  if(!db)return;
  setPrefs(next);void db.setMeta(owner,'cooking-preferences-v1',next);
 };
 return <main className="cookbook-page" style={{maxWidth:1060,margin:'auto',padding:16}}>
  <h1>My cookbook</h1>
  <div className="p19-fixture-controls">
    <button type="button" onClick={()=>setOwner(A)}>Account A</button>
    <button type="button" onClick={()=>setOwner(B)}>Account B</button>
    <span data-testid="current-account">{owner===A?'A':'B'}</span>
  </div>
  {db?<CookingIntelligence key={owner} accountId={owner} records={records} pantry={{...EMPTY_PANTRY,ingredients:['tomato']}}
     preferences={prefs} onChange={save} onOpen={r=>setOpened(r.working.version.title)} onPlan={()=>setPlan(true)}/>:
     <p role="status">Loading private preferences</p>}
  <p data-testid="opened-recipe">Opened: {opened}</p>
  {plan&&<p data-testid="plan-notice">Planner navigation requested, no meals assigned</p>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
