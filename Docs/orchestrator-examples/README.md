# Orchestrator Examples (INT-3 Handoff)

Example JSON responses for Track D (UI) integration.

## Known Limitations (PoC)

1. **`patch_accepted` does not call validate-patch.** The UI must call PLoT
   `/v1/validate-patch` directly after patch acceptance. Post-PoC, CEE will
   handle this and return the validated `graph_hash` in the envelope.

2. **`undo_patch` is a stub.** Returns a text message explaining undo is coming
   soon. Not wired to any state management.

3. **Token budget uses static heuristic.** 4 chars/token estimate. Needs real
   staging measurement with 8-12 node graphs before production.
