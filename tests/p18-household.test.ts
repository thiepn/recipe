import {describe,expect,it} from 'vitest';
import {householdMay,NEVER_QUALIFIED,prepareHouseholdInvite,sharingCanActivate} from '../src/sharing/household.ts';
import type {HouseholdAction,HouseholdRole,MembershipStatus} from '../src/sharing/household.ts';
const owner='11111111-1111-4111-8111-111111111111';
const viewer='22222222-2222-4222-8222-222222222222';
const allActions:HouseholdAction[]=['recipe.read','recipe.edit','invite.prepare','invite.send','member.revoke','household.delete','planning.read','planning.write'];
describe('P18 permission boundaries never imply server authorization',()=>{
 it('denies all actions across each role without a verified Gateway even when IDs match',()=>{
  for(const role of ['owner','editor','viewer'] as HouseholdRole[])
   for(const action of allActions)
    expect(householdMay({actorId:role==='owner'?owner:viewer,ownerId:owner,role,status:'active',action,serverAuthorized:false})).toBe(false);
 });
 it('rejects pending/revoked members, wrong owner identity, missing principal and privilege spoofing',()=>{
  for(const status of ['pending','revoked',null] as (MembershipStatus|null)[])
   for(const action of allActions)
    expect(householdMay({actorId:viewer,ownerId:owner,role:'editor',status,action,serverAuthorized:true})).toBe(false);
  expect(householdMay({actorId:viewer,ownerId:owner,role:'owner',status:'active',action:'invite.send',serverAuthorized:true})).toBe(false);
  expect(householdMay({actorId:owner,ownerId:owner,role:'editor',status:'active',action:'recipe.edit',serverAuthorized:true})).toBe(false);
  expect(householdMay({actorId:null,ownerId:owner,role:'owner',status:'active',action:'invite.send',serverAuthorized:true})).toBe(false);
 });
 it('permits only bounded role actions hypothetically AFTER trusted service checks',()=>{
  expect(householdMay({actorId:owner,ownerId:owner,role:'owner',status:'active',action:'member.revoke',serverAuthorized:true})).toBe(true);
  for(const role of ['editor','viewer'] as const){
   for(const action of allActions){
    const expected=['recipe.read','planning.read',...(role==='editor'?['recipe.edit','planning.write']:[])].includes(action);
    expect(householdMay({actorId:viewer,ownerId:owner,role,status:'active',action,serverAuthorized:true})).toBe(expected);
   }
  }
 });
 it('does not grant an invitation to an unverified email, owner role or malformed payload',()=>{
  expect(prepareHouseholdInvite({email:'  Person@EXAMPLE.COM ',role:'viewer'})).toEqual({email:'person@example.com',role:'viewer'});
  for(const value of [{email:'x@example.com',role:'owner'}, {email:'x@example.com',role:'editor',ownerId:owner},
   {email:'a,b@example.com',role:'viewer'}, {email:'',role:'viewer'},{email:'x@example.com\nBcc:evil',role:'viewer'}])
   expect(()=>prepareHouseholdInvite(value)).toThrow();
 });
 it('keeps release closed until all five independent gates are true',()=>{
  expect(sharingCanActivate(NEVER_QUALIFIED)).toBe(false);
  const qualified={serverGateway:true,databasePolicies:true,testedRevocation:true,independentAccounts:true,operatorApproved:true};
  expect(sharingCanActivate(qualified)).toBe(true);
  for(const name of Object.keys(qualified) as Array<keyof typeof qualified>)expect(sharingCanActivate({...qualified,[name]:false})).toBe(false);
 });
});
