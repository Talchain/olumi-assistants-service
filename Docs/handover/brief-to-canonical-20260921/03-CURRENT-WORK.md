# Current work — exact heads, CI status, disposition

Derived 21 Sep 2026 from `git ls-remote` + `gh`, not from a local tree.

## CEE — `Talchain/olumi-assistants-service`

| item | branch | SHA | state |
|---|---|---|---|
| **PR #1674** | `feat/observed-state-must-not-destroy-the-model` | **`3b9a0b9f2e8f4f73051b8585aec2f772ea34b05f`** | open, base `staging` |
| behaviour witness (parallel session) | `feat/1674-behaviour-witness` | `35efdff30ab84dff60788be4d5981c610265ae86` | safe at remote |
| `declined_axis` improvement (rescued) | `rescue/f0eef277-declined-axis` | `f0eef27799347b35433d5c93e2685cd684813edd` | safe at remote |

### #1674 CI — the honest status

At `ce28ab22` the required check **`Lint, TypeCheck, Unit Tests` FAILED**
(`2 failed | 2414 passed`, job 106468877344, completed 19:13:38Z). Both failures
were mine and neither was flake:

1. the behaviour witness wrote to `/private/tmp/WITNESS.txt` — macOS-only, so
   ENOENT on the Linux runner **while all three behaviour assertions passed**;
2. `no-brief-derived-user-override.writers.test.ts` refused the salvage module
   as an unreviewed carrier of the `user_override` literal.

Both fixed in `3b9a0b9f`, each with a discriminating control:

```
remove ONLY the manifest key        -> 1 failed | 3 passed  (exit 1)
restore an unwritable witness path  -> 1 failed | 2 passed  (exit 1)
restored                            -> 7 passed (2 files)   (exit 0)
```

⚠ **The APPROVE (comment 5765757286) was published against `ce28ab22`.**
The head has moved, so it no longer binds. #1674 needs a fresh verdict at
`3b9a0b9f` before any merge.

⚠ **Two sessions worked this branch in parallel and I force-pushed over two of
their commits.** Both were recovered to named branches (above) and verified at
the remote. `f0eef277` carries `declined_axis: "role"|"shape"|"kind"`, which is
**better than the single flat `would_strip_constraint`** currently shipped — it
names WHICH hazard refused. It is not yet folded in.

### Disposition recommendation

- **Keep** `3b9a0b9f` — it is narrow, evidenced, and the required check's two
  real failures are fixed.
- **Fold in** `f0eef277`'s `declined_axis` before merge; it costs little and
  makes every decline diagnosable.
- **Do not delegate** the salvage module's authority predicate until the
  `brief_extraction` contradiction is ruled (see `02-THE-CAUSAL-CHAIN.md`).

## Schemas — `Talchain/olumi-schemas` (PARKED by instruction)

| PR | SHA | note |
|---|---|---|
| #63 | `29b050d2314b418d5b75e7d37b2e242fd8258821` | contract version on the wire |
| #64 | `c203b16d8d12ef7cad0c78eec3eb01ff50a811a7` | consumer pin drift visibility |

Useful contract-observability work, **not on the shortest path** to a trusted
canonical model. Leave open. Do not vendor 0.57.0 through the estate.
