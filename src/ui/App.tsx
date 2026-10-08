import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BookOpen,
  Check,
  ChefHat,
  ChevronRight,
  CircleAlert,
  Clock3,
  Cloud,
  CloudOff,
  FolderHeart,
  Heart,
  LibraryBig,
  ListFilter,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShoppingBasket,
  Sparkles,
  TimerReset,
  Utensils,
  WifiOff,
  X,
} from 'lucide-react';
import {
  createRecipeAuthClient,
  getRecipeAccessToken,
  getStartupRecipeIdentity,
  handleRecipeAuthCallback,
  signInWithGoogle,
  signOutRecipe,
  UnsyncedChangesError,
  UnsyncedWorkspaceError,
} from '../auth/account.ts';
import { RecipeCoreApi } from '../api/core.ts';
import type { RecipeEditableCollectionBook } from '../api/protocol.ts';
import {
  EMPTY_COLLECTION_BOOK,
  createCollection,
  removeCollection,
  renameCollection,
  setRecipeInCollection,
} from '../library/collections.ts';
import { createBlankRecipe } from '../library/create.ts';
import { createImportedRecipe, importDuplicateCandidates, type ImportDraft, type ImportKind } from '../import/recipe-import.ts';
import { ImportSheet } from './ImportSheet.tsx';
import { RecipeStudio } from './RecipeStudio.tsx';
import { CookWorkspace } from './CookWorkspace.tsx';
import { RecipeWorkspaceSync, type WorkspaceConflict } from '../workspace/sync.ts';
import { MealPlanner } from './MealPlanner.tsx';
import { LunaSheet } from './LunaSheet.tsx';
import { uiLanguage } from '../ai/contracts.ts';
import {
  EMPTY_PANTRY,
  addIngredients,
  cleanPantry,
  ingredientSuggestions,
  rankByPantry,
  removeIngredient,
  type MissingLimit,
  type PantryDocument,
  type RecipeCoverage,
} from '../library/ingredients.ts';
import {
  collectionCards,
  filterRecipes,
  recipeCardFromLocal,
  type RecipeLibraryFilters,
} from '../library/model.ts';
import {
  RecipeLocalDb,
  type LocalCollectionBookRecord,
  type LocalRecipeRecord,
} from '../data/local-db.ts';
import { CollectionSyncEngine } from '../sync/collection-sync.ts';
import { RecipeSyncEngine } from '../sync/recipe-sync.ts';
import { legacyCookbookRedirect, sectionForPath, sectionPath, type Section } from './navigation.ts';
import './styles.css';

interface Runtime {
  accountId: string;
  db: RecipeLocalDb;
  api: RecipeCoreApi;
  recipeSync: RecipeSyncEngine;
  collectionSync: CollectionSyncEngine;
  workspaceSync: RecipeWorkspaceSync | null;
  authClient: ReturnType<typeof createRecipeAuthClient>;
}

interface LibraryState {
  recipes: LocalRecipeRecord[];
  collectionBook: LocalCollectionBookRecord | undefined;
  recipeConflicts: number;
  collectionConflicts: number;
}

const LUNA_ENABLED = import.meta.env.VITE_RECIPE_LUNA_ENABLED === 'staged-v1';
const WORKSPACE_SYNC_ENABLED = import.meta.env.VITE_RECIPE_WORKSPACE_SYNC === 'qualified-v1';

const EMPTY_LIBRARY: LibraryState = {
  recipes: [],
  collectionBook: undefined,
  recipeConflicts: 0,
  collectionConflicts: 0,
};

function env(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value || value.includes('REPLACE_ME') || value.includes('YOUR_'))
    throw new Error(`Missing ${name}`);
  return value;
}

function initialSection(): Section {
  return sectionForPath(globalThis.location?.pathname ?? '/');
}

function hueFor(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return 18 + (hash % 310);
}

function recipeStyle(title: string) {
  const hue = hueFor(title);
  return {
    '--recipe-hue': String(hue),
    '--recipe-hue-2': String((hue + 42) % 360),
  } as CSSProperties;
}

function durationLabel(minutes: number | null): string {
  if (minutes === null) return 'Time not set';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ');
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-button ${active ? 'is-active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      type="button"
    >
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}


function EmptyCookbook({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="cookbook-empty" aria-labelledby="empty-cookbook-title">
      <div className="cookbook-empty-icon" aria-hidden="true">
        <BookOpen size={30} strokeWidth={1.5} />
      </div>
      <div>
        <h2 id="empty-cookbook-title">No recipes saved yet</h2>
        <p>Your private cookbook will appear here. Start with a recipe you already know; import from a link, a photo, or pasted recipe text.</p>
        <button type="button" className="button button-primary" onClick={onAdd}>
          <Plus size={17} /> Create a recipe
        </button>
      </div>
    </section>
  );
}

function RecipeCard({
  record,
  onOpen,
  onFavorite,
  onCollections,
  coverage,
}: {
  record: LocalRecipeRecord;
  onOpen: () => void;
  onFavorite: () => void;
  onCollections: () => void;
  coverage?: RecipeCoverage | null;
}) {
  const recipe = recipeCardFromLocal(record);
  return (
    <article
      className="recipe-card"
      style={recipeStyle(recipe.title)}
    >
      <button className="recipe-card-open-target" type="button" onClick={onOpen} aria-label={`Open ${recipe.title}`} />
      <div className="recipe-card-visual">
        <div className="food-mark" aria-hidden="true">
          <Utensils size={30} strokeWidth={1.45} />
        </div>
        <button
          className={`icon-button card-heart ${recipe.favorite ? 'is-favorite' : ''}`}
          aria-label={recipe.favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={(event) => {
            event.stopPropagation();
            onFavorite();
          }}
          type="button"
        >
          <Heart size={19} fill={recipe.favorite ? 'currentColor' : 'none'} />
        </button>
        {recipe.syncState !== 'synced' && (
          <span className={`sync-pill sync-${recipe.syncState}`}>
            {recipe.syncState === 'pending' && <Cloud size={13} />}
            {recipe.syncState === 'conflict' && <CircleAlert size={13} />}
            {recipe.syncState === 'error' && <CloudOff size={13} />}
            {capitalize(recipe.syncState)}
          </span>
        )}
      </div>
      <div className="recipe-card-body">
        <div className="recipe-card-heading">
          <div>
            <h3>{recipe.title}</h3>
            {recipe.description && <p>{recipe.description}</p>}
          </div>
          <button
            className="icon-button subtle"
            aria-label="Choose collection"
            onClick={(event) => {
              event.stopPropagation();
              onCollections();
            }}
            type="button"
          >
            <FolderHeart size={18} />
          </button>
        </div>
        <div className="recipe-meta">
          <span>
            <Clock3 size={15} /> {durationLabel(recipe.totalMinutes)}
          </span>
          <span>{capitalize(recipe.difficulty)}</span>
          {recipe.servings !== null && (
            <span>
              {recipe.servings} {recipe.servingUnit ?? 'servings'}
            </span>
          )}
        </div>
        {recipe.tags.length > 0 && (
          <div className="tag-row">
            {recipe.tags.slice(0, 3).map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
        {coverage && (
          <div className="ingredient-coverage" aria-label="Ingredient availability">
            {coverage.status === 'unknown' ? (
              <span className="coverage-unknown">Ingredient list incomplete</span>
            ) : coverage.missing.length === 0 ? (
              <span className="coverage-complete"><Check size={14} /> All {coverage.required} required types covered</span>
            ) : (
              <>
                <span className="coverage-partial">
                  {coverage.missing.length} missing · {coverage.available}/{coverage.required} covered
                </span>
                <span className="coverage-missing" title={coverage.missing.join(', ')}>
                  Missing: {coverage.missing.join(', ')}
                </span>
              </>
            )}
            {coverage.status === 'measured' && coverage.assumed.length > 0 && (
              <span className="coverage-assumed">Assumed: {coverage.assumed.join(', ')}</span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function AddSheet({
  open,
  onClose,
  onCreate,
  onImport,
  onGenerate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string) => Promise<void>;
  onImport: (kind: ImportKind) => void;
  onGenerate?: (() => void) | undefined;
}) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="sheet add-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-grabber" />
        <div className="sheet-header">
          <div>
            <p className="eyebrow">Capture</p>
            <h2 id="add-title">Add a recipe</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={21} />
          </button>
        </div>
        <div className="capture-grid">
          <button className="capture-option is-ready" type="button">
            <BookOpen size={22} />
            <span>
              <strong>Blank recipe</strong>
              <small>Start with a title now</small>
            </span>
          </button>
          <button className="capture-option is-ready" type="button" onClick={() => onImport('website')}>
            <Sparkles size={22} />
            <span><strong>Import from URL</strong><small>Structured recipe sites</small></span>
          </button>
          <button className="capture-option is-ready" type="button" onClick={() => onImport('photo')}>
            <ChefHat size={22} />
            <span><strong>Photo or screenshot</strong><small>Extract text on this device</small></span>
          </button>
          <button className="capture-option is-ready" type="button" onClick={() => onImport('text')}>
            <TimerReset size={22} />
            <span><strong>Paste recipe text</strong><small>Ingredients and steps</small></span>
          </button>
          {onGenerate && <button className="capture-option is-ready" type="button" onClick={onGenerate}>
            <Sparkles size={22} />
            <span><strong>Suggest with Luna</strong><small>Optional AI · review before saving</small></span>
          </button>}
        </div>
        <form
          className="blank-recipe-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!title.trim() || saving) return;
            setSaving(true);
            try {
              await onCreate(title);
              onClose();
            } finally {
              setSaving(false);
            }
          }}
        >
          <label htmlFor="recipe-title">Recipe title</label>
          <div className="inline-entry">
            <input
              id="recipe-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Mom's kimchi jjigae"
              autoFocus
            />
            <button
              className="button button-primary"
              disabled={!title.trim() || saving}
            >
              {saving ? 'Saving…' : 'Create'}
            </button>
          </div>
          <p>
            This creates a private draft. Ingredients and guided editing arrive
            in the next recipe-authoring phase.
          </p>
        </form>
      </section>
    </div>
  );
}

function CollectionPicker({
  recipeId,
  book,
  onChange,
  onClose,
}: {
  recipeId: string;
  book: RecipeEditableCollectionBook;
  onChange: (book: RecipeEditableCollectionBook) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="sheet compact-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-header">
          <div>
            <p className="eyebrow">Organize</p>
            <h2 id="collection-picker-title">Save to collection</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={21} />
          </button>
        </div>
        {book.collections.length === 0 ? (
          <p className="muted">
            Create a collection first, then you can organize this recipe.
          </p>
        ) : (
          <div className="check-list">
            {book.collections.map((collection) => {
              const checked = collection.recipeIds.includes(recipeId);
              return (
                <label key={collection.id} className="check-row">
                  <span>
                    <FolderHeart size={18} />
                    {collection.name}
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={async (event) => {
                      await onChange(
                        setRecipeInCollection(
                          book,
                          collection.id,
                          recipeId,
                          event.target.checked,
                        ),
                      );
                    }}
                  />
                </label>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function RecipeDetail({
  record,
  collections,
  onClose,
  onFavorite,
  onCollections,
  onEdit,
  onCook,
  onAsk,
}: {
  record: LocalRecipeRecord;
  collections: string[];
  onClose: () => void;
  onFavorite: () => void;
  onCollections: () => void;
  onEdit: () => void;
  onCook: () => void;
  onAsk?: (() => void) | undefined;
}) {
  const recipe = recipeCardFromLocal(record);
  const doc = record.working;

  return (
    <div className="detail-layer" role="presentation" onMouseDown={onClose}>
      <article
        className="recipe-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="detail-hero" style={recipeStyle(recipe.title)}>
          <button className="icon-button detail-close" onClick={onClose}>
            <X size={21} />
          </button>
          <div className="detail-hero-mark">
            <Utensils size={48} strokeWidth={1.25} />
          </div>
        </div>
        <div className="detail-body">
          <div className="detail-heading">
            <div>
              <p className="eyebrow">
                {doc.recipe.state === 'draft' ? 'Draft recipe' : 'Recipe'}
              </p>
              <h1 id="recipe-detail-title">{recipe.title}</h1>
              {recipe.description && <p>{recipe.description}</p>}
            </div>
            <button
              className={`icon-button favorite-large ${recipe.favorite ? 'is-favorite' : ''}`}
              onClick={onFavorite}
              aria-label="Toggle favorite"
            >
              <Heart size={23} fill={recipe.favorite ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className="detail-stat-row">
            <span>
              <Clock3 size={17} />
              <strong>{durationLabel(recipe.totalMinutes)}</strong>
              <small>Total</small>
            </span>
            <span>
              <ChefHat size={17} />
              <strong>{capitalize(recipe.difficulty)}</strong>
              <small>Difficulty</small>
            </span>
            <span>
              <LibraryBig size={17} />
              <strong>{doc.ingredients.length}</strong>
              <small>Ingredients</small>
            </span>
          </div>

          {collections.length > 0 && (
            <div className="detail-collections">
              {collections.map((collection) => (
                <span key={collection}>{collection}</span>
              ))}
            </div>
          )}

          <div className="recipe-detail-actions">
            {doc.steps.length>0&&<button className="button button-primary" onClick={onCook}>
              <ChefHat size={18}/> Start cooking
            </button>}
            <button className="button button-secondary" onClick={onEdit}>
              <Pencil size={18}/> Edit recipe
            </button>
            <button className="button button-secondary" onClick={onCollections}>
              <FolderHeart size={18} /> Organize
            </button>
            {onAsk && <button className="button button-secondary" onClick={onAsk}>
              <Sparkles size={18}/> Ask Luna
            </button>}
          </div>

          <section className="detail-section">
            <div className="section-heading">
              <h2>Ingredients</h2>
              <span>{doc.ingredients.length}</span>
            </div>
            {doc.ingredients.length === 0 ? (
              <p className="detail-empty">
                No ingredients yet. Choose Edit recipe to add them.
              </p>
            ) : (
              <ul className="ingredient-list">
                {doc.ingredients.map((ingredient) => (
                  <li key={ingredient.id}>
                    <span className="ingredient-amount">
                      {ingredient.quantity ?? ''}
                      {ingredient.quantityMax !== null
                        ? `–${ingredient.quantityMax}`
                        : ''}{' '}
                      {ingredient.unit ?? ''}
                    </span>
                    <span>
                      {ingredient.name}
                      {ingredient.preparation ? `, ${ingredient.preparation}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="detail-section">
            <div className="section-heading">
              <h2>Method</h2>
              <span>{doc.steps.length}</span>
            </div>
            {doc.steps.length === 0 ? (
              <p className="detail-empty">
                No cooking steps yet. Choose Edit recipe to write them.
              </p>
            ) : (
              <ol className="step-list">
                {doc.steps.map((step, index) => (
                  <li key={step.id}>
                    <span className="step-number">{index + 1}</span>
                    <div>
                      {step.title && <strong>{step.title}</strong>}
                      <p>{step.instruction}</p>
                      {step.durationSecondsMin !== null && (
                        <small>
                          <Clock3 size={14} />
                          {Math.ceil(step.durationSecondsMin / 60)} min
                        </small>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </article>
    </div>
  );
}

function ComingSoon({
  icon,
  eyebrow,
  title,
  copy,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <section className="coming-soon">
      <div className="coming-icon">{icon}</div>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{copy}</p>
      <span>Foundation reserved in the product shell</span>
    </section>
  );
}

export default function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [bootState, setBootState] = useState<
    'loading' | 'signed-out' | 'ready' | 'config-error'
  >('loading');
  const [bootError, setBootError] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryState>(EMPTY_LIBRARY);
  const [section, setSection] = useState<Section>(initialSection);
  const [addOpen, setAddOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportKind>('text');
  const [importOpen, setImportOpen] = useState(false);
  const [lunaOpen, setLunaOpen] = useState(false);
  const [lunaMode, setLunaMode] = useState<'generate'|'help'>('generate');
  const [lunaRecipeContext, setLunaRecipeContext] = useState<LocalRecipeRecord | null>(null);
  const openGenerate = () => {
    setAddOpen(false);setLunaMode('generate');setLunaRecipeContext(null);setLunaOpen(true);
  };
  const openHelp = (record: LocalRecipeRecord) => {
    setSelectedRecipeId(null);
    setLunaMode('help');setLunaRecipeContext(record);setLunaOpen(true);
  };
  const openImporter = (mode: ImportKind) => {
    setAddOpen(false);
    setImportMode(mode);
    setImportOpen(true);
  };
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [cookingRecipeId, setCookingRecipeId] = useState<string | null>(null);
  const [collectionRecipeId, setCollectionRecipeId] = useState<string | null>(
    null,
  );
  const [collectionDialog, setCollectionDialog] = useState<
    null | { mode: 'create' } | { mode: 'rename'; id: string; name: string }
  >(null);
  const [toast, setToast] = useState<string | null>(null);
  const [signOutLocalWarning, setSignOutLocalWarning] = useState<number | null>(null);
  const [discardingLocalData, setDiscardingLocalData] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [workspaceConflicts, setWorkspaceConflicts] = useState<WorkspaceConflict[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<'disabled'|'ready'|'offline'|'conflict'>(
    WORKSPACE_SYNC_ENABLED?'offline':'disabled'
  );
  const [resolvingWorkspace, setResolvingWorkspace] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [pantry, setPantry] = useState<PantryDocument>(EMPTY_PANTRY);
  const [pantryText, setPantryText] = useState('');
  const [missingLimit, setMissingLimit] = useState<MissingLimit>('any');
  const pantryWrites = useRef<Promise<void>>(Promise.resolve());
  const [filters, setFilters] = useState<RecipeLibraryFilters>({
    query: '',
    favoritesOnly: false,
    underThirtyMinutes: false,
    difficulty: 'all',
    collectionId: null,
    sort: 'recent',
  });
  const resetFilters = () => {
    setFilters({
      query: '',
      favoritesOnly: false,
      underThirtyMinutes: false,
      difficulty: 'all',
      collectionId: null,
      sort: pantry.ingredients.length ? 'match' : 'recent',
    });
    setMissingLimit('any');
  };
  const hasActiveFilters = Boolean(
    filters.query.trim() || filters.favoritesOnly || filters.underThirtyMinutes ||
    filters.difficulty !== 'all' || filters.collectionId ||
    (pantry.ingredients.length > 0 && missingLimit !== 'any'),
  );

  const savePantry = (next: PantryDocument) => {
    if (!runtime) return;
    setPantry(next);
    if (next.ingredients.length === 0) {
      setMissingLimit('any');
      setFilters((current) => ({ ...current, sort: current.sort === 'match' ? 'recent' : current.sort }));
    }
    const { accountId, db } = runtime;
    pantryWrites.current = pantryWrites.current
      .catch(() => undefined)
      .then(() => db.setMeta(accountId, 'pantry-v1', next));
    void pantryWrites.current.catch(() => setToast('Could not save your ingredient list on this device.'));
  };

  const addPantryText = (raw: string) => {
    const next = addIngredients(pantry, raw);
    if (next.ingredients.length === pantry.ingredients.length) return;
    savePantry(next);
    setPantryText('');
    setFilters((current) => ({ ...current, sort: 'match' }));
  };

  const removePantryItem = (name: string) => savePantry(removeIngredient(pantry, name));

  const reload = useCallback(async (activeRuntime: Runtime) => {
    const [recipes, collectionBook, recipeConflicts, collectionConflicts] =
      await Promise.all([
        activeRuntime.db.listDocuments(activeRuntime.accountId),
        activeRuntime.db.getCollectionBook(activeRuntime.accountId),
        activeRuntime.db.listConflicts(activeRuntime.accountId),
        activeRuntime.db.listCollectionConflicts(activeRuntime.accountId),
      ]);
    setLibrary({
      recipes,
      collectionBook,
      recipeConflicts: recipeConflicts.length,
      collectionConflicts: collectionConflicts.length,
    });
  }, []);

  const sync = useCallback(
    async (activeRuntime = runtime) => {
      if (!activeRuntime || syncing) return;
      setSyncing(true);
      try {
        await Promise.all([
          activeRuntime.recipeSync.syncOnce(),
          activeRuntime.collectionSync.syncOnce(),
        ]);
        if(activeRuntime.workspaceSync){
          try{
            const report=await activeRuntime.workspaceSync.syncOnce();
            setWorkspaceConflicts(report.conflicts);
            setWorkspaceStatus(report.conflicts.length?'conflict':'ready');
            if(report.pulled>0)
              globalThis.dispatchEvent(new Event('recipe:workspace-changed'));
          }catch{
            setWorkspaceStatus('offline');
            setToast('Recipe workspace cloud is unavailable. Local edits are retained.');
          }
        }
        await reload(activeRuntime);
      } catch {
        setToast('Cloud sync is unavailable. Local changes remain safe.');
      } finally {
        setSyncing(false);
      }
    },
    [reload, runtime, syncing],
  );

  useEffect(() => {
    let cancelled = false;
    let activeDb: RecipeLocalDb | null = null;

    void (async () => {
      try {
        const accountUrl = env('VITE_THIEPN_ACCOUNT_URL');
        const accountPublishableKey = env(
          'VITE_THIEPN_ACCOUNT_PUBLISHABLE_KEY',
        );
        const coreUrl = env('VITE_THIEPN_CORE_URL');
        const authClient = createRecipeAuthClient({
          accountUrl,
          accountPublishableKey,
        });

        if (globalThis.location.pathname === '/auth/callback') {
          const result = await handleRecipeAuthCallback(authClient);
          globalThis.history.replaceState(null, '', result.returnTo);
          setSection(initialSection());
        }

        // Only absence of a saved session means signed out. Network, token
        // refresh and Account verification failures must remain recoverable
        // startup errors instead of incorrectly prompting for Google login.
        const identity = await getStartupRecipeIdentity(authClient);
        if (!identity) {
          if (!cancelled) setBootState('signed-out');
          return;
        }

        const db = await RecipeLocalDb.open();
        activeDb = db;
        // React StrictMode can clean up a boot effect while IndexedDB is opening.
        // Close the late handle rather than launching a second orphan sync engine.
        if (cancelled) {
          db.close();
          activeDb = null;
          return;
        }
        const api = new RecipeCoreApi({
          baseUrl: coreUrl,
          getAccessToken: () => getRecipeAccessToken(authClient),
        });
        const recipeSync = new RecipeSyncEngine({
          accountId: identity.userId,
          db,
          api,
        });
        const collectionSync = new CollectionSyncEngine({
          accountId: identity.userId,
          db,
          api,
        });
        const nextRuntime: Runtime = {
          accountId: identity.userId,
          db,
          api,
          recipeSync,
          collectionSync,
          workspaceSync:WORKSPACE_SYNC_ENABLED?
            new RecipeWorkspaceSync(db,api,identity.userId):null,
          authClient,
        };

        await reload(nextRuntime);
        const savedPantry = cleanPantry(await db.getMeta<unknown>(identity.userId, 'pantry-v1'));
        if (!cancelled) {
          setPantry(savedPantry);
          if (savedPantry.ingredients.length > 0) {
            setFilters((current) => ({ ...current, sort: 'match' }));
          }
          setRuntime(nextRuntime);
          setBootState('ready');
        }

        void Promise.all([
          recipeSync.syncOnce(),
          collectionSync.syncOnce(),
        ])
          .then(async()=>{
            if(nextRuntime.workspaceSync){
              try{
                const result=await nextRuntime.workspaceSync.syncOnce();
                if(!cancelled){
                  setWorkspaceConflicts(result.conflicts);
                  setWorkspaceStatus(result.conflicts.length?'conflict':'ready');
                  if(result.pulled>0)globalThis.dispatchEvent(new Event('recipe:workspace-changed'));
                }
              }catch{
                if(!cancelled)setWorkspaceStatus('offline');
              }
            }
            if(!cancelled)await reload(nextRuntime);
          })
          .catch(() => undefined);
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : 'Startup failed');
          setBootState('config-error');
        }
      }
    })();

    return () => {
      cancelled = true;
      activeDb?.close();
    };
  }, [reload]);

  useEffect(() => {
    // Keep the previous /recipes deep link functional, but make / canonical.
    const redirect = legacyCookbookRedirect(globalThis.location.pathname);
    if (redirect) {
      globalThis.history.replaceState(null, '', redirect + globalThis.location.search + globalThis.location.hash);
    }
    const onPop = () => setSection(initialSection());
    globalThis.addEventListener('popstate', onPop);
    return () => globalThis.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!runtime) return;
    const onOnline = () => void sync(runtime);
    globalThis.addEventListener('online', onOnline);
    const timer = globalThis.setInterval(() => void sync(runtime), 30_000);
    const onFocus=()=>{if(document.visibilityState==='visible')void sync(runtime);};
    document.addEventListener('visibilitychange',onFocus);
    return () => {
      globalThis.removeEventListener('online', onOnline);
      globalThis.clearInterval(timer);
      document.removeEventListener('visibilitychange',onFocus);
    };
  }, [runtime, sync]);

  const navigate = (next: Section) => {
    setSection(next);
    setMobileMenu(false);
    globalThis.history.pushState(null, '', sectionPath(next));
  };

  const activeRecipes = useMemo(
    () =>
      library.recipes.filter(
        (record) => !record.tombstone && record.working.recipe.state !== 'archived',
      ),
    [library.recipes],
  );
  const collections = useMemo(
    () => collectionCards(library.collectionBook),
    [library.collectionBook],
  );
  const visibleRecipes = useMemo(
    () => filterRecipes(activeRecipes, library.collectionBook, filters),
    [activeRecipes, filters, library.collectionBook],
  );
  const rankedRecipes = useMemo(
    () => rankByPantry(visibleRecipes, activeRecipes, pantry, {
      maxMissing: missingLimit,
      sortByMatch: filters.sort === 'match',
    }),
    [visibleRecipes, activeRecipes, pantry, missingLimit, filters.sort],
  );
  const pantrySuggestions = useMemo(
    () => ingredientSuggestions(activeRecipes, pantryText, pantry.ingredients),
    [activeRecipes, pantryText, pantry.ingredients],
  );
  const selectedRecipe = selectedRecipeId
    ? library.recipes.find((recipe) => recipe.resourceId === selectedRecipeId)
    : undefined;
  const editingRecipe = editingRecipeId
    ? library.recipes.find((recipe) => recipe.resourceId === editingRecipeId)
    : undefined;
  const beginCooking = (record: LocalRecipeRecord) => {
    setSelectedRecipeId(null);
    setCookingRecipeId(record.resourceId);
    navigate('cook');
  };
  const editRecipe = (record: LocalRecipeRecord) => {
    setSelectedRecipeId(null);
    setEditingRecipeId(record.resourceId);
  };
  const closeStudio = () => {
    if(editingRecipeId) setSelectedRecipeId(editingRecipeId);
    setEditingRecipeId(null);
  };
  const editableBook =
    library.collectionBook?.working ?? EMPTY_COLLECTION_BOOK;

  const updateRecipe = async (
    record: LocalRecipeRecord,
    transform: (current: LocalRecipeRecord['working']) => LocalRecipeRecord['working'],
  ) => {
    if (!runtime) return;
    await runtime.recipeSync.stageReplace(transform(record.working));
    await reload(runtime);
    void sync(runtime);
  };

  const saveImportedDraft = async (draft: ImportDraft, allowDuplicate: boolean): Promise<'saved'|'duplicate'> => {
    if (!runtime) throw new Error('Sign in before saving a recipe.');
    const duplicates = await importDuplicateCandidates(draft, library.recipes);
    if (duplicates.length > 0 && !allowDuplicate) return 'duplicate';
    const document = await createImportedRecipe(draft, { locale: navigator.language });
    await runtime.recipeSync.stageCreate(document);
    await reload(runtime);
    setSelectedRecipeId(document.recipe.id);
    void sync(runtime);
    return 'saved';
  };

  const updateCollections = async (book: RecipeEditableCollectionBook) => {
    if (!runtime) return;
    await runtime.collectionSync.stageReplace(book);
    await reload(runtime);
    void sync(runtime);
  };

  const collectionNamesForRecipe = (recipeId: string) =>
    collections
      .filter((collection) => collection.recipeIds.includes(recipeId))
      .map((collection) => collection.name);

  if (bootState === 'loading') {
    return (
      <main className="boot-screen">
        <div className="brand-mark"><ChefHat size={26} /></div>
        <span className="loading-dot" />
        <p>Opening your cookbook…</p>
      </main>
    );
  }

  if (bootState === 'config-error') {
    return (
      <main className="boot-screen">
        <div className="brand-mark warning"><CircleAlert size={26} /></div>
        <h1>Could not open Recipe</h1>
        <p>{bootError}</p>
        <p className="auth-copy">This error has not cleared your locally saved recipes. Check your connection and try again. If this persists, verify the Account and Core configuration.</p>
        <button className="button button-primary" type="button" onClick={() => globalThis.location.reload()}>
          Retry opening Recipe
        </button>
      </main>
    );
  }

  if (bootState === 'signed-out') {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <div className="brand-lockup">
            <div className="brand-mark"><ChefHat size={25} /></div>
            <span>Recipe</span>
          </div>
          <p className="eyebrow">Your private cookbook</p>
          <h1>Every recipe worth keeping, finally kept.</h1>
          <p className="auth-copy">
            Save family recipes, things you discover, and your own versions.
            Recipe will later guide you through cooking them without losing the
            story or source.
          </p>
          <button
            className="button button-primary button-large full-width"
            onClick={async () => {
              try {
                const authClient = createRecipeAuthClient({
                  accountUrl: env('VITE_THIEPN_ACCOUNT_URL'),
                  accountPublishableKey: env(
                    'VITE_THIEPN_ACCOUNT_PUBLISHABLE_KEY',
                  ),
                });
                await signInWithGoogle(authClient, { returnTo: '/' });
              } catch (error) {
                setToast(error instanceof Error ? error.message : 'Sign-in failed');
              }
            }}
          >
            Continue with Google
          </button>
          <small>Recipes are private by default.</small>
        </section>
        <div className="auth-art" aria-hidden="true">
          <div className="auth-plate plate-a" />
          <div className="auth-plate plate-b" />
          <div className="auth-plate plate-c" />
          <Utensils size={72} strokeWidth={1.05} />
        </div>
        {toast && <div className="toast">{toast}</div>}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'mobile-open' : ''}`}>
        <div className="brand-lockup sidebar-brand">
          <div className="brand-mark"><ChefHat size={22} /></div>
          <span>Recipe</span>
        </div>
        <nav className="side-nav" aria-label="Primary">
          <NavButton active={section === 'recipes'} icon={<LibraryBig size={19} />} label="Cookbook" onClick={() => navigate('recipes')} />
          <NavButton active={section === 'collections'} icon={<FolderHeart size={19} />} label="Collections" onClick={() => navigate('collections')} />
          <div className="nav-separator" />
          <NavButton active={section === 'cook'} icon={<ChefHat size={19} />} label="Cook" onClick={() => navigate('cook')} />
          <NavButton active={section === 'plan'} icon={<ShoppingBasket size={19} />} label="Plan" onClick={() => navigate('plan')} />
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-status">
          <button
            className="sync-status"
            type="button"
            onClick={() => void sync()}
            title="Sync now"
          >
            {navigator.onLine ? <Cloud size={17} /> : <WifiOff size={17} />}
            <span>{syncing?'Syncing…':!navigator.onLine?'Offline':
              workspaceStatus==='conflict'?'Workspace conflict':
              workspaceStatus==='ready'?'Workspace synced':
              workspaceStatus==='offline'?'Cloud unavailable':'Saved locally'}</span>
          </button>
          {(library.recipeConflicts + library.collectionConflicts > 0) && (
            <span className="attention-row">
              <CircleAlert size={16} />
              {library.recipeConflicts + library.collectionConflicts} conflict
            </span>
          )}
          <button
            className="account-row"
            type="button"
            onClick={async () => {
              if (!runtime) return;
              try {
                // Pantry updates are queued separately from the workspace stores.
                await pantryWrites.current;
                await signOutRecipe(runtime.authClient, runtime.db, runtime.accountId);
                globalThis.location.assign('/');
              } catch (error) {
                if (error instanceof UnsyncedChangesError)
                  setToast(
                    `${error.pendingCount} unsynced recipe change(s). Sync before signing out.`,
                  );
                else if (error instanceof UnsyncedWorkspaceError)
                  setSignOutLocalWarning(error.pendingCount);
                else setToast('Could not sign out. Your account remains open.');
              }
            }}
          >
            <span className="avatar">R</span>
            <span>
              <strong>My cookbook</strong>
              <small>Private</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="main-column">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setMobileMenu(true)}>
            <Menu size={22} />
          </button>
          <div className="brand-lockup">
            <div className="brand-mark small"><ChefHat size={19} /></div>
            <span>Recipe</span>
          </div>
          <button className="icon-button add-mini" onClick={() => setAddOpen(true)}>
            <Plus size={22} />
          </button>
        </header>

        <div className="page">

          {section === 'recipes' && (
            <section className="cookbook-page" aria-labelledby="cookbook-title">
              <header className="cookbook-toolbar">
                <div className="cookbook-heading">
                  <h1 id="cookbook-title">My cookbook</h1>
                  <span className="cookbook-count">
                    {activeRecipes.length} {activeRecipes.length === 1 ? 'recipe' : 'recipes'}
                  </span>
                </div>
                <button type="button" className="button button-primary desktop-action" onClick={() => setAddOpen(true)}>
                  <Plus size={18} /> Add recipe
                </button>
              </header>

              <div className="search-panel">
                <label className="search-box cookbook-search">
                  <Search size={21} aria-hidden="true" />
                  <input
                    type="search"
                    value={filters.query}
                    onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
                    placeholder="Search recipes, ingredients, cuisines…"
                    aria-label="Search saved recipes"
                    autoComplete="off"
                  />
                  {filters.query && (
                    <button className="clear-search" type="button" aria-label="Clear search" onClick={() => setFilters((current) => ({ ...current, query: '' }))}>
                      <X size={18} />
                    </button>
                  )}
                </label>
                <p>Searches your saved cookbook by name, ingredient and tag.</p>
              </div>


              <section className="pantry-workbench" aria-labelledby="pantry-heading">
                <div className="pantry-head">
                  <div>
                    <h2 id="pantry-heading">Cook with what you have</h2>
                    <p>Find recipes by the ingredients already in your kitchen.</p>
                  </div>
                  {pantry.ingredients.length > 0 && (
                    <button type="button" className="text-button" onClick={() => savePantry({ ...pantry, ingredients: [] })}>
                      Clear ingredients
                    </button>
                  )}
                </div>
                <form
                  className="pantry-entry"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addPantryText(pantryText);
                  }}
                >
                  <label className="pantry-input-wrap">
                    <Plus size={17} aria-hidden="true" />
                    <input
                      type="text"
                      value={pantryText}
                      onChange={(event) => setPantryText(event.target.value)}
                      placeholder="Add eggs, rice, onions…"
                      aria-label="Available ingredients (comma separated)"
                      list="pantry-suggestions"
                      maxLength={1000}
                    />
                    <datalist id="pantry-suggestions">
                      {pantrySuggestions.map((label) => <option key={label} value={label} />)}
                    </datalist>
                  </label>
                  <button type="submit" className="button button-secondary" disabled={!pantryText.trim()}>
                    Add
                  </button>
                </form>
                {pantryText.trim().length > 0 && pantrySuggestions.length > 0 && (
                  <div className="pantry-suggestions" aria-label="Ingredient suggestions">
                    {pantrySuggestions.slice(0, 5).map((name) => (
                      <button type="button" key={name} onClick={() => addPantryText(name)}>
                        <Plus size={13} /> {name}
                      </button>
                    ))}
                  </div>
                )}
                {pantry.ingredients.length > 0 && (
                  <div className="pantry-selected" aria-label="Your available ingredients">
                    {pantry.ingredients.map((name) => (
                      <button
                        type="button"
                        className="pantry-token"
                        key={name}
                        title={`Remove ${name}`}
                        aria-label={`Remove ${name}`}
                        onClick={() => removePantryItem(name)}
                      >
                        {name}<X size={14} />
                      </button>
                    ))}
                  </div>
                )}
                <div className="pantry-foot">
                  <label className="pantry-staples">
                    <input
                      type="checkbox"
                      checked={pantry.assumeStaples}
                      onChange={(event) => savePantry({ ...pantry, assumeStaples: event.target.checked })}
                    />
                    Assume salt, water and black pepper
                  </label>
                  <span>Matches ingredient types only, not quantities. Stored on this device.</span>
                </div>
                {pantry.ingredients.length > 0 && (
                  <div className="pantry-match-controls" role="group" aria-label="Limit missing ingredients">
                    <span>Show recipes missing:</span>
                    {([['any', 'Any'], [0, 'None'], [1, '≤ 1'], [2, '≤ 2']] as const).map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        className={missingLimit === value ? 'pantry-limit is-selected' : 'pantry-limit'}
                        aria-pressed={missingLimit === value}
                        onClick={() => setMissingLimit(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <div className="library-toolbar cookbook-filters" role="group" aria-label="Filter recipes">
                <button className={hasActiveFilters ? 'filter-chip' : 'filter-chip is-selected'} type="button" aria-pressed={!hasActiveFilters} onClick={resetFilters}>
                  All recipes
                </button>
                <button
                  type="button"
                  className={filters.favoritesOnly ? 'filter-chip is-selected' : 'filter-chip'}
                  aria-pressed={filters.favoritesOnly}
                  onClick={() => setFilters((current) => ({ ...current, favoritesOnly: !current.favoritesOnly }))}
                >
                  <Heart size={16} /> Favorites
                </button>
                <button
                  type="button"
                  className={filters.underThirtyMinutes ? 'filter-chip is-selected' : 'filter-chip'}
                  aria-pressed={filters.underThirtyMinutes}
                  onClick={() => setFilters((current) => ({ ...current, underThirtyMinutes: !current.underThirtyMinutes }))}
                >
                  <Clock3 size={16} /> 30 minutes or less
                </button>
                <label className="select-chip">
                  <ListFilter size={16} />
                  <select
                    value={filters.difficulty}
                    aria-label="Filter by difficulty"
                    onChange={(event) => setFilters((current) => ({ ...current, difficulty: event.target.value as RecipeLibraryFilters['difficulty'] }))}
                  >
                    <option value="all">All difficulties</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </label>
                {collections.length > 0 && (
                  <label className="select-chip">
                    <FolderHeart size={16} />
                    <select
                      value={filters.collectionId ?? ''}
                      aria-label="Filter by collection"
                      onChange={(event) => setFilters((current) => ({ ...current, collectionId: event.target.value || null }))}
                    >
                      <option value="">All collections</option>
                      {collections.map((collection) => (
                        <option key={collection.id} value={collection.id}>{collection.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="select-chip sort-chip">
                  <select
                    value={filters.sort}
                    aria-label="Sort recipes"
                    onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as RecipeLibraryFilters['sort'] }))}
                  >
                    <option value="match" disabled={pantry.ingredients.length === 0}>Best ingredient match</option>
                    <option value="recent">Recently updated</option>
                    <option value="name">Name A–Z</option>
                    <option value="time">Shortest cooking time</option>
                  </select>
                </label>
              </div>

              {activeRecipes.length === 0 ? (
                <EmptyCookbook onAdd={() => setAddOpen(true)} />
              ) : rankedRecipes.length === 0 ? (
                <section className="no-results" aria-live="polite">
                  <Search size={30} strokeWidth={1.5} />
                  <h2>No matching recipes</h2>
                  <p>Try another ingredient or allow more missing ingredients.</p>
                  <button type="button" className="button button-secondary" onClick={resetFilters}>
                    Clear filters
                  </button>
                </section>
              ) : (
                <>
                  <div className="results-row">
                    <span>{rankedRecipes.length} {rankedRecipes.length === 1 ? 'recipe' : 'recipes'}</span>
                    {hasActiveFilters && (
                      <button className="text-button" type="button" onClick={resetFilters}>
                        Clear filters <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="recipe-grid">
                    {rankedRecipes.map(({ card, coverage }) => {
                      const record = library.recipes.find((recipe) => recipe.resourceId === card.id);
                      if (!record) return null;
                      return (
                        <RecipeCard
                          key={record.resourceId}
                          record={record}
                          coverage={pantry.ingredients.length > 0 ? coverage : null}
                          onOpen={() => setSelectedRecipeId(record.resourceId)}
                          onFavorite={() => void updateRecipe(record, (current) => ({
                            ...current,
                            recipe: { ...current.recipe, favorite: !current.recipe.favorite },
                          }))}
                          onCollections={() => setCollectionRecipeId(record.resourceId)}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          )}

          {section === 'collections' && (
            <>
              <header className="page-header">
                <div>
                  <p className="eyebrow">Organize</p>
                  <h1>Collections</h1>
                  <p>Group recipes the way your kitchen actually works.</p>
                </div>
                <button
                  className="button button-primary desktop-action"
                  onClick={() => setCollectionDialog({ mode: 'create' })}
                >
                  <Plus size={18} /> New collection
                </button>
              </header>

              {collections.length === 0 ? (
                <section className="collection-empty">
                  <div className="collection-empty-icon">
                    <FolderHeart size={38} strokeWidth={1.4} />
                  </div>
                  <h2>Make the cookbook yours.</h2>
                  <p>
                    Create collections for family recipes, quick dinners,
                    favorites to try, baking, or anything else.
                  </p>
                  <button
                    className="button button-primary"
                    onClick={() => setCollectionDialog({ mode: 'create' })}
                  >
                    <Plus size={18} /> Create collection
                  </button>
                </section>
              ) : (
                <div className="collection-grid">
                  {collections.map((collection) => (
                    <article
                      key={collection.id}
                      className="collection-card"
                      onClick={() => {
                        setFilters((current) => ({
                          ...current,
                          collectionId: collection.id,
                        }));
                        navigate('recipes');
                      }}
                    >
                      <div className="collection-mosaic">
                        {collection.recipeIds.slice(0, 4).map((recipeId) => {
                          const recipe = library.recipes.find(
                            (item) => item.resourceId === recipeId,
                          );
                          const title = recipe?.working.version.title ?? collection.name;
                          return (
                            <span
                              key={recipeId}
                              style={recipeStyle(title)}
                              className="mosaic-cell"
                            />
                          );
                        })}
                        {collection.recipeIds.length === 0 && (
                          <FolderHeart size={30} strokeWidth={1.3} />
                        )}
                      </div>
                      <div className="collection-card-body">
                        <div>
                          <h3>{collection.name}</h3>
                          <p>
                            {collection.recipeIds.length} recipe
                            {collection.recipeIds.length === 1 ? '' : 's'}
                          </p>
                        </div>
                        <div className="collection-actions">
                          <button
                            className="icon-button subtle"
                            aria-label="Rename collection"
                            onClick={(event) => {
                              event.stopPropagation();
                              setCollectionDialog({
                                mode: 'rename',
                                id: collection.id,
                                name: collection.name,
                              });
                            }}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                          <button
                            className="icon-button subtle danger-hover"
                            aria-label="Delete collection"
                            onClick={(event) => {
                              event.stopPropagation();
                              void updateCollections(
                                removeCollection(editableBook, collection.id),
                              );
                            }}
                          >
                            <X size={18} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {section === 'cook' && runtime && (
            <CookWorkspace
              db={runtime.db}
              accountId={runtime.accountId}
              records={activeRecipes}
              selectedId={cookingRecipeId}
              onChoose={id=>setCookingRecipeId(id)}
              onExit={()=>setCookingRecipeId(null)}
              onEdit={record=>editRecipe(record)}
            />
          )}

          {section === 'plan' && runtime && (
            <MealPlanner
              db={runtime.db}
              accountId={runtime.accountId}
              records={activeRecipes}
              pantry={pantry}
              onCook={beginCooking}
              onEdit={editRecipe}
              onAdd={() => setAddOpen(true)}
            />
          )}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Primary">
        <NavButton active={section === 'recipes'} icon={<LibraryBig size={20} />} label="Cookbook" onClick={() => navigate('recipes')} />
        <NavButton active={section === 'collections'} icon={<FolderHeart size={20} />} label="Collections" onClick={() => navigate('collections')} />
        <button className="mobile-add" onClick={() => setAddOpen(true)} aria-label="Add recipe">
          <Plus size={24} />
        </button>
        <NavButton active={section === 'cook'} icon={<ChefHat size={20} />} label="Cook" onClick={() => navigate('cook')} />
        <NavButton active={section === 'plan'} icon={<ShoppingBasket size={20} />} label="Plan" onClick={() => navigate('plan')} />
      </nav>

      <AddSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreate={async (title) => {
          if (!runtime) return;
          const document = createBlankRecipe(title, { locale: navigator.language });
          await runtime.recipeSync.stageCreate(document);
          await reload(runtime);
          setSelectedRecipeId(document.recipe.id);
          void sync(runtime);
        }}
        onImport={openImporter}
        onGenerate={LUNA_ENABLED ? openGenerate : undefined}
      />
      <ImportSheet
        open={importOpen}
        initialMode={importMode}
        onClose={() => setImportOpen(false)}
        onSave={saveImportedDraft}
        onLunaExtract={LUNA_ENABLED ? async (sourceText,sourceKind) => {
          if (!runtime) throw new Error('Sign in to use Luna.');
          return runtime.api.lunaExtract({
            sourceText,sourceKind,language:uiLanguage(navigator.language),
          });
        } : undefined}
      />
      {LUNA_ENABLED && <LunaSheet
        open={lunaOpen}
        mode={lunaMode}
        title={lunaRecipeContext?.working.version.title}
        pantry={pantry.ingredients}
        onClose={() => setLunaOpen(false)}
        onGenerate={async (request,avoidIngredients,servings) => {
          if (!runtime) throw new Error('Sign in to use Luna.');
          return runtime.api.lunaGenerate({
            request,availableIngredients:pantry.ingredients.slice(0,30),
            avoidIngredients,servings,language:uiLanguage(navigator.language),
          });
        }}
        onHelp={async question => {
          if (!runtime || !lunaRecipeContext) throw new Error('Open a recipe first.');
          const doc=lunaRecipeContext.working;
          return runtime.api.lunaHelp({
            recipe:{
              title:doc.version.title,
              ingredients:doc.ingredients.map(i => [i.quantity,i.unit,i.name].filter(v=>v!==null).join(' ')).slice(0,100),
              steps:doc.steps.map(s=>s.instruction).slice(0,80),
            },
            question,language:uiLanguage(navigator.language),
          });
        }}
        onSave={saveImportedDraft}
      />}

      {selectedRecipe && (
        <RecipeDetail
          record={selectedRecipe}
          collections={collectionNamesForRecipe(selectedRecipe.resourceId)}
          onClose={() => setSelectedRecipeId(null)}
          onFavorite={() =>
            void updateRecipe(selectedRecipe, (current) => ({
              ...current,
              recipe: {
                ...current.recipe,
                favorite: !current.recipe.favorite,
              },
            }))
          }
          onCollections={() => setCollectionRecipeId(selectedRecipe.resourceId)}
          onEdit={() => editRecipe(selectedRecipe)}
          onCook={() => beginCooking(selectedRecipe)}
          onAsk={LUNA_ENABLED ? () => openHelp(selectedRecipe) : undefined}
        />
      )}

      {editingRecipe && (
        <RecipeStudio
          key={editingRecipe.resourceId}
          record={editingRecipe}
          onClose={closeStudio}
          onSave={async document => {
            await updateRecipe(editingRecipe, () => document);
            setToast('Recipe saved to your cookbook.');
          }}
        />
      )}

      {collectionRecipeId && (
        <CollectionPicker
          recipeId={collectionRecipeId}
          book={editableBook}
          onClose={() => setCollectionRecipeId(null)}
          onChange={updateCollections}
        />
      )}

      {collectionDialog && (
        <CollectionNameDialog
          dialog={collectionDialog}
          onClose={() => setCollectionDialog(null)}
          onSubmit={async (name) => {
            const next =
              collectionDialog.mode === 'create'
                ? createCollection(editableBook, name)
                : renameCollection(editableBook, collectionDialog.id, name);
            await updateCollections(next);
            setCollectionDialog(null);
          }}
        />
      )}

      {workspaceConflicts.length>0&&runtime?.workspaceSync&&(
        <section className="workspace-conflicts" role="alert" aria-label="Recipe sync conflicts">
          <div className="workspace-conflict-heading">
            <CircleAlert size={19}/>
            <div><strong>Choose which version to keep</strong>
              <p>Changes from another device conflict with this device. No version has been overwritten.</p>
            </div>
          </div>
          {workspaceConflicts.map(conflict=>(
            <div className="workspace-conflict-row" key={conflict.kind+conflict.resourceKey}>
              <strong>{conflict.kind==='plan'?'Meal plan':(
                library.recipes.find(r=>r.resourceId===conflict.resourceKey)?.working.version.title||'Cooking session'
              )}</strong>
              <div>
                <button className="button button-secondary" type="button" disabled={resolvingWorkspace}
                  onClick={async()=>{
                    if(!runtime?.workspaceSync)return;
                    setResolvingWorkspace(true);
                    try{
                      await runtime.workspaceSync.resolve(conflict,'use-cloud');
                      setWorkspaceConflicts(current=>current.filter(c=>c!==conflict));
                      globalThis.dispatchEvent(new Event('recipe:workspace-changed'));
                      void sync(runtime);
                    }catch{setToast('Resolution failed. Your local data remains unchanged.');}
                    finally{setResolvingWorkspace(false);}
                  }}>Use cloud version</button>
                <button className="button button-primary" type="button" disabled={resolvingWorkspace}
                  onClick={async()=>{
                    if(!runtime?.workspaceSync)return;
                    setResolvingWorkspace(true);
                    try{
                      await runtime.workspaceSync.resolve(conflict,'keep-local');
                      setWorkspaceConflicts(current=>current.filter(c=>c!==conflict));
                      void sync(runtime);
                    }catch{setToast('Resolution failed. Your local data remains unchanged.');}
                    finally{setResolvingWorkspace(false);}
                  }}>Keep this device</button>
              </div>
            </div>
          ))}
        </section>
      )}
      {signOutLocalWarning !== null && runtime && (
        <div className="modal-layer" role="presentation">
          <section className="sheet compact-sheet" role="dialog" aria-modal="true"
            aria-labelledby="local-signout-title" aria-describedby="local-signout-description">
            <div className="sheet-header">
              <div>
                <p className="eyebrow">Unsaved on this device</p>
                <h2 id="local-signout-title">Keep your cooking data?</h2>
              </div>
              <button className="icon-button" type="button" disabled={discardingLocalData}
                onClick={() => setSignOutLocalWarning(null)} aria-label="Cancel sign out">
                <X size={21}/>
              </button>
            </div>
            <p id="local-signout-description">
              {signOutLocalWarning} pantry, plan or cooking item(s) have no confirmed
              cloud backup. Signing out would permanently erase those items from
              this browser. Synced recipes remain in your account.
            </p>
            <div className="signout-warning-actions">
              <button className="button button-secondary" type="button"
                disabled={discardingLocalData} onClick={() => setSignOutLocalWarning(null)}>
                Keep my data
              </button>
              <button className="button button-primary" type="button"
                disabled={discardingLocalData} onClick={async () => {
                  setDiscardingLocalData(true);
                  try {
                    await pantryWrites.current;
                    await signOutRecipe(runtime.authClient, runtime.db, runtime.accountId,
                      { discardLocalWorkspace: true });
                    globalThis.location.assign('/');
                  } catch (error) {
                    setSignOutLocalWarning(null);
                    if (error instanceof UnsyncedChangesError)
                      setToast('New unsynced recipe edits exist. Sync before signing out.');
                    else setToast('Sign out failed. Try again without losing local changes.');
                  } finally {
                    setDiscardingLocalData(false);
                  }
                }}>
                {discardingLocalData ? 'Signing out…' : 'Discard local data & sign out'}
              </button>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <button className="toast" type="button" onClick={() => setToast(null)}>
          {toast}
        </button>
      )}
    </div>
  );
}

function CollectionNameDialog({
  dialog,
  onClose,
  onSubmit,
}: {
  dialog: { mode: 'create' } | { mode: 'rename'; id: string; name: string };
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(dialog.mode === 'rename' ? dialog.name : '');
  const [saving, setSaving] = useState(false);
  const title = dialog.mode === 'create' ? 'New collection' : 'Rename collection';

  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <form
        className="sheet compact-sheet name-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim()) return;
          setSaving(true);
          try {
            await onSubmit(name);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="sheet-header">
          <div>
            <p className="eyebrow">Collections</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <label htmlFor="collection-name">Name</label>
        <input
          id="collection-name"
          className="standalone-input"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Family recipes"
        />
        <button
          className="button button-primary full-width"
          disabled={!name.trim() || saving}
        >
          {saving ? 'Saving…' : dialog.mode === 'create' ? 'Create collection' : 'Save name'}
        </button>
      </form>
    </div>
  );
}
