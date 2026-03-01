# Deterministic Science Knowledge Base (DSK)

The DSK is a curated, versioned repository of decision science claims, technique protocols, and behavioural triggers. Every scientific claim the AI makes in conversation references a specific DSK object with evidence strength, scope, and peer-reviewed citations. The bundle is authored as static JSON, validated by tooling, and loaded at CEE startup.

## Files

- `v1.json` — the active DSK bundle loaded at CEE startup

## Commands

```bash
# Generate the skeleton bundle with allocated IDs and placeholder content
pnpm dsk:init

# Lint the bundle — validates structure, cross-references, and hash
pnpm dsk:lint

# Compute and print the canonical SHA-256 hash
pnpm dsk:hash
```
