export type Section = 'recipes' | 'collections' | 'cook' | 'plan';

export function sectionForPath(path: string): Section {
  const normalized = path.split(/[?#]/, 1)[0] || '/';
  if (normalized === '/collections' || normalized.startsWith('/collections/')) return 'collections';
  if (normalized === '/cook' || normalized.startsWith('/cook/')) return 'cook';
  if (normalized === '/plan' || normalized.startsWith('/plan/')) return 'plan';
  return 'recipes';
}

export function sectionPath(section: Section): string {
  return section === 'recipes' ? '/' : `/${section}`;
}

export function legacyCookbookRedirect(path: string): string | null {
  return path === '/recipes' || path === '/recipes/' ? '/' : null;
}
