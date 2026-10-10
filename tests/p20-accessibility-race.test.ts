import { describe,expect,it } from 'vitest';
import { createExclusiveActionGate } from '../src/ui/exclusive-action.ts';

describe('P20 collection single-flight safety',()=>{
 it('rejects racing writes immediately, without queuing a stale second mutation',async()=>{
   const gate=createExclusiveActionGate();
   let finish!:()=>void;
   const held=new Promise<void>(resolve=>{finish=resolve;});
   let executions=0;
   const first=gate.run(async()=>{executions++;await held;});
   expect(gate.busy).toBe(true);
   const second=await gate.run(async()=>{executions++;});
   expect(second).toBe('busy');
   expect(executions).toBe(1);
   finish();
   expect(await first).toBe('accepted');
   expect(gate.busy).toBe(false);
 });
 it('releases the write lock on rejection, preventing a permanent disabled state',async()=>{
   const gate=createExclusiveActionGate();
   await expect(gate.run(async()=>{throw new Error('Offline storage refused');})).rejects.toThrow('Offline storage refused');
   expect(gate.busy).toBe(false);
   expect(await gate.run(async()=>{})).toBe('accepted');
 });
 it('never marks a failed or blocked mutation as accepted',async()=>{
   const gate=createExclusiveActionGate();
   let release!:()=>void;
   const blocker=new Promise<void>(resolve=>{release=resolve;});
   const first=gate.run(()=>blocker);
   const competing=await gate.run(async()=>{throw Error('Should never execute');});
   expect(competing).toBe('busy');
   release();
   expect(await first).toBe('accepted');
 });
});
