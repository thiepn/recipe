import type { KitchenTimer } from './session.ts';
import { timerState } from './session.ts';

export type KitchenVoiceCommand = 'next' | 'previous' | 'read' | 'stop';

/** Exact, small command vocabulary: instructions must never trigger accidental navigation. */
export function parseKitchenVoiceCommand(transcript: string): KitchenVoiceCommand | null {
  const text = transcript.toLocaleLowerCase().replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!text || text.length > 80) return null;
  if (['next', 'next step', 'go to next step', 'continue', 'weiter', 'nächster schritt'].includes(text)) return 'next';
  if (['previous', 'previous step', 'go back', 'back', 'zurück', 'vorheriger schritt'].includes(text)) return 'previous';
  if (['read', 'read step', 'repeat', 'repeat step', 'vorlesen', 'schritt vorlesen'].includes(text)) return 'read';
  if (['stop', 'stop listening', 'cancel', 'stopp'].includes(text)) return 'stop';
  return null;
}

export function stepSpeechText(
  number: number, total: number, title: string | null | undefined, instruction: string,
): string {
  const prefix = ['Step ' + number + ' of ' + total + '.', title?.trim(), instruction.trim()]
    .filter(Boolean).join(' ');
  return prefix.slice(0, 2000);
}

/** Tracks each timer separately, even when several expire during one delayed foreground tick. */
export function newlyDueTimers(
  timers: readonly KitchenTimer[], now: number, acknowledged: Set<string>,
): KitchenTimer[] {
  const ids = new Set(timers.map(timer => timer.id));
  for (const id of acknowledged) if (!ids.has(id)) acknowledged.delete(id);
  const due: KitchenTimer[] = [];
  for (const timer of timers) {
    if (timerState(timer, now) === 'finished' && !acknowledged.has(timer.id)) {
      acknowledged.add(timer.id);
      due.push(timer);
    }
  }
  return due;
}
