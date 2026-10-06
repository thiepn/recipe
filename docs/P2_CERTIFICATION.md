# P2 Certification Trigger

This branch exists only to run the complete P2 verification suite against the current `main` baseline.

Certification scope:

- strict TypeScript compilation;
- protocol validation;
- IndexedDB durability;
- local-first create/sync convergence;
- stale-revision conflict preservation;
- bearer-only Core API behavior.

If green, merge this file as the durable P2 certification record.

Certification rerun: CI bootstrap corrected; validating the latest P2 baseline.

Final certification rerun: latest hardened P2 baseline.

Rerun after TypeScript 7 envelope inference hardening.
