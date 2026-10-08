import {
  recipeEditableDocumentSchema,
  type RecipeEditableDocument,
} from '../api/protocol.ts';
import type { LocalRecipeRecord } from '../data/local-db.ts';
import { createBlankRecipe } from '../library/create.ts';

export type ImportKind = 'text' | 'website' | 'photo';
export type ExtractionMethod = 'schema-org' | 'text' | 'ocr';

export interface ImportDraft {
  kind: ImportKind;
  method: ExtractionMethod;
  title: string;
  description: string;
  ingredients: string[];
  steps: string[];
  servings: number | null;
  totalMinutes: number | null;
  sourceUrl: string | null;
  sourceName: string | null;
  originalText: string;
  warnings: string[];
}

export interface ImportSourceMetadata {
  schemaVersion: 1;
  kind: ImportKind;
  method: ExtractionMethod;
  url: string | null;
  filename: string | null;
  text: string;
  fingerprint: string;
  capturedAt: string;
  warnings: string[];
}

const MAX_INPUT = 75_000;
const MAX_PRESERVED_TEXT = 24_000;
const MAX_INGREDIENTS = 300;
const MAX_STEPS = 150;

function normalized(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function safeSourceUrl(value: string): string {
  const raw = value.trim();
  if (raw.length > 2048) throw new Error('Source URL is too long.');
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Use an HTTPS recipe URL.');
  if (url.username || url.password || url.port && url.port !== '443')
    throw new Error('URL credentials and nonstandard ports are not allowed.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.test') ||
      host === '0.0.0.0' || host === '[::1]' ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host.includes(':') || !host.includes('.'))
    throw new Error('Enter a public recipe website.');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && '@value' in value)
    return asText((value as { '@value': unknown })['@value']);
  return '';
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) && n > 0 && n < 100_000 ? n : null;
}

function durationMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^P(?:([0-9]+)D)?(?:T(?:([0-9]+)H)?(?:([0-9]+)M)?)?$/i.exec(value);
  if (!match) return null;
  const duration = Number(match[1] || 0) * 1440 +
    Number(match[2] || 0) * 60 + Number(match[3] || 0);
  return Number.isSafeInteger(duration) && duration > 0 ? duration : null;
}

function instructions(input: unknown): string[] {
  if (typeof input === 'string') return input.split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (!Array.isArray(input)) return [];
  return input.flatMap((value): string[] => {
    if (typeof value === 'string') return [value.trim()].filter(Boolean);
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (Array.isArray(item.itemListElement)) return instructions(item.itemListElement);
    const text = asText(item.text) || asText(item.name);
    return text ? [text] : [];
  });
}

function schemaObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(schemaObjects);
  if (!value || typeof value !== 'object') return [];
  const item = value as Record<string, unknown>;
  return [item, ...schemaObjects(item['@graph'])];
}

function recipeType(value: unknown): boolean {
  return (Array.isArray(value) ? value : [value]).some(
    type => typeof type === 'string' && /(^|[\\/#])Recipe$/i.test(type),
  );
}

function jsonLdCandidates(source: string): unknown[] {
  const chunks: string[] = [];
  // Accept pasted schema.org JSON, or text/HTML containing JSON-LD scripts.
  if (/^\s*[\[{]/.test(source)) chunks.push(source);
  const script = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of source.matchAll(script)) {
    if (match[1]) chunks.push(match[1]);
    if (chunks.length >= 25) break;
  }
  return chunks.flatMap(chunk => {
    try { return [JSON.parse(chunk)]; } catch { return []; }
  });
}

export function extractSchemaRecipe(source: string): ImportDraft | null {
  for (const root of jsonLdCandidates(source)) {
    for (const item of schemaObjects(root)) {
      if (!recipeType(item['@type'])) continue;
      const title = asText(item.name);
      const ingredients = Array.isArray(item.recipeIngredient)
        ? item.recipeIngredient.map(asText).filter(Boolean)
        : [];
      const steps = instructions(item.recipeInstructions);
      if (!title || ingredients.length === 0 || steps.length === 0) continue;
      const description = asText(item.description);
      let servings: number | null = null;
      const yieldValue = Array.isArray(item.recipeYield) ? item.recipeYield[0] : item.recipeYield;
      if (typeof yieldValue === 'string') servings = positiveInt(yieldValue.match(/\d+/)?.[0]);
      else servings = positiveInt(yieldValue);
      return {
        kind: 'website',
        method: 'schema-org',
        title: title.slice(0, 240),
        description: description.slice(0, 2000),
        ingredients: ingredients.slice(0, MAX_INGREDIENTS),
        steps: steps.slice(0, MAX_STEPS),
        servings,
        totalMinutes: durationMinutes(item.totalTime),
        sourceUrl: null,
        sourceName: null,
        originalText: source.slice(0, MAX_PRESERVED_TEXT),
        warnings: [],
      };
    }
  }
  return null;
}

function cleanLine(line: string): string {
  return line.trim().replace(/^[-*•]\s*/, '').replace(/^\d{1,3}[.)]\s+/, '').trim();
}

export function parsePlainRecipe(raw: string): ImportDraft {
  if (!raw.trim()) throw new Error('Paste recipe text first.');
  if (raw.length > MAX_INPUT) throw new Error('Recipe text is too long (75 KB maximum).');
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map(x => x.trim());
  const nonempty = lines.filter(Boolean);
  const title = (nonempty[0] || '').replace(/^#\s*/, '').slice(0, 240);
  const ingredients: string[] = [];
  const steps: string[] = [];
  let section: 'header' | 'ingredients' | 'steps' = 'header';
  let ingHeading = false;
  let stepsHeading = false;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index] || '';
    const header = line.replace(/[:：\s#]+$/g, '').trim().toLowerCase();
    if (/^(ingredients?|zutaten|재료|malzemeler)$/iu.test(header)) {
      section = 'ingredients'; ingHeading = true; continue;
    }
    if (/^(instructions?|directions?|method|steps?|preparation|zubereitung|anleitung|조리법|yapılışı|hazırlanışı)$/iu.test(header)) {
      section = 'steps'; stepsHeading = true; continue;
    }
    if (!line) continue;
    if (section === 'ingredients') ingredients.push(cleanLine(line));
    if (section === 'steps') steps.push(cleanLine(line));
  }
  const warnings: string[] = [];
  if (!ingHeading || ingredients.length === 0)
    warnings.push('Ingredients were not reliably identified. Add them manually before saving.');
  if (!stepsHeading || steps.length === 0)
    warnings.push('Instructions were not reliably identified. Add them manually before saving.');
  return {
    kind: 'text', method: 'text', title, description: '',
    ingredients: ingredients.slice(0, MAX_INGREDIENTS),
    steps: steps.slice(0, MAX_STEPS), servings: null, totalMinutes: null,
    sourceUrl: null, sourceName: null,
    originalText: raw.slice(0, MAX_PRESERVED_TEXT), warnings,
  };
}

export function parseRecipeImport(source: string, kind: ImportKind = 'text'): ImportDraft {
  if (!source.trim()) throw new Error('Provide recipe content to import.');
  if (source.length > MAX_INPUT) throw new Error('Recipe text is too long (75 KB maximum).');
  const structured = extractSchemaRecipe(source);
  if (structured) return { ...structured, kind };
  return { ...parsePlainRecipe(source), kind, method: kind === 'photo' ? 'ocr' : 'text' };
}

export function importPreviewValid(draft: ImportDraft): boolean {
  return draft.title.trim().length > 0 &&
    draft.title.trim().length <= 240 &&
    draft.ingredients.length > 0 && draft.ingredients.length <= MAX_INGREDIENTS &&
    draft.steps.length > 0 && draft.steps.length <= MAX_STEPS &&
    draft.ingredients.every(x => x.trim().length > 0 && x.trim().length <= 240) &&
    draft.steps.every(x => x.trim().length > 0 && x.trim().length <= 20_000);
}

function splitIngredient(line: string): { name: string; quantity: number | null; unit: string | null } {
  // Parse only unambiguous single quantities; leave ranges/fractions intact.
  const parsed = /^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|tbsp|tsp|el|tl|cups?|stücke?|pcs?)\s+(.+)$/i.exec(line.trim());
  if (!parsed) return { name: line.trim(), quantity: null, unit: null };
  const n = Number((parsed[1] || '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { name: line.trim(), quantity: null, unit: null };
  return { name: parsed[3]!.trim(), quantity: n, unit: parsed[2]!.toLowerCase() };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintImport(draft: ImportDraft): Promise<string> {
  const source = draft.sourceUrl
    ? `url:${safeSourceUrl(draft.sourceUrl)}`
    : `content:${normalized(draft.originalText || [
      draft.title, ...draft.ingredients, ...draft.steps,
    ].join('\n'))}`;
  return sha256(source);
}

export async function importDuplicateCandidates(
  draft: ImportDraft,
  records: readonly LocalRecipeRecord[],
): Promise<LocalRecipeRecord[]> {
  const fingerprint = await fingerprintImport(draft);
  const url = draft.sourceUrl ? safeSourceUrl(draft.sourceUrl) : null;
  return records.filter(record => {
    if (record.tombstone || record.working.recipe.state === 'archived') return false;
    const data = record.working.version.metadata.importSource;
    if (data && typeof data === 'object') {
      const meta = data as Record<string, unknown>;
      if (meta.fingerprint === fingerprint) return true;
      if (url && meta.url === url) return true;
    }
    const version = record.working.version;
    return normalized(version.title) === normalized(draft.title) &&
      record.working.ingredients.length > 0 &&
      normalized(record.working.ingredients.map(i => i.name).join('|')) ===
      normalized(draft.ingredients.map(i => splitIngredient(i).name).join('|'));
  });
}

export async function createImportedRecipe(
  draft: ImportDraft,
  options: { locale?: string; now?: () => Date; randomUUID?: () => string } = {},
): Promise<RecipeEditableDocument> {
  if (!importPreviewValid(draft)) throw new Error('Review title, ingredients and instructions before saving.');
  const base = createBlankRecipe(draft.title.trim(), {
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.randomUUID ? { randomUUID: options.randomUUID } : {}),
  });
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const source: ImportSourceMetadata = {
    schemaVersion: 1, kind: draft.kind, method: draft.method,
    url: draft.sourceUrl ? safeSourceUrl(draft.sourceUrl) : null,
    filename: draft.sourceName?.slice(0, 240) || null,
    text: draft.originalText.slice(0, MAX_PRESERVED_TEXT),
    fingerprint: await fingerprintImport(draft),
    capturedAt: (options.now?.() ?? new Date()).toISOString(),
    warnings: draft.warnings,
  };
  return recipeEditableDocumentSchema.parse({
    ...base,
    recipe: { ...base.recipe, state: 'draft' },
    version: {
      ...base.version,
      description: draft.description.trim().slice(0, 2000) || null,
      servings: draft.servings,
      totalMinutes: draft.totalMinutes,
      metadata: { ...base.version.metadata, importSource: source },
    },
    ingredients: draft.ingredients.map((line, index) => {
      const value = splitIngredient(line);
      return {
        id: randomUUID(), recipeVersionId: base.version.id, groupId: null,
        position: index, name: value.name, quantity: value.quantity,
        quantityMax: null, unit: value.unit, preparation: null, note: null,
        optional: false, scalingMode: 'linear', canonicalKey: null, metadata: {},
      };
    }),
    steps: draft.steps.map((instruction, index) => ({
      id: randomUUID(), recipeVersionId: base.version.id, position: index,
      title: null, instruction: instruction.trim(), durationSecondsMin: null,
      durationSecondsMax: null, timerLabel: null, temperatureC: null,
      temperatureDisplay: null, heatLevel: null, visualCue: null,
      donenessCue: null, techniqueKeys: [], isPassive: false,
      canParallelize: false, metadata: {},
    })),
  });
}

/**
 * Browser-only best-effort fetch: does not bypass CORS. Sites that block
 * cross-origin access must be imported by pasting their recipe text/JSON-LD.
 */
export async function fetchPublicRecipePage(urlValue: string): Promise<string> {
  const url = safeSourceUrl(urlValue);
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: 'GET', mode: 'cors', credentials: 'omit',
      redirect: 'error', signal: controller.signal,
      headers: { Accept: 'text/html,application/ld+json' },
    });
    if (!response.ok) throw new Error(`Recipe website returned HTTP ${response.status}.`);
    const type = response.headers.get('content-type') || '';
    if (!/html|json/i.test(type)) throw new Error('The URL does not return a recipe page.');
    if (Number(response.headers.get('content-length') || 0) > 512_000)
      throw new Error('Recipe page is too large. Paste the recipe text instead.');
    const text = await response.text();
    if (text.length > 512_000) throw new Error('Recipe page is too large.');
    return text;
  } finally {
    globalThis.clearTimeout(timer);
  }
}
