# P16 — Hands-free cooking and independent timer alerts (stacked draft)

## Implemented
- Optional, clearly labelled controls in the real P10/P11 Cook session: Previous, Read step, Next.
- One-command, push-to-talk Web Speech recognition on browsers that expose it; no hot mic, no automatic restart, no secret recording, and no account/cloud writes.
- Exact command grammar (EN/DE), no implicit mark-complete, no action on partial or unrecognized speech.
- Explicit read-aloud through local browser speech synthesis, with unsupported-browser fallback.
- Optional opt-in spoken expiry alerts and secure-context system notifications (permission requested only by user click).
- Independent expiry detection across up to eight existing P11 deadline-based timers, deduplicated for one foreground session.
- Persistent visible due state and accessible role=alert remain even without microphone, speech, notifications, or sound.
- Unmount aborts voice capture and cancels speech initiated by this surface; existing owner-scoped IndexedDB session/recovery and P13 gates unchanged.

## Important technical boundaries
- Browser SpeechRecognition may send microphone audio to a browser-vendor service. Voice mode is **off by default**, only one command per button press; no transcript is persisted or sent to Recipe/THIEPN servers.
- Spoken speech and Notification require browser support, user permission and foreground execution. OS/browser can throttle timers and suppress playback. There is no service worker push or guaranteed closed-tab alarm.
- A saved session opened with already overdue timers shows overdue status but does not replay stale sound/notifications.
- System notification text is generic to protect private recipe titles/ingredient names on lock screens.
- This adds no OAuth/API keys, Account changes, P7 MCP activation, P13 workspace sync flag or Luna activation.

## Verification
- \`pnpm verify\`: all original tests plus P16 command/parser, independent expiry and fallback regression coverage, built-site smoke.
- \`pnpm test:browser\`: original sign-out/routing checks plus real mounted KitchenHandsFree component on desktop Chromium and mobile Chromium viewport. The fixture lives in tests/browser and is not a production route.
- Manual gates: physical Android Chrome, iOS Safari, microphone consent/revocation, OS notifications with phone locked, service-worker background wake testing, real account reload/isolation, accessibility with screen reader. Do not claim certification from Chromium viewport emulation alone.
- P16 is a stacked draft onto the qualified P15F commit, not merged or released.
