import { LayoutGrid, List } from 'lucide-react';

export type CookbookViewMode = 'grid' | 'list';

interface Props {
  value: CookbookViewMode;
  onChange: (next: CookbookViewMode) => void;
}

/** Presentation-only choice: never edits or syncs a recipe document. */
export function CookbookViewSwitch({ value, onChange }: Props) {
  return <div className="cookbook-view-switch" role="group" aria-label="Recipe result layout">
    <button type="button" className={value === 'grid' ? 'is-selected' : ''}
      aria-label="Grid view" aria-pressed={value === 'grid'} onClick={() => onChange('grid')}>
      <LayoutGrid size={17} aria-hidden="true" /><span>Grid</span>
    </button>
    <button type="button" className={value === 'list' ? 'is-selected' : ''}
      aria-label="List view" aria-pressed={value === 'list'} onClick={() => onChange('list')}>
      <List size={17} aria-hidden="true" /><span>List</span>
    </button>
  </div>;
}
