import { z } from 'zod';
import type { RecipeEditableDocument } from '../api/protocol.ts';
import type { LocalRecipeRecord, RecipeLocalDb } from '../data/local-db.ts';
import { timerSeconds } from './model.ts';

const uuid = z.string().uuid();
const timerSchema = z.object({
  id: uuid,
  label: z.string().trim().min(1).max(80),
  durationSeconds: z.number().int().min(1).max(43_200),
  remainingSeconds: z.number().int().min(0).max(43_200),
  deadlineAt: z.number().int().nonnegative().nullable(),
  status: z.enum(['running', 'paused', 'finished']),
  createdAt: z.number().int().nonnegative(),
}).strict().superRefine((timer, ctx) => {
  if ((timer.status === 'running') !== (timer.deadlineAt !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Running timers must have a deadline' });
  }
  if (timer.status === 'finished' && timer.remainingSeconds !== 0) {
    ctx.addIssue({ code: 'custom', message: 'Finished timer must be at zero' });
  }
});

export type KitchenTimer = z.infer<typeof timerSchema>;
export const kitchenSessionSchema = z.object({
  schemaVersion: z.literal(1),
  recipeId: uuid,
  recipeVersionId: uuid,
  currentStepId: uuid.nullable(),
  checkedIngredientIds: z.array(uuid).max(500),
  completedStepIds: z.array(uuid).max(300),
  servings: z.number().finite().positive().max(100_000),
  timers: z.array(timerSchema).max(8),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export type KitchenSession = z.infer<typeof kitchenSessionSchema>;
const sessionKey = (recipeId: string) => `kitchen-session-v1:${recipeId}`;

export function createKitchenSession(
  doc: RecipeEditableDocument, now = Date.now(),
): KitchenSession {
  return kitchenSessionSchema.parse({
    schemaVersion: 1,
    recipeId: doc.recipe.id,
    recipeVersionId: doc.version.id,
    currentStepId: [...doc.steps].sort((a, b) => a.position - b.position)[0]?.id ?? null,
    checkedIngredientIds: [],
    completedStepIds: [],
    servings: doc.version.servings ?? 2,
    timers: [],
    updatedAt: now,
  });
}

export function timerState(timer: KitchenTimer, now: number): KitchenTimer['status'] {
  if (timer.status === 'running' && timerSeconds(now, timer.deadlineAt, timer.remainingSeconds) === 0)
    return 'finished';
  return timer.status;
}

export function remainingTimerSeconds(timer: KitchenTimer, now: number): number {
  return timerState(timer, now) === 'finished'
    ? 0
    : timerSeconds(now, timer.deadlineAt, timer.remainingSeconds);
}

/** Restore only IDs that remain in the recipe, and finish expired timers. */
export function restoreKitchenSession(
  value: unknown,
  doc: RecipeEditableDocument,
  now = Date.now(),
): KitchenSession | null {
  const parsed = kitchenSessionSchema.safeParse(value);
  if (!parsed.success || parsed.data.recipeId !== doc.recipe.id) return null;
  if (doc.steps.length === 0) return null;

  const session = parsed.data;
  const ingredientIds = new Set(doc.ingredients.map((item) => item.id));
  const stepIds = new Set(doc.steps.map((item) => item.id));
  const validTimers = session.timers.map((timer) =>
    timerState(timer, now) === 'finished'
      ? { ...timer, status: 'finished' as const, deadlineAt: null, remainingSeconds: 0 }
      : timer,
  );
  const seen = new Set<string>();
  const timers = validTimers.filter(timer => {
    if (seen.has(timer.id)) return false;
    seen.add(timer.id);
    return true;
  });
  const steps = [...doc.steps].sort((a, b) => a.position - b.position);
  const currentStepId = session.currentStepId && stepIds.has(session.currentStepId)
    ? session.currentStepId
    : steps.find(step => !session.completedStepIds.includes(step.id))?.id ?? steps[0]?.id ?? null;
  const base = doc.version.servings;
  const servings = base !== null
    ? Math.min(base * 8, Math.max(base * 0.25, session.servings))
    : session.servings;

  return kitchenSessionSchema.parse({
    ...session,
    recipeVersionId: doc.version.id,
    currentStepId,
    checkedIngredientIds: [...new Set(session.checkedIngredientIds.filter(id => ingredientIds.has(id)))],
    completedStepIds: [...new Set(session.completedStepIds.filter(id => stepIds.has(id)))],
    servings,
    timers,
  });
}

export function startKitchenTimer(
  session: KitchenSession, label: string, durationSeconds: number,
  id: string, now: number,
): KitchenSession {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 43_200)
    throw new RangeError('Timer must be between 1 second and 12 hours.');
  if (session.timers.length >= 8) throw new RangeError('Up to eight timers can run at once.');
  const timer = timerSchema.parse({
    id, label: label.trim().slice(0, 80), durationSeconds,
    remainingSeconds: durationSeconds,
    deadlineAt: now + durationSeconds * 1000,
    status: 'running',
    createdAt: now,
  });
  return { ...session, timers: [...session.timers, timer], updatedAt: now };
}

export function pauseKitchenTimer(session: KitchenSession, id: string, now: number): KitchenSession {
  return {
    ...session,
    timers: session.timers.map(timer => {
      if (timer.id !== id || timer.status !== 'running') return timer;
      const remainingSeconds = remainingTimerSeconds(timer, now);
      return remainingSeconds === 0
        ? { ...timer, deadlineAt: null, remainingSeconds: 0, status: 'finished' as const }
        : { ...timer, deadlineAt: null, remainingSeconds, status: 'paused' as const };
    }),
    updatedAt: now,
  };
}

export function resumeKitchenTimer(session: KitchenSession, id: string, now: number): KitchenSession {
  return {
    ...session,
    timers: session.timers.map(timer =>
      timer.id === id && timer.status === 'paused' && timer.remainingSeconds > 0
        ? { ...timer, deadlineAt: now + timer.remainingSeconds * 1000, status: 'running' as const }
        : timer,
    ),
    updatedAt: now,
  };
}

export function dismissKitchenTimer(session: KitchenSession, id: string, now: number): KitchenSession {
  return { ...session, timers: session.timers.filter(timer => timer.id !== id), updatedAt: now };
}

export function updateKitchenSession(
  session: KitchenSession,
  patch: Partial<Pick<KitchenSession,
    'currentStepId' | 'checkedIngredientIds' | 'completedStepIds' | 'servings'>>,
  now: number,
): KitchenSession {
  return kitchenSessionSchema.parse({ ...session, ...patch, updatedAt: now });
}

/**
 * Session snapshots are device-local and account-scoped. Each recipe has its own
 * metadata row so saving a second cooking session never overwrites the first.
 * Writes per recipe are serialized to preserve the order of rapid user actions.
 */
export class KitchenSessionStore {
  readonly #db: Pick<RecipeLocalDb, 'getMeta' | 'setMeta'>;
  readonly #accountId: string;
  readonly #writes = new Map<string, Promise<void>>();

  constructor(db: Pick<RecipeLocalDb, 'getMeta' | 'setMeta'>, accountId: string) {
    this.#db = db;
    this.#accountId = accountId;
  }

  async load(record: LocalRecipeRecord, now = Date.now()): Promise<KitchenSession | null> {
    const resourceId = record.resourceId;
    await this.#writes.get(resourceId);
    const value = await this.#db.getMeta<unknown>(this.#accountId, sessionKey(resourceId));
    return restoreKitchenSession(value, record.working, now);
  }

  async list(records: readonly LocalRecipeRecord[], now = Date.now()): Promise<KitchenSession[]> {
    const sessions = await Promise.all(records.map(record => this.load(record, now)));
    return sessions.filter((item): item is KitchenSession => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  save(session: KitchenSession): Promise<void> {
    const value = kitchenSessionSchema.parse(session);
    const id = value.recipeId;
    const pending = (this.#writes.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.#db.setMeta(this.#accountId, sessionKey(id), value));
    this.#writes.set(id, pending);
    void pending.finally(() => {
      if (this.#writes.get(id) === pending) this.#writes.delete(id);
    }).catch(() => undefined);
    return pending;
  }

  clear(recipeId: string): Promise<void> {
    const pending = (this.#writes.get(recipeId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.#db.setMeta(this.#accountId, sessionKey(recipeId), null));
    this.#writes.set(recipeId, pending);
    void pending.finally(() => {
      if (this.#writes.get(recipeId) === pending) this.#writes.delete(recipeId);
    }).catch(() => undefined);
    return pending;
  }
}
