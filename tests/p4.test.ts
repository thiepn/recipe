import { describe, expect, it } from 'vitest';
import { legacyCookbookRedirect, sectionForPath, sectionPath } from '../src/ui/navigation.ts';

describe('P4 search-first cookbook navigation', () => {
  it('uses the cookbook as the primary root screen', () => {
    expect(sectionForPath('/')).toBe('recipes');
    expect(sectionPath('recipes')).toBe('/');
    expect(sectionForPath('/recipes')).toBe('recipes');
    expect(sectionForPath('/recipes/')).toBe('recipes');
  });

  it('preserves legacy bookmarks without leaving a second homepage', () => {
    expect(legacyCookbookRedirect('/recipes')).toBe('/');
    expect(legacyCookbookRedirect('/recipes/')).toBe('/');
    expect(legacyCookbookRedirect('/')).toBeNull();
    expect(legacyCookbookRedirect('/collections')).toBeNull();
    expect(legacyCookbookRedirect('/recipes/example-id')).toBeNull();
  });

  it('preserves independent collections, cook and plan routes', () => {
    expect(sectionForPath('/collections')).toBe('collections');
    expect(sectionForPath('/collections/family')).toBe('collections');
    expect(sectionForPath('/cook')).toBe('cook');
    expect(sectionForPath('/plan')).toBe('plan');
    expect(sectionPath('collections')).toBe('/collections');
    expect(sectionPath('cook')).toBe('/cook');
    expect(sectionPath('plan')).toBe('/plan');
  });

  it('falls back to cookbook for unknown paths without confusing prefixes', () => {
    expect(sectionForPath('/recipes-next')).toBe('recipes');
    expect(sectionForPath('/cookbook')).toBe('recipes');
    expect(sectionForPath('/planning')).toBe('recipes');
  });
});
