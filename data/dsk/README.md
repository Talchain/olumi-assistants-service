# Deterministic Science Knowledge Base (DSK)

The DSK is a curated, versioned repository of decision science claims, technique protocols, and behavioural triggers. Every scientific claim the AI makes in conversation references a specific DSK object with evidence strength, scope, and peer-reviewed citations. The bundle is authored as static JSON, hash-verified at load, and constitutes the scientific foundation that makes Olumi's AI science-powered. `v1.json` is the active bundle loaded at CEE startup.

## Files

- `v1.json` — the active DSK bundle loaded at CEE startup
- `context-tags.json` — the controlled vocabulary for `context_tags`. To add a new tag, add it here and re-run the linter. No code change required.

## Commands

```bash
# Generate (or regenerate) the skeleton bundle with allocated IDs and placeholder content
pnpm dsk:init

# Lint the bundle — validates structure, semantics, cross-references, and hash
pnpm dsk:lint

# Lint with a custom vocabulary file
pnpm dsk:lint --context-tags path/to/vocab.json

# Rewrite the bundle with objects in canonical id order (fixes ordering warnings)
pnpm dsk:lint --fix-order

# Compute and print the canonical SHA-256 hash
pnpm dsk:hash
```

## Authoring workflow

1. Run `pnpm dsk:init` to allocate IDs and create a skeleton with placeholder content.
2. Replace each `PLACEHOLDER — needs review` with real content.
3. Run `pnpm dsk:lint` — it will report errors until all placeholders are replaced and the hash is consistent.
4. Once the linter exits 0, the bundle is ready for deployment.

## Object types

- **Claims** (`type: "claim"`) — empirical assertions about human decision-making (biases, technique efficacy, causal rules, population effects).
- **Protocols** (`type: "protocol"`) — structured step-by-step techniques (pre-mortem, disconfirmation, etc.).
- **Triggers** (`type: "trigger"`) — signals in the conversation that indicate a specific bias or decision pattern is active.

## ID scheme

All IDs follow the format `DSK-{prefix}-{NNN}` where prefix is one of:

| Prefix | Category |
|--------|----------|
| `B` | Bias claims |
| `T` | Technique efficacy claims |
| `F` | Framework claims |
| `G` | Group / population claims |
| `P` | Protocols |
| `TR` | Triggers |

Example: `DSK-B-001` (Anchoring bias), `DSK-P-001` (Pre-mortem protocol), `DSK-TR-001` (Binary framing trigger).

---

## Design constraints

These constraints apply to the DSK architecture and must not be violated without an explicit decision to change them.

**Citations remain embedded, not normalised.** `source_citations` is an ordered array where sequence encodes evidential weight (meta-analyses first, RCTs second, observational third). Normalising into a join table would require `citation_order` columns and risk hash instability. Keep citations as embedded arrays through at least Phase 1, even if other fields are normalised.

**The canonical JSON bundle is the runtime artefact.** Even when authoring moves to a database in future phases, the orchestrator always loads a pre-built, hash-verified JSON bundle at startup. The database would be for authoring and review workflows — never in the hot path.

**Multi-file authoring comes before database migration.** When the single JSON file becomes unwieldy for review and diffing, the next step is splitting into one file per object (or per topic folder) with a build step that composes the canonical bundle. This preserves determinism and git-based review with zero infrastructure overhead.

**Migration to database is triggered by workflow needs, not object count.** Specifically: when content edits must be decoupled from code deployments, when an audit trail with review states is required, when role-based authoring is needed, or when query-time retrieval beyond in-memory indexing is required.
