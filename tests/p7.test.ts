import { describe, expect, it, afterEach, vi } from 'vitest';
import { recipeMcpService, type RecipeMcpCore } from '../src/mcp/recipe-service.ts';
import { createImportedRecipe, type ImportDraft } from '../src/import/recipe-import.ts';
import { verifyRecipeMcpRequest } from '../api/mcp-auth.ts';
import { POST } from '../api/mcp.ts';
import type { RecipeDocument } from '../src/api/protocol.ts';

const OWNER='11111111-1111-4111-8111-111111111111';
const OWNER2='22222222-2222-4222-8222-222222222222';
const REQUEST='33333333-3333-4333-8333-333333333333';
const ACCESS_ID='77777777-7777-4777-8777-777777777777';

function specimen(title:string,items:string[],steps:string[]):ImportDraft{
 return {kind:'text',method:'text',title,description:'',
  ingredients:items,steps,servings:null,totalMinutes:null,
  sourceUrl:null,sourceName:null,originalText:title, warnings:[]};
}
async function doc(title:string,items:string[],optional:string[]=[]):Promise<RecipeDocument>{
 const draft=await createImportedRecipe(specimen(title,items,['Cook until done.']));
 const timestamp=new Date('2026-10-08T10:00:00.000Z').toISOString();
 return {
  schemaVersion:1,
  recipe:{
   ...draft.recipe,currentVersionId:draft.version.id,visibility:'private',
   heroImagePath:null,lastCookedAt:null,archivedAt:null,deletedAt:null,
   revision:1,createdAt:timestamp,updatedAt:timestamp,
  },
  version:{...draft.version,parentVersionId:null,revision:0,createdAt:timestamp,updatedAt:timestamp},
  sources:[],
  ingredients:draft.ingredients.map(item=>({...item,optional:optional.includes(item.name)})),
  ingredientGroups:[],steps:draft.steps,stepIngredients:[],equipment:[],stepEquipment:[],
 };
}
function manifestFor(docs:RecipeDocument[]) {
 return {cursor:1,recipes:docs.map(doc=>({
  id:doc.recipe.id,revision:doc.recipe.revision,
  state:doc.recipe.state,favorite:doc.recipe.favorite,currentVersionId:doc.version.id,
  title:doc.version.title,heroImagePath:null,deletedAt:null,updatedAt:doc.recipe.updatedAt,
 }))};
}
function coreFor(docs:RecipeDocument[]=[]){
 const writes:unknown[]=[];
 const core = {
  manifest:vi.fn(async()=>manifestFor(docs)),
  document:vi.fn(async(id:string)=>{
   const found=docs.find(x=>x.recipe.id===id);
   if(!found)throw Object.assign(new Error('not found'),{status:404});
   return found;
  }),
  mutate:vi.fn(async(mutations:unknown[])=>{
   writes.push(...mutations);
   const v=mutations[0] as {resourceId:string};
   return {results:[{status:'applied' as const,resourceId:v.resourceId,revision:1,changeSequence:1}]};
  }),
 };
 return {core:core as RecipeMcpCore,writes,mocks:core};
}
const input={
 title:'Crispy tofu rice',description:'Fast dinner',
 ingredients:['200 g tofu','1 tbsp sesame oil','rice'],
 steps:['Heat the pan.','Fry the tofu.','Serve with rice.'],
 source_url:'https://example.com/tofu?utm_source=chatgpt',
 request_id:REQUEST,confirmed:true as const,
};
describe('P7 Recipe MCP owner-scoped service',()=>{
 it('saves a validated PRIVATE draft with user-bound stable identities and provenance',async()=>{
  const {core,writes}=coreFor();
  const service=recipeMcpService(core,OWNER);
  const result=await service.saveDraft(input);
  expect(result.status).toBe('saved');
  const mutation=writes[0] as {resourceId:string;operation:string;baseRevision:number;document:RecipeDocument};
  expect(mutation.operation).toBe('create');
  expect(mutation.baseRevision).toBe(0);
  expect(mutation.document.recipe.state).toBe('draft');
  expect(mutation.document.ingredients).toHaveLength(3);
  expect(mutation.document.version.metadata.importSource).toMatchObject({
   kind:'chatgpt',url:'https://example.com/tofu',
   reviewStatus:'user-confirmed-draft',
  });
  expect(mutation.resourceId).toBe(result.recipe_id);
 });
 it('produces different recipe identities for different Account owners',async()=>{
  const one=coreFor(); const two=coreFor();
  const r1=await recipeMcpService(one.core,OWNER).saveDraft(input);
  const r2=await recipeMcpService(two.core,OWNER2).saveDraft(input);
  expect(r1.recipe_id).not.toBe(r2.recipe_id);
 });
 it('blocks repeated titles before mutation unless the user allows a duplicate',async()=>{
  const previous=await doc(input.title,['tofu']);
  const fixture=coreFor([previous]);
  const service=recipeMcpService(fixture.core,OWNER);
  const first=await service.saveDraft(input);
  expect(first.status).toBe('duplicate_warning');
  expect(fixture.writes).toHaveLength(0);
  const second=await service.saveDraft({...input,allow_duplicate:true});
  expect(second.status).toBe('saved');
  expect(fixture.writes).toHaveLength(1);
 });
 it('validates confirmation, recipe shape and request UUID',async()=>{
  const fixture=coreFor();
  const service=recipeMcpService(fixture.core,OWNER);
  await expect(service.saveDraft({...input,confirmed:false})).rejects.toThrow();
  await expect(service.saveDraft({...input,request_id:'bad'})).rejects.toThrow();
  await expect(service.saveDraft({...input,ingredients:[]})).rejects.toThrow();
  expect(fixture.writes).toHaveLength(0);
 });
 it('lists and retrieves only documents supplied by the authenticated Core gateway',async()=>{
  const documents=[await doc('Soup',['tomato']),await doc('Tofu Rice',['tofu','rice'])];
  const fixture=coreFor(documents);
  const service=recipeMcpService(fixture.core,OWNER);
  const list=await service.list({query:'rice'});
  expect(list.recipes).toHaveLength(1);
  expect(list.recipes[0]?.title).toBe('Tofu Rice');
  const detail=await service.get({recipe_id:documents[0]!.recipe.id});
  expect(detail.ingredients[0]?.name).toBe('tomato');
 });
 it('returns exact missing ingredient types, excludes optional, and reports scan completeness',async()=>{
  const docs=[await doc('Tofu bowl',['rice','tofu','salt'],['salt'])];
  const fixture=coreFor(docs);
  const service=recipeMcpService(fixture.core,OWNER);
  const result=await service.findByIngredients({available:['rice']});
  expect(result.recipes[0]).toMatchObject({
   title:'Tofu bowl',matched_types:1,required_types:2,missing_ingredients:['tofu'],
  });
  expect(result.truncated).toBe(false);
  expect((await service.findByIngredients({available:['rice'],max_missing:0})).recipes).toHaveLength(0);
 });
});
const oldEnv={
 THIEPN_ACCOUNT_URL:process.env.THIEPN_ACCOUNT_URL,
 THIEPN_ACCOUNT_PUBLISHABLE_KEY:process.env.THIEPN_ACCOUNT_PUBLISHABLE_KEY,
 THIEPN_CORE_GATEWAY_URL:process.env.THIEPN_CORE_GATEWAY_URL,
 RECIPE_MCP_RESOURCE_URL:process.env.RECIPE_MCP_RESOURCE_URL,
};
process.env.THIEPN_ACCOUNT_URL='https://account.example';
process.env.THIEPN_ACCOUNT_PUBLISHABLE_KEY='test-publishable';
process.env.THIEPN_CORE_GATEWAY_URL='https://core.example';
process.env.RECIPE_MCP_RESOURCE_URL='https://recipe.example/api/mcp';
const fetchOriginal=globalThis.fetch;
afterEach(()=>{
 globalThis.fetch=fetchOriginal;
});
function oauthToken(claims:Record<string,unknown>={}){
 const encode=(v:unknown)=>btoa(JSON.stringify(v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
 return [
  encode({alg:'RS256',typ:'JWT'}),
  encode({iss:'https://account.example/auth/v1',sub:OWNER,exp:Math.floor(Date.now()/1000)+3600,
   client_id:ACCESS_ID,scope:'openid email profile offline_access',
   aud:'https://recipe.example/api/mcp',resource:'https://recipe.example/api/mcp',...claims}),
  'mock-signature',
 ].join('.');
}
const call=(bearer:string|null,body:unknown)=>{
 const headers:Record<string,string>={'Content-Type':'application/json'};
 if(bearer)headers.Authorization=`Bearer ${bearer}`;
 return new Request('https://recipe.example/api/mcp',{method:'POST',headers,body:JSON.stringify(body)});
};
describe('P7 OAuth and MCP transport boundary',()=>{
 it('rejects tokens from other MCP resources and unauthenticated calls',async()=>{
  const spy=vi.fn(async()=>Response.json({id:OWNER}));
  globalThis.fetch=spy as typeof fetch;
  expect((await verifyRecipeMcpRequest(call(null,{})) as Response).status).toBe(401);
  expect((await verifyRecipeMcpRequest(call(oauthToken({aud:'https://finance.example/api/mcp'}),{})) as Response).status).toBe(401);
  expect((await verifyRecipeMcpRequest(call(oauthToken({resource:'https://finance.example/api/mcp'}),{})) as Response).status).toBe(401);
  expect((await verifyRecipeMcpRequest(call(oauthToken({client_id:undefined}),{})) as Response).status).toBe(401);
  expect(spy).not.toHaveBeenCalled();
 });
 it('requires the /auth/v1/user response to match the token subject',async()=>{
  globalThis.fetch=vi.fn(async()=>Response.json({id:OWNER2})) as typeof fetch;
  const response=await verifyRecipeMcpRequest(call(oauthToken(),{}));
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(401);
 });
 it('advertises four explicit tools only to verified OAuth identities',async()=>{
  globalThis.fetch=vi.fn(async()=>Response.json({id:OWNER})) as typeof fetch;
  const response=await POST(call(oauthToken(),{jsonrpc:'2.0',id:1,method:'tools/list'}));
  expect(response.status).toBe(200);
  const data=await response.json() as {result:{tools:Array<{name:string}>}};
  expect(data.result.tools.map(x=>x.name)).toEqual([
   'recipe_list','recipe_get','recipe_find_by_ingredients','recipe_save_draft',
  ]);
 });
});
