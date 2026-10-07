# SOURCE — R5 acceptance guest scenarios

These are test-runner acceptance briefs, not customer data. Raw JSON keys and bytes and brief bytes are copied unchanged from the DL read-only exports in `/private/tmp/rv-r5-census/raw` and `briefs`. `manifest.json` identifies every scenario, drafter record, CEE build and SHA-256. Each census uses the last stored call; both clinic calls are retained. Duplicate 549f6ab8 calls in the manifest are retained as exported.

`cases.json` pins the 15 rows enumerated in `spans.json`; `base` and `r1` are the observed preparation provenance in `replay-base.json` and `replay-fixed.json`. `expected` is the r2 ruling, asserted through the production preparation/admission path.

Refusal probes in `r5-option-level-cases.ts` reproduce `/private/tmp/rv-r5-census/probes.mts`, `probes-out.txt`, `probes-build.mts`, and `probes-build-out.txt`. Clinic probes substitute one sentence in the hash-verified clinic brief; the #1841 shape has estimated Developers = 5 and explicit absolute option = 2. Additional bounded controls are labelled as such. The user-limit row uses the existing `mrr-drafter-answer-20260930.json` capture and the same planted intervention as the unchanged `construction-option-link-role.test.ts`.
