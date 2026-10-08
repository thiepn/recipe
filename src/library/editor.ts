import {
  recipeEditableDocumentSchema,
  type RecipeEditableDocument,
} from '../api/protocol.ts';

export type IngredientRow=RecipeEditableDocument['ingredients'][number];
export type StepRow=RecipeEditableDocument['steps'][number];

export function newIngredient(versionId:string,id:string,position:number):IngredientRow {
  return {
    id,recipeVersionId:versionId,groupId:null,position,
    name:'',quantity:null,quantityMax:null,unit:null,preparation:null,note:null,
    optional:false,scalingMode:'linear',canonicalKey:null,metadata:{},
  };
}

export function newStep(versionId:string,id:string,position:number):StepRow {
  return {
    id,recipeVersionId:versionId,position,title:null,instruction:'',
    durationSecondsMin:null,durationSecondsMax:null,timerLabel:null,
    temperatureC:null,temperatureDisplay:null,heatLevel:null,
    visualCue:null,donenessCue:null,techniqueKeys:[],isPassive:false,
    canParallelize:false,metadata:{},
  };
}

export function moveRow<T>(items:readonly T[],index:number,direction:-1|1):T[] {
  const destination=index+direction;
  if(index<0||destination<0||destination>=items.length)return [...items];
  const copy=[...items];
  [copy[index],copy[destination]]=[copy[destination]!,copy[index]!];
  return copy;
}

function uniqueTags(input:string):string[] {
  return [...new Set(input.split(',').map(s=>s.trim()).filter(Boolean))].slice(0,40);
}

export function finalizeRecipeEdits(
  source:RecipeEditableDocument,
  options:{cuisineTags?:string;categoryTags?:string;dietaryTags?:string}={},
):RecipeEditableDocument {
  // Do not implicitly remove empty rows. Explicit removal in the UI is required,
  // which prevents accidentally discarding incomplete ingredient/step edits.
  const ingredients=source.ingredients.map((row,index)=>({
    ...row,position:index,name:row.name.trim(),
    unit:row.unit?.trim()||null,preparation:row.preparation?.trim()||null,
    note:row.note?.trim()||null,
  }));
  const steps=source.steps.map((row,index)=>({
    ...row,position:index,instruction:row.instruction.trim(),
    title:row.title?.trim()||null,
  }));
  const ingredientIds=new Set(ingredients.map(item=>item.id));
  const stepIds=new Set(steps.map(item=>item.id));
  const equipmentIds=new Set(source.equipment.map(item=>item.id));
  const version={
    ...source.version,
    title:source.version.title.trim(),
    description:source.version.description?.trim()||null,
    story:source.version.story?.trim()||null,
    authorNote:source.version.authorNote?.trim()||null,
    ...(options.cuisineTags===undefined?{}:{cuisineTags:uniqueTags(options.cuisineTags)}),
    ...(options.categoryTags===undefined?{}:{categoryTags:uniqueTags(options.categoryTags)}),
    ...(options.dietaryTags===undefined?{}:{dietaryTags:uniqueTags(options.dietaryTags)}),
  };
  return recipeEditableDocumentSchema.parse({
    ...source,version,ingredients,steps,
    stepIngredients:source.stepIngredients.filter(link=>
      ingredientIds.has(link.ingredientId)&&stepIds.has(link.stepId)),
    stepEquipment:source.stepEquipment.filter(link=>
      equipmentIds.has(link.equipmentId)&&stepIds.has(link.stepId)),
  });
}
