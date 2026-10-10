import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBlankRecipe } from '../../src/library/create.ts';
import { newIngredient, newStep } from '../../src/library/editor.ts';
import { RecipeLocalDb, type LocalRecipeRecord } from '../../src/data/local-db.ts';
import { RecipeCard, RecipeDetail } from '../../src/ui/App.tsx';
import { CookbookViewSwitch, type CookbookViewMode } from '../../src/ui/CookbookViewSwitch.tsx';
import { RecipeStudio } from '../../src/ui/RecipeStudio.tsx';
import { CookWorkspace } from '../../src/ui/CookWorkspace.tsx';
import { MealPlanner } from '../../src/ui/MealPlanner.tsx';
import { EMPTY_PANTRY } from '../../src/library/ingredients.ts';

const owner = '11111111-1111-4111-8111-111111111111';
function recipeRecord(): LocalRecipeRecord {
  const document = createBlankRecipe('Weeknight Pasta');
  const ingredient = newIngredient(document.version.id,crypto.randomUUID(),0);
  const step = newStep(document.version.id,crypto.randomUUID(),0);
  const next = newStep(document.version.id,crypto.randomUUID(),1);
  const working = {
    ...document,
    version: {...document.version,description:'A quick tomato pasta for busy evenings.',servings:2,totalMinutes:25},
    ingredients: [{...ingredient,name:'tomato',quantity:300,unit:'g'}],
    steps: [{...step,title:'Prepare',instruction:'Chop the tomato.'},
      {...next,title:'Cook',instruction:'Simmer until tender.',durationSecondsMin:60}],
  };
  return {accountId:owner,resourceId:document.recipe.id,working,base:null,
    serverRevision:0,localRevision:1,syncState:'pending',tombstone:false,updatedAt:1};
}
function P17Fixture(){
  const [record,setRecord] = useState<LocalRecipeRecord>(()=>recipeRecord());
  const [db,setDb] = useState<RecipeLocalDb|null>(null);
  const [screen,setScreen] = useState<'cookbook'|'cook'|'studio'|'plan'>('cookbook');
  const [view,setView] = useState<CookbookViewMode>('grid');
  const [detail,setDetail] = useState(false);
  useEffect(()=>{
    let disposed=false;let instance:RecipeLocalDb|null=null;
    void RecipeLocalDb.open().then(value=>{
      if(disposed)value.close();
      else{instance=value;setDb(value);}
    });
    return ()=>{disposed=true;instance?.close();};
  },[]);
  const openStudio=()=>{setDetail(false);setScreen('studio');};
  const beginCook=()=>{setDetail(false);setScreen('cook');};
  return <div className="p17-evidence-root">
    <nav className="p17-fixture-nav" aria-label="Synthetic test surfaces">
      {(['cookbook','cook','studio','plan'] as const).map(name=>
        <button type="button" key={name} aria-pressed={screen===name}
          onClick={()=>{setDetail(false);setScreen(name);}}>{name}</button>)}
    </nav>
    {screen==='cookbook'&&<main className="cookbook-page">
      <header className="cookbook-toolbar"><div className="cookbook-heading">
        <h1>My cookbook</h1><span className="cookbook-count">1 recipe</span>
      </div></header>
      <div className="results-row"><span>1 recipe found</span><CookbookViewSwitch value={view} onChange={setView}/></div>
      <div className={view==='list'?'recipe-grid is-list':'recipe-grid'} data-view={view}>
        <RecipeCard record={record} onOpen={()=>setDetail(true)}
          onFavorite={()=>setRecord(v=>({...v,working:{...v.working,recipe:{...v.working.recipe,favorite:!v.working.recipe.favorite}}}))}
          onCollections={()=>{}}/>
      </div>
      {detail&&<RecipeDetail record={record} collections={['Weeknights']}
        onClose={()=>setDetail(false)}
        onFavorite={()=>setRecord(v=>({...v,working:{...v.working,recipe:{...v.working.recipe,favorite:!v.working.recipe.favorite}}}))}
        onCollections={()=>{}} onEdit={openStudio} onCook={beginCook}/>}
    </main>}
    {screen==='studio'&&<RecipeStudio record={record} onClose={()=>setScreen('cookbook')}
      onSave={async working=>{setRecord(v=>({...v,working}));}}/>}
    {screen==='cook'&&db&&<CookWorkspace records={[record]} selectedId={record.resourceId}
      onChoose={()=>{}} onExit={()=>setScreen('cookbook')} onEdit={openStudio} db={db} accountId={owner}/>}
    {screen==='plan'&&db&&<MealPlanner records={[record]} db={db} accountId={owner}
      pantry={EMPTY_PANTRY} onCook={beginCook} onEdit={openStudio} onAdd={()=>setScreen('studio')}/>}
    {(screen==='cook'||screen==='plan')&&!db&&<p role="status">Loading synthetic browser storage</p>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<P17Fixture/>);
