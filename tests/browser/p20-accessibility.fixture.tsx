import { useEffect,useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AddSheet,CollectionPicker } from '../../src/ui/App.tsx';
import { ImportSheet } from '../../src/ui/ImportSheet.tsx';
import { RecoveryPanel } from '../../src/ui/RecoveryPanel.tsx';
import { RecipeStudio } from '../../src/ui/RecipeStudio.tsx';
import { EMPTY_COLLECTION_BOOK,createCollection } from '../../src/library/collections.ts';
import { createBlankRecipe } from '../../src/library/create.ts';
import { RecipeLocalDb,type LocalRecipeRecord } from '../../src/data/local-db.ts';
import type { RecipeCoreApi } from '../../src/api/core.ts';
import type { RecipeEditableCollectionBook } from '../../src/api/protocol.ts';
import '../../src/ui/styles.css';

const accountId='11111111-1111-4111-8111-111111111111';
const record=(()=>{
  const base=createBlankRecipe('Synthetic pasta');
  return {accountId,resourceId:base.recipe.id,working:base,base:null,serverRevision:0,
    localRevision:1,syncState:'pending',tombstone:false,updatedAt:0} satisfies LocalRecipeRecord;
})();
type Surface='none'|'add'|'collections'|'import'|'recovery'|'studio';
function App(){
 const [screen,setScreen]=useState<Surface>('none');
 const [db,setDb]=useState<RecipeLocalDb|null>(null);
 const [book,setBook]=useState<RecipeEditableCollectionBook>(()=>createCollection(EMPTY_COLLECTION_BOOK,'Weeknight'));
 const [saveFailures,setSaveFailures]=useState(0);
 const [saveAttempts,setSaveAttempts]=useState(0);
 useEffect(()=>{
   let cancelled=false;let opened:RecipeLocalDb|null=null;
   void RecipeLocalDb.open().then(next=>{
     if(cancelled)next.close();else{opened=next;setDb(next);}
   });
   return ()=>{cancelled=true;opened?.close();};
 },[]);
 const close=()=>setScreen('none');
 const update=async(next:RecipeEditableCollectionBook)=>{
   setSaveAttempts(n=>n+1);
   await new Promise(resolve=>setTimeout(resolve,120));
   if(saveFailures){setSaveFailures(0);throw new Error('Synthetic failure');}
   setBook(next);
 };
 return <div className="p20-fixture"><h1>Accessibility qualification</h1>
   <nav aria-label="Synthetic accessibility surfaces">
     {(['add','collections','import','recovery','studio'] as const).map(name=>
       <button type="button" key={name} onClick={()=>setScreen(name)}>{name}</button>)}
   </nav>
   <button type="button" onClick={()=>setSaveFailures(1)}>Fail next collection save</button>
   <output data-testid="save-attempts">{saveAttempts}</output>
   <AddSheet open={screen==='add'} onClose={close}
     onCreate={async()=>{close();}} onImport={()=>setScreen('import')}/>
   {screen==='collections'&&<CollectionPicker recipeId={record.resourceId} book={book}
     onClose={close} onChange={update}/>}
   <ImportSheet open={screen==='import'} initialMode="text" onClose={close}
     onSave={async()=> 'saved'}/>
   {db&&screen==='recovery'&&<RecoveryPanel db={db} accountId={accountId}
     api={{} as RecipeCoreApi} onClose={close} onRecovered={async()=>{}}
     onEditRecipe={()=>{}} syncBusy={false}/>}
   {screen==='studio'&&<RecipeStudio record={record} onClose={close} onSave={async()=>{close();}}/>}
   {!db&&screen==='recovery'&&<p role="status">Loading synthetic IndexedDB</p>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
