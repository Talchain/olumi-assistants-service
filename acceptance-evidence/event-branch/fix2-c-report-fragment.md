# FIX-2 Class C report fragment

## Ingress enumeration first

See `fix2-c-ingress-census.md`, written before implementation. The client graph write/adoption paths are (1) scenario graph registration/file import, (2) the shared turn request `graph_state` parser (also used by stream/proxy forwarding and the edit fallback), and (3) defensive direct-executor first-touch adoption/edit merge inputs. Server version save/restore and canonical graph reads retain stored CEE warrants. Agent model writes dispatch through register/turn. Standalone graph-coaching routes do not adopt/import/persist graphs or consume event warrants; draft refinement reduces its seed to bounded id/kind/label/endpoint summaries.

## Changed files

- `src/orchestrator-v5/boundary/request-extensions.ts`: one client-only sidecar remover for nodes and options mirrors, applied after request graph validation. Stored read schemas remain unchanged.
- `src/orchestrator-v5/turn-executor.ts`: direct callers sanitize the client graph once; all provisional reasoning/adoption/mutation consumers use those admitted bytes. Existing saved-state priority remains intact.
- `src/routes/assist.v1.scenario-graph-register.ts`: strip all client sidecars and restore a trusted stored warrant only for the same id, occurrence, label, and description.
- `src/orchestrator-v5/agent-lane/event-risk-construction-context.ts`: CEE's in-process grant snapshots and compares label and description alongside id, occurrence, and text.
- `src/orchestrator-v5/__tests__/turn-executor-adopt-on-first-touch.test.ts` and `src/routes/__tests__/assist.v1.scenario-graph-register.event-risk.test.ts`: RED-first behavioral rows below.
- `tests/unit/contracts/controlled-factor-authority.scan.ts` and `tests/unit/contracts/controlled-factor-authority.guard.test.ts`: adapt the reviewed fallback identifier from raw client graph to sanitized client graph; retain exact persisted-first ordering and assert the sanitizer binding.

## Rows: RED → GREEN

The exact HEAD and branch were asserted before work. RED ran with Class C production files unchanged from `5f54ca8740095fb744ab1f2717a886fc5e3f5c66`.

| Row | RED on reviewed behavior | GREEN behavior |
| --- | --- | --- |
| r1 #4, empty scenario first-touch graph with valid Olumi occurrence and `Invented reference class` | Request parser and direct-executor adoption retained the invented warrant | Occurrence retained; client warrant removed before persistence; occurrence list/Check estimates never exposes the invented reference |
| Options mirrors, request parser and registration | Both retained `Invented mirror reference class` | Both strip the client sidecar, without mutating caller input |
| r1 #8, stored developer departure/staff-turnover basis, same id and occurrence registered as `Largest client cancels` | Restored staff-turnover text for the relabelled event | Clears the basis text |
| Same stored occurrence, changed description | Restored the warrant for the changed event description | Clears the basis text |
| CEE construction grant, same id/occurrence/text but changed label or description | Both changes retained the construction grant | Both changes refuse the grant; no client warrant retained |
| Controls | Pass | Stored-read schema retains CEE text; same-event registration and in-process construction preserve CEE text; ordinary first-touch/adoption and numeric graph identity behavior remain intact |

Corrected RED: **8 failures / 40 passes (48 rows)**, `fix2-c-red-corrected.log`. Initial `fix2-c-red.log` contains the same genuine basis failures plus one fixture-control failure caused by a missing impact `effect_direction`; that fixture was corrected before the definitive RED, and the fixture error is not credited as defect evidence.

Core GREEN: **48/48**, `fix2-c-green.log`. Restored GREEN after all mutants: **48/48**, `fix2-c-restored-green.log`.

The authority guard first exposed three expected stale raw-client identifier pins, while the numeric-identity neighbor passed (`fix2-c-guard-adaptation-red.log`: 3 failures/24 passes). Minimal identifier adaptation then gave **27/27**, `fix2-c-neighbours-green.log`; final restored neighbor run is in `fix2-c-neighbours-restored.log`.

## Mutants

Every mutation ran separately, produced the named behavioral/assertion failure, and was restored in `finally`. The eight mutation logs record exact source replacement and gated test command.

| Mutant | Changed claim challenged | Witness |
| --- | --- | --- |
| C1, remove parser sanitation | Client graph ingress cannot author basis text | Request parser r1 #4 fails on `Invented reference class` |
| C2, remove direct executor sanitation | First-touch adoption cannot bypass the parser's authorship boundary | Direct first-touch r1 #4 fails on persisted invented text |
| C3, remove register options sanitation | Registration options mirrors cannot carry client warrants | Register mirror row fails on invented text |
| C4, remove stored label comparison | A renamed event cannot retain the old warrant | r1 #8 label row fails on restored staff-turnover text |
| C5, remove stored description comparison | A redescribed event cannot retain the old warrant | r1 #8 description row fails on restored staff-turnover text |
| C6, remove construction label comparison | CEE grant cannot be reused for a renamed event | Construction label row fails on retained grant text |
| C7, remove construction description comparison | CEE grant cannot be reused for a redescribed event | Construction description row fails on retained grant text |
| C8, make a controlled-factor fallback client-first | Sanitizer adaptation must preserve canonical authority | Repository authority scan and single-snapshot assertion fail |

Logs: `fix2-mutant-c1-parser.log`, `fix2-mutant-c2-executor.log`, `fix2-mutant-c3-register-mirror.log`, `fix2-mutant-c4-stored-label.log`, `fix2-mutant-c5-stored-description.log`, `fix2-mutant-c6-grant-label.log`, `fix2-mutant-c7-grant-description.log`, `fix2-mutant-c8-persisted-first-guard.log`.

Every test command applied the required load gate, ran at most two test files, used `--maxWorkers=1 --configLoader=runner`, and read stdin from `/dev/null`. No commits, pushes, tracked-directory removal, or `supabase/` edits. Final full-tree tsc and changed-file eslint are owned by the parent task and should be recorded in `REPORT-FIX2.md`.
