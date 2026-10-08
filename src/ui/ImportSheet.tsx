import { useEffect, useState, type ChangeEvent } from 'react';
import { FileImage, FileText, Globe, LoaderCircle, Sparkles, X } from 'lucide-react';
import type { LunaDraft } from '../ai/contracts.ts';
import {
  extractSchemaRecipe,
  fetchPublicRecipePage,
  importPreviewValid,
  parseRecipeImport,
  safeSourceUrl,
  type ImportDraft,
  type ImportKind,
} from '../import/recipe-import.ts';

type SaveResult = 'saved' | 'duplicate';
type Mode = ImportKind;

interface Props {
  open: boolean;
  initialMode: Mode;
  onClose: () => void;
  onSave: (draft: ImportDraft, allowDuplicate: boolean) => Promise<SaveResult>;
  onLunaExtract?: ((text: string, kind: 'text' | 'ocr') => Promise<LunaDraft>) | undefined;
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n?/g, '\n').split('\n')
    .map(line => line.trim()).filter(Boolean);
}

export function ImportSheet({ open, initialMode, onClose, onSave, onLunaExtract }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [rawText, setRawText] = useState('');
  const [url, setUrl] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [ingredientText, setIngredientText] = useState('');
  const [stepText, setStepText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);

  useEffect(() => {
    if (!open) {
      setRawText('');
      setUrl('');
      setImage(null);
      setDraft(null);
      setIngredientText('');
      setStepText('');
      setError(null);
      setDuplicate(false);
      setBusy(false);
    } else {
      setMode(initialMode);
    }
  }, [open, initialMode]);

  if (!open) return null;

  const update = (patch: Partial<ImportDraft>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    setDuplicate(false);
  };

  const setParsed = (next: ImportDraft) => {
    setDraft(next);
    setIngredientText(next.ingredients.join('\n'));
    setStepText(next.steps.join('\n'));
    setDuplicate(false);
    setError(null);
  };

  const runExtract = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDuplicate(false);
    try {
      if (mode === 'text') {
        const parsed = parseRecipeImport(rawText, 'text');
        setParsed({
          ...parsed,
          sourceUrl: url.trim() ? safeSourceUrl(url) : null,
        });
      } else if (mode === 'website') {
        const sanitized = safeSourceUrl(url);
        const html = await fetchPublicRecipePage(sanitized);
        const structured = extractSchemaRecipe(html);
        if (!structured) {
          throw new Error('No structured recipe found on this site. Copy its recipe text and use Paste text instead.');
        }
        setParsed({
          ...structured,
          kind: 'website',
          sourceUrl: sanitized,
          originalText: JSON.stringify({
            name: structured.title,
            description: structured.description,
            recipeIngredient: structured.ingredients,
            recipeInstructions: structured.steps,
          }),
        });
      } else {
        if (!image) throw new Error('Choose a recipe photo or screenshot first.');
        if (!/^image\/(png|jpeg|webp)$/i.test(image.type))
          throw new Error('Choose a PNG, JPEG or WebP image.');
        if (image.size > 8 * 1024 * 1024)
          throw new Error('Image exceeds the 8 MB limit.');
        // Loaded only after explicit user action; OCR runs on this device.
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('eng+deu');
        let text = '';
        try {
          const result = await worker.recognize(image);
          text = result.data.text;
        } finally {
          await worker.terminate();
        }
        if (!text.trim()) throw new Error('No text was recognized. Try a clearer image or paste the recipe.');
        const parsed = parseRecipeImport(text, 'photo');
        setParsed({
          ...parsed, kind: 'photo', method: 'ocr',
          sourceName: image.name,
          warnings: [
            ...parsed.warnings,
            'OCR may misread quantities and temperatures. Verify every ingredient and step.',
            'Original image bytes are not saved to the cloud in P6; extracted text is preserved.',
          ],
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recipe extraction failed.');
    } finally {
      setBusy(false);
    }
  };

  const runLunaExtract = async () => {
    if (!draft || !onLunaExtract || busy || !['text','photo'].includes(draft.kind)) return;
    setBusy(true);setError('');setDuplicate(false);
    try {
      const result = await onLunaExtract(
        draft.originalText, draft.method === 'ocr' ? 'ocr' : 'text',
      );
      const next: ImportDraft = {
        ...draft,
        title: result.title,
        description: result.description,
        ingredients: result.ingredients,
        steps: result.steps,
        servings: result.servings,
        totalMinutes: result.totalMinutes,
        warnings: [
          ...draft.warnings,
          'Luna-assisted extraction: verify every amount, allergen and step against the original source.',
          ...result.uncertainties,
          ...result.notes,
        ],
      };
      setParsed(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Luna is unavailable. You can still review and save the original extraction.');
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!draft || busy) return;
    const latest = {
      ...draft,
      ingredients: splitLines(ingredientText),
      steps: splitLines(stepText),
    };
    if (!importPreviewValid(latest)) {
      setError('A title, at least one ingredient and one step are required. Check field lengths.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onSave(latest, duplicate);
      if (result === 'duplicate') {
        setDuplicate(true);
        setError('This recipe appears to be in your cookbook already. Review before saving another copy.');
      } else {
        onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save recipe.');
    } finally {
      setBusy(false);
    }
  };

  const selectMode = (next: Mode) => {
    setMode(next);
    setDraft(null);
    setDuplicate(false);
    setError(null);
  };

  return (
    <div className="modal-layer" role="presentation" onMouseDown={() => { if (!busy) onClose(); }}>
      <section
        className="sheet import-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="sheet-header">
          <div>
            <p className="eyebrow">Capture</p>
            <h2 id="import-title">Import a recipe</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close importer" onClick={onClose} disabled={busy}>
            <X size={20} />
          </button>
        </header>

        {!draft ? (
          <>
            <div className="import-tabs" role="group" aria-label="Import source">
              <button type="button" className={mode === 'text' ? 'is-selected' : ''} aria-pressed={mode === 'text'} onClick={() => selectMode('text')}>
                <FileText size={17} /> Text
              </button>
              <button type="button" className={mode === 'website' ? 'is-selected' : ''} aria-pressed={mode === 'website'} onClick={() => selectMode('website')}>
                <Globe size={17} /> URL
              </button>
              <button type="button" className={mode === 'photo' ? 'is-selected' : ''} aria-pressed={mode === 'photo'} onClick={() => selectMode('photo')}>
                <FileImage size={17} /> Photo
              </button>
            </div>
            {mode === 'text' && (
              <div className="import-field">
                <label htmlFor="import-raw">Paste full recipe text</label>
                <textarea id="import-raw" rows={11} value={rawText}
                  onChange={event => setRawText(event.target.value)} maxLength={75_000}
                  placeholder={'Kimchi Fried Rice\nIngredients\n2 cups cooked rice\n1 tbsp sesame oil\nInstructions\n1. Heat a pan.\n2. Add the rice.'}
                />
                <small>Use clear Ingredients and Instructions headings. You can correct everything before saving. Also accepts recipe JSON-LD.</small>
                <label htmlFor="import-text-source">Source URL (optional)</label>
                <input id="import-text-source" type="url" value={url} maxLength={2048}
                  placeholder="https://example.com/recipe"
                  onChange={event => setUrl(event.target.value)} />
                <small>If a website blocks automatic extraction, paste its recipe here and retain the source link.</small>
              </div>
            )}
            {mode === 'website' && (
              <div className="import-field">
                <label htmlFor="import-url">Recipe website URL</label>
                <input id="import-url" type="url" value={url}
                  placeholder="https://example.com/recipe"
                  onChange={event => setUrl(event.target.value)} maxLength={2048} />
                <small>Automatic extraction works only when a site permits browser access and provides structured recipe data. Otherwise copy the recipe text instead.</small>
              </div>
            )}
            {mode === 'photo' && (
              <div className="import-field">
                <label htmlFor="import-photo">Photo or screenshot</label>
                <input id="import-photo" type="file" accept="image/png,image/jpeg,image/webp"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setImage(event.target.files?.[0] ?? null)} />
                <small>On-device English/German OCR, up to 8 MB. Language data may download on first use. The original photo is not uploaded or stored.</small>
              </div>
            )}
            <button className="button button-primary full-width" type="button"
              onClick={() => void runExtract()} disabled={busy || (mode === 'text' ? !rawText.trim() : mode === 'website' ? !url.trim() : !image)}>
              {busy ? <LoaderCircle size={17} className="import-spinner" /> : null}
              {busy ? 'Extracting…' : 'Extract for review'}
            </button>
          </>
        ) : (
          <div className="import-preview">
            <div className="import-preview-header">
              <div>
                <strong>Review imported recipe</strong>
                <small>Private draft · no automatic publishing</small>
              </div>
              <button type="button" className="text-button" disabled={busy} onClick={() => {setDraft(null); setDuplicate(false);}}>
                Back to source
              </button>
            </div>
            {onLunaExtract && (draft.kind === 'text' || draft.kind === 'photo') && draft.originalText.length >= 20 &&
              draft.originalText.length <= 16_000 && (
              <button type="button" className="button button-secondary luna-extract-action"
                disabled={busy} onClick={() => void runLunaExtract()}>
                <Sparkles size={16}/> {busy ? 'Luna is reading…' : 'Refine extraction with Luna (optional)'}
              </button>
            )}
            {draft.warnings.length > 0 && (
              <div className="import-warnings" role="note">
                {draft.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
              </div>
            )}
            <label className="import-field">
              <span>Recipe name</span>
              <input type="text" value={draft.title} maxLength={240}
                onChange={event => update({ title: event.target.value })} />
            </label>
            <label className="import-field">
              <span>Description (optional)</span>
              <input type="text" value={draft.description} maxLength={2000}
                onChange={event => update({ description: event.target.value })} />
            </label>
            <div className="import-preview-split">
              <label className="import-field">
                <span>Ingredients · one per line</span>
                <textarea value={ingredientText} rows={9}
                  onChange={event => {setIngredientText(event.target.value); setDuplicate(false);}} />
              </label>
              <label className="import-field">
                <span>Method · one step per line</span>
                <textarea value={stepText} rows={9}
                  onChange={event => {setStepText(event.target.value); setDuplicate(false);}} />
              </label>
            </div>
            <p className="import-provenance">
              Source: {draft.sourceUrl || draft.sourceName || 'Pasted text'}.
              Original extracted text and attribution are saved in the recipe draft.
            </p>
            <button type="button" className="button button-primary full-width" disabled={busy}
              onClick={() => void submit()}>
              {busy ? 'Saving…' : duplicate ? 'Save duplicate anyway' : 'Save private draft'}
            </button>
          </div>
        )}
        {error && <p className="import-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
