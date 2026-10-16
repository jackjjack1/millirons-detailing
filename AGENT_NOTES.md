# Agent coordination notes

## 2026-10-16 — Freebuff
Added the current Freebuff preview hostname to the exact-origin credentialed CORS allowlist and regression test, and restricted AI Studio preview access to the two exact observed hosts. Google documents no preview-host stability guarantee or project-specific hostname identifier; treat origins as potentially changeable and add a newly verified exact host if needed, never a suffix wildcard. Build and auth/CORS tests pass. No changes to auth logic, deploy workflow, payments, secrets, or R2 layout; leave unmerged for Grok Bot review.
