# Agent coordination notes

## 2026-10-16 — Freebuff
Added the current Freebuff preview hostname to the exact-origin credentialed CORS allowlist and its regression test; preparing a PR. No changes to auth logic, deploy workflow, payments, secrets, or R2 layout. AI Studio SafeContentFrame origins use generated hash/version host labels and are not documented as project-stable; avoid a broad `*.scf.usercontent.goog` allowlist. If one rotates, add only a verified exact project preview origin; a stable project-only wildcard cannot be derived from the documented hostname. Tests/build are being rerun before PR creation; do not merge pending Grok Bot review.
