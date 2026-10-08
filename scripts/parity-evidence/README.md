# Staging parity review evidence
These one-off snapshots are review evidence, not a Required or default test gate.
Run by hand from the repository root: `python3 scripts/parity-evidence/seed-review.py current`.
Recreate and verify the Addendum 15 seed: `python3 scripts/parity-evidence/seed-review.py seed`.
Seeding uses a byte-verified `git archive` export of origin/staging at `69ff73cf180efb4099c10446197661a33f9777da`.
Only the export receives snapshot updates; current snapshot expectations are never rewritten.
Verify the retained Addendum 15 source attribution: `python3 scripts/parity-evidence/verify-attribution.py`.
Logs/reports stay in `.codex-out/`; fresh exports remain in `/private/tmp/addendum-16-parity-staging-*` without deletion.
The historical omnibus runner and source evidence remain archived in `.codex-out/`.
