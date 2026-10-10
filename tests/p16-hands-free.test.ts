import { describe, expect, it } from 'vitest';
import type { KitchenTimer } from '../src/kitchen/session.ts';
import { newlyDueTimers, parseKitchenVoiceCommand, stepSpeechText } from '../src/kitchen/hands-free.ts';

const timer=(id:string, deadlineAt:number):KitchenTimer=>({
  id, label:'Oven', status:'running', createdAt:10,
  durationSeconds:60, remainingSeconds:60, deadlineAt,
});
describe('P16 hands-free command and timer safeguards',()=>{
  it('accepts only an explicit small command grammar',()=>{
    expect(parseKitchenVoiceCommand('Next step!')).toBe('next');
    expect(parseKitchenVoiceCommand('Vorheriger Schritt')).toBe('previous');
    expect(parseKitchenVoiceCommand('read step')).toBe('read');
    expect(parseKitchenVoiceCommand('stop listening')).toBe('stop');
    expect(parseKitchenVoiceCommand('the recipe says next step, then bake')).toBeNull();
    expect(parseKitchenVoiceCommand('delete all recipes')).toBeNull();
    expect(parseKitchenVoiceCommand('next step and finish')).toBeNull();
    expect(parseKitchenVoiceCommand('')).toBeNull();
  });
  it('reads only the selected step and caps synthesized text size',()=>{
    expect(stepSpeechText(2,3,'Simmer','Stir slowly')).toBe('Step 2 of 3. Simmer Stir slowly');
    expect(stepSpeechText(1,1,null,'Mix')).toBe('Step 1 of 1. Mix');
    expect(stepSpeechText(1,2,null,'a'.repeat(10_000)).length).toBe(2000);
  });
  it('detects parallel timer expiry independently after throttled ticks',()=>{
    const first=timer('11111111-1111-4111-8111-111111111111',2000);
    const second=timer('22222222-2222-4222-8222-222222222222',5000);
    const seen=new Set<string>();
    expect(newlyDueTimers([first,second],1000,seen)).toEqual([]);
    expect(newlyDueTimers([first,second],2000,seen)).toEqual([first]);
    expect(newlyDueTimers([first,second],8000,seen)).toEqual([second]);
    expect(newlyDueTimers([first,second],9000,seen)).toEqual([]);
  });
  it('does not alert paused timers, and prunes dismissed timer IDs',()=>{
    const a=timer('33333333-3333-4333-8333-333333333333',2000);
    const paused:KitchenTimer={...a,status:'paused',deadlineAt:null,remainingSeconds:30};
    const seen=new Set<string>();
    expect(newlyDueTimers([paused],5000,seen)).toEqual([]);
    expect(newlyDueTimers([a],5000,seen)).toHaveLength(1);
    expect(newlyDueTimers([],6000,seen)).toEqual([]);
    expect(seen.size).toBe(0);
  });
});
