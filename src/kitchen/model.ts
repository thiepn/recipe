import type { RecipeEditableDocument } from '../api/protocol.ts';

export type KitchenIngredient=RecipeEditableDocument['ingredients'][number];
export type KitchenStep=RecipeEditableDocument['steps'][number];

export function boundedServings(value:number,base:number|null):number {
  if(!Number.isFinite(value)||value<=0)throw new RangeError('Servings must be positive.');
  if(base===null||base<=0)return 1;
  return Math.min(8,Math.max(0.25,value/base));
}

export function scaledAmount(value:number|null,mode:KitchenIngredient['scalingMode'],factor:number):number|null {
  if(value===null)return null;
  if(mode!=='linear')return value;
  const n=value*factor;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function quantityText(value:number):string {
  return Number(value.toFixed(2)).toLocaleString('en',{maximumFractionDigits:2});
}

export function kitchenIngredientText(item:KitchenIngredient,factor:number):string {
  const low=scaledAmount(item.quantity,item.scalingMode,factor);
  const high=scaledAmount(item.quantityMax,item.scalingMode,factor);
  const amount=low===null?'':quantityText(low)+(high!==null&&high!==low?`–${quantityText(high)}`:'');
  return [amount,item.unit||'',item.name].filter(Boolean).join(' ').trim()+
    (item.preparation?`, ${item.preparation}`:'')+
    (item.optional?' (optional)':'');
}

export function timerSeconds(now:number,endAt:number|null,pausedSeconds:number):number {
  if(endAt===null)return Math.max(0,Math.ceil(pausedSeconds));
  return Math.max(0,Math.ceil((endAt-now)/1000));
}

export function digitalTimer(seconds:number):string {
  const safe=Math.max(0,Math.floor(seconds));
  const hh=Math.floor(safe/3600);
  const mm=Math.floor((safe%3600)/60);
  const ss=safe%60;
  if(hh>0)return `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

export function stepProgress(completedIds:ReadonlySet<string>,steps:readonly KitchenStep[]){
  if(steps.length===0)return 0;
  return Math.round(100*steps.filter(step=>completedIds.has(step.id)).length/steps.length);
}
