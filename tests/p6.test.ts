import { describe, expect, it } from 'vitest';
import {
  createImportedRecipe,
  extractSchemaRecipe,
  fingerprintImport,
  importDuplicateCandidates,
  importPreviewValid,
  parsePlainRecipe,
  parseRecipeImport,
  safeSourceUrl,
} from '../src/import/recipe-import.ts';
import type { LocalRecipeRecord } from '../src/data/local-db.ts';

const TEXT = `Kimchi Fried Rice
Ingredients
2 cups rice
1 tbsp sesame oil
2 eggs
Instructions
1. Heat the oil.
2. Fry the rice and add eggs.`;

describe('P6 deterministic import', () => {
  it('parses plain recipes into reviewable ingredient and step lists', () => {
    const draft = parsePlainRecipe(TEXT);
    expect(draft.title).toBe('Kimchi Fried Rice');
    expect(draft.ingredients).toEqual(['2 cups rice', '1 tbsp sesame oil', '2 eggs']);
    expect(draft.steps).toEqual(['Heat the oil.', 'Fry the rice and add eggs.']);
    expect(importPreviewValid(draft)).toBe(true);
  });

  it('handles German headings and warns rather than fabricating missing sections', () => {
    const german = parsePlainRecipe('Bratkartoffeln\nZutaten\nKartoffeln\nZubereitung\n1. Kartoffeln braten.');
    expect(german.ingredients).toEqual(['Kartoffeln']);
    expect(german.steps).toEqual(['Kartoffeln braten.']);
    const ambiguous = parsePlainRecipe('A soup\nWater\nHeat water');
    expect(ambiguous.ingredients).toEqual([]);
    expect(ambiguous.steps).toEqual([]);
    expect(ambiguous.warnings).toHaveLength(2);
    expect(importPreviewValid(ambiguous)).toBe(false);
  });

  it('extracts structured Recipe JSON-LD in an @graph with HowToStep entries', () => {
    const html = `<html><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Another object' },
        {
          '@type': 'Recipe',
          name: 'Spinach pasta',
          recipeIngredient: ['200 g pasta', '100 g spinach'],
          recipeInstructions: [
            { '@type': 'HowToStep', text: 'Boil the pasta.' },
            { '@type': 'HowToSection', itemListElement: [
              { '@type': 'HowToStep', text: 'Mix in the spinach.' },
            ] },
          ],
          totalTime: 'PT35M',
          recipeYield: '2 servings',
        },
      ],
    })}</script></html>`;
    const result = extractSchemaRecipe(html);
    expect(result).toMatchObject({
      title: 'Spinach pasta',
      ingredients: ['200 g pasta', '100 g spinach'],
      steps: ['Boil the pasta.', 'Mix in the spinach.'],
      totalMinutes: 35,
      servings: 2,
      method: 'schema-org',
    });
  });

  it('rejects unrelated metadata and invalid imports', () => {
    expect(extractSchemaRecipe(JSON.stringify({ '@type': 'WebPage', name: 'Fake' }))).toBeNull();
    expect(() => parseRecipeImport('')).toThrow();
    expect(() => parsePlainRecipe('a'.repeat(75_001))).toThrow();
    const empty = parsePlainRecipe('A recipe');
    expect(importPreviewValid(empty)).toBe(false);
  });

  it('blocks local URLs, credentials, unsafe protocols and tracking arguments', () => {
    for (const url of [
      'http://example.com/recipe', 'file:///etc/passwd',
      'https://localhost/recipe', 'https://127.0.0.1/secret',
      'https://[::1]/', 'https://user:pass@example.com/',
      'https://example.com:8443/', 'https://my-host.internal/',
    ]) {
      expect(() => safeSourceUrl(url)).toThrow();
    }
    expect(safeSourceUrl('https://example.com/pasta?utm_source=x&id=2#ingredients'))
      .toBe('https://example.com/pasta?id=2');
  });

  it('turns reviewed input into a schema-valid, attributable private recipe draft', async () => {
    const parsed = parseRecipeImport(TEXT);
    const doc = await createImportedRecipe(parsed);
    expect(doc.recipe.state).toBe('draft');
    expect(doc.ingredients).toHaveLength(3);
    expect(doc.ingredients[0]).toMatchObject({ name: 'rice', quantity: 2, unit: 'cups' });
    expect(doc.steps).toHaveLength(2);
    expect(doc.steps[0]?.recipeVersionId).toBe(doc.version.id);
    expect(doc.version.metadata.importSource).toMatchObject({
      kind: 'text',
      method: 'text',
      text: TEXT,
    });
  });

  it('detects identical source fingerprints without blocking different recipes', async () => {
    const parsed = parseRecipeImport(TEXT);
    const doc = await createImportedRecipe(parsed);
    const record: LocalRecipeRecord = {
      accountId: '11111111-1111-4111-8111-111111111111',
      resourceId: doc.recipe.id, working: doc, base: null,
      serverRevision: 0, localRevision: 1, syncState: 'pending',
      tombstone: false, updatedAt: 1,
    };
    expect((await importDuplicateCandidates(parsed, [record])).map(r => r.resourceId))
      .toEqual([doc.recipe.id]);
    expect(await importDuplicateCandidates(parsePlainRecipe('New Soup\nIngredients\nwater\nInstructions\nBoil.'), [record]))
      .toEqual([]);
    expect(await fingerprintImport(parsed)).toBe((doc.version.metadata.importSource as { fingerprint: string }).fingerprint);
  });

  it('detects repeated URL imports independently of copied page text', async () => {
    const a = { ...parsePlainRecipe(TEXT), kind: 'website' as const, sourceUrl: 'https://example.com/recipe?utm_source=abc' };
    const b = { ...a, originalText: 'same recipe with updated source', sourceUrl: 'https://example.com/recipe' };
    expect(await fingerprintImport(a)).toBe(await fingerprintImport(b));
  });
});
