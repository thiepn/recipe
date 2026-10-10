# P20 — Accessibility, devices and offline hardening (stacked draft)

## Audited original surfaces and confirmed defects
- \`src/ui/App.tsx\` AddSheet: visible Blank Recipe action was inert, backdrop dismissed during async create, and dialog had no focus custody.
- \`src/ui/App.tsx\` CollectionPicker: no keyboard focus containment, concurrent changes possible, and rejected async changes left unhandled without user feedback.
- \`src/ui/ImportSheet.tsx\` and \`src/ui/RecoveryPanel.tsx\`: declared modal but did not contain Tab or restore originating keyboard focus.
- \`src/ui/RecipeStudio.tsx\`: existing unsaved-work confirmation on Escape, but no Tab focus boundary. Preserved existing unsaved protection and added Tab containment without adding another Escape handler.
- Existing P17/P18/P19 modal and focus work, P16 timer/speech feature, P12 planner, P15 offline/recovery and account-level IndexedDB isolation were retained. No old visual baseline modified.

## Source changes
- Shared \`useAccessibleDialog\` focus custody: initial focus, forward/backward Tab cycle, Escape only when not busy, focus restoration to connected origin, no stealing focus when transitioning to a new modal, current async callback and busy refs.
- Add Recipe title focus from Blank Recipe action, no backdrop/close dismissal during save.
- CollectionPicker serialized in-flight changes, checkbox/close disabled while saving, visible rejection; never reports success on failed save.
- Import/Recovery Escape/Tab and keyboard focus on open; modal ref supports 400% zoom.
- Recipe Studio adds Tab containment, preserving its original unsaved discard confirmation.
- CSS for narrow reflow and prefers-reduced-motion without replacing screenshot goldens.

## Qualification
- New P20 real React component fixture includes Add, Collection, Import, Recovery (real account-keyed disposable IndexedDB), and Studio; assertions for Tab boundary, focus return, Escape, denied busy-dismiss, delayed write race, deliberate storage failure, offline recovery, 400% CSS zoom on desktop, 200% mobile zoom and reduced motion.
- Inherited browser tests run real P16 hands-free, P17 editor/Cook/planner, P18 disabled sharing, P19 local recommendation behavior; real hardware/screen reader testing still OPEN.
- Synthetic screenshots uploaded as inspectable ZIP, not accepted golden snapshots. No merge/deploy/migration, account permission broadening, OAuth fabrication, P7 MCP activation, P13 sync activation, Luna or P18 shared access.

## Explicit acceptance gaps
Physical Android/Samsung Chrome PWA, physical iOS/Safari, external screen readers, push/timer background behavior, true cross-account OAuth, independent human visual acceptance, backup/prior-stable restoration witnesses, operator release decision all OPEN. CI browser emulation does not replace these.
