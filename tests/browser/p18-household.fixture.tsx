import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {HouseholdSharing} from '../../src/ui/HouseholdSharing.tsx';
import '../../src/ui/styles.css';
function TestHousehold(){
 const [open,setOpen]=useState(false);
 return <main><h1>Personal cookbook</h1>
 <button type="button" onClick={()=>setOpen(true)}>Family sharing</button>
 {open&&<HouseholdSharing onClose={()=>setOpen(false)}/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<TestHousehold/>);
