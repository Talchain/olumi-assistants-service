# Door 1 source fixtures

These are unchanged copies of the supplied `jw-j2-graph-before.json` and `jw-j2-graph-after.json`.

| File | SHA-256 |
| --- | --- |
| before | `87e59477345d9da33647926aa9ea94b4b5d90e75dac430921e78d13833ac1189` |
| after | `0f4db97dd0a50fdf17424e69c27cbfd51c0c6fdbfc99be8f3386accf1aa89abd` |

The actual fixture labels/refs differ from the brief's explanatory F5/F6 shorthand: the probability factor is F6 (`largest_client_contract_cut_likelihood`) and the share factor is F7 (`largest_client_revenue_share`). Tests bind canonical IDs and edges, not those display refs.

The probability factor has no source quote or horizon. The route harness therefore stores the attested original brief sentence separately as session `brief_text`, without modifying the fixture. Additional rows remove that evidence and verify a horizon ask, and prevent `this year` from silently becoming twelve months.

The suite contains the six required route rows, four further route controls and one pure fresh-frame dispatcher control (11 tests). The convert row pins a £44,000 conditional loss from current monthly revenue, the binary source frame and the unchanged 9-month goal horizon.

After a successful load check, run the rows with one worker:

```sh
node node_modules/vitest/vitest.mjs run src/orchestrator-v5/agent-lane/__tests__/agent-risk-likelihood-door1-seam.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --configLoader=runner
```

The mutation driver checks load, copies the current source into `/tmp`, requires a GREEN route baseline, then removes the probability-node removal, removes the duplicate-node removal, and disables existing-event detection in turn. Only a failed assertion in the corresponding convert/merge route row counts as a kill. It never edits the shared working tree. Failure messages and source checksum are retained in its JSON evidence; `--keep-temp` retains full logs.

```sh
node src/orchestrator-v5/agent-lane/__tests__/support/door1-mutants.mjs --keep-temp
```

No local test, typecheck, lint or mutant was run during authoring: `sysctl -n vm.loadavg` was blocked with `Operation not permitted`, and the brief explicitly permits skipping local execution in that case. RED-first describes the assertion-writing order, not an observed failing execution.
