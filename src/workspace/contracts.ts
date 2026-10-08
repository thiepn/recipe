import { z } from 'zod';
import { mealPlannerSchema } from '../planning/model.ts';
import { kitchenSessionSchema } from '../kitchen/session.ts';

const uuid=z.string().uuid();
export const workspaceKindSchema=z.enum(['plan','session']);
export type WorkspaceKind=z.infer<typeof workspaceKindSchema>;
export function workspaceKey(kind:WorkspaceKind,resourceKey:string):string {
  if(kind==='plan'){
    if(resourceKey!=='main')throw new TypeError('Plan key must be main');
  }else uuid.parse(resourceKey);
  return `${kind}:${resourceKey}`;
}
const payload=z.object({
  kind:workspaceKindSchema,
  resourceKey:z.string().min(1).max(40),
  revision:z.number().int().nonnegative(),
  document:z.unknown().nullable(),
  updatedAt:z.string().datetime({offset:true}),
}).strict().superRefine((value,ctx)=>{
  try{workspaceKey(value.kind,value.resourceKey);}catch{
    ctx.addIssue({code:'custom',message:'Bad workspace resource key'});
  }
  if(value.document===null)return;
  const parsed=(value.kind==='plan'?mealPlannerSchema:kitchenSessionSchema).safeParse(value.document);
  if(!parsed.success)ctx.addIssue({code:'custom',message:'Bad workspace document'});
  if(value.kind==='session' && typeof value.document==='object'&&
    value.document!==null && 'recipeId' in value.document
    &&value.document.recipeId!==value.resourceKey)
    ctx.addIssue({code:'custom',message:'Session resource mismatch'});
});
export const workspaceListResponseSchema=z.object({
  schemaVersion:z.literal(1),
  documents:z.array(payload).max(1000),
}).strict();

export const workspaceMutationInputSchema=z.object({
  kind:workspaceKindSchema,
  resourceKey:z.string().min(1).max(40),
  baseRevision:z.number().int().nonnegative(),
  document:z.unknown().nullable(),
}).strict().superRefine((value,ctx)=>{
  const valid=payload.safeParse({
    ...value,revision:0,updatedAt:'2026-01-01T00:00:00Z',
  });
  if(!valid.success)ctx.addIssue({code:'custom',message:'Invalid workspace mutation'});
});
export const workspaceMutationResponseSchema=z.object({
  status:z.enum(['applied','conflict']),
  revision:z.number().int().nonnegative(),
  document:z.unknown().nullable(),
  updatedAt:z.string().datetime({offset:true}),
}).strict();
export type WorkspaceRemote=z.infer<typeof payload>;
