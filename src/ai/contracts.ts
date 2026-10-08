import { z } from 'zod';

export const localeSchema = z.enum(['en','de','ko']);
export const lunaDraftSchema = z.object({
  title:z.string().trim().min(1).max(240),
  description:z.string().max(1200),
  ingredients:z.array(z.string().trim().min(1).max(500)).min(1).max(60),
  steps:z.array(z.string().trim().min(1).max(2000)).min(1).max(40),
  servings:z.number().int().min(1).max(24).nullable(),
  totalMinutes:z.number().int().min(1).max(1440).nullable(),
  notes:z.array(z.string().trim().min(1).max(400)).max(8),
  uncertainties:z.array(z.string().trim().min(1).max(400)).max(12),
}).strict();
export const lunaHelpSchema = z.object({
  answer:z.string().trim().min(1).max(2400),
  cautions:z.array(z.string().trim().min(1).max(400)).max(6),
  suggestedChanges:z.array(z.string().trim().min(1).max(400)).max(6),
}).strict();
export const generateInputSchema = z.object({
  request:z.string().trim().min(3).max(600),
  availableIngredients:z.array(z.string().trim().min(1).max(100)).max(30),
  avoidIngredients:z.array(z.string().trim().min(1).max(100)).max(20),
  servings:z.number().int().min(1).max(12),
  language:localeSchema,
}).strict();
export const extractInputSchema=z.object({
  sourceText:z.string().trim().min(20).max(16_000),
  sourceKind:z.enum(['text','ocr']),
  language:localeSchema,
}).strict();
export const helpInputSchema=z.object({
  recipe:z.object({
    title:z.string().trim().min(1).max(240),
    ingredients:z.array(z.string().trim().min(1).max(400)).max(100),
    steps:z.array(z.string().trim().min(1).max(1500)).max(80),
  }).strict(),
  question:z.string().trim().min(3).max(900),
  language:localeSchema,
}).strict();

export type LunaDraft=z.infer<typeof lunaDraftSchema>;
export type LunaHelp=z.infer<typeof lunaHelpSchema>;
export type GenerateInput=z.input<typeof generateInputSchema>;
export type ExtractInput=z.input<typeof extractInputSchema>;
export type HelpInput=z.input<typeof helpInputSchema>;

export function uiLanguage(locale:string):z.infer<typeof localeSchema> {
 const base=locale.split('-')[0]?.toLowerCase();
 return base==='de'||base==='ko'?base:'en';
}

export function suggestedRecipeDraft(output:LunaDraft,mode:'generate'|'extract',sourceText='') {
 return {
  kind:'text' as const,
  method:'text' as const,
  title:output.title,
  description:output.description,
  ingredients:output.ingredients,
  steps:output.steps,
  servings:output.servings,
  totalMinutes:output.totalMinutes,
  sourceUrl:null,
  sourceName:null,
  originalText:sourceText || [output.title,...output.ingredients,...output.steps].join('\n'),
  warnings:[
   mode==='generate'
    ? 'Luna proposed this untested recipe. Review every ingredient and cooking instruction.'
    : 'Luna extracted this recipe from your source. Verify transcription and all amounts.',
   ...output.uncertainties,
   ...output.notes,
  ],
 };
}
