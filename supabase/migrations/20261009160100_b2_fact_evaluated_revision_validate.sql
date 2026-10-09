-- STEP 4 — DL runs later, separately from steps 1–3.
-- VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE; scans the shared table.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.v5_handler_facts VALIDATE CONSTRAINT v5_handler_facts_evaluated_revision_nonneg;
COMMIT;
