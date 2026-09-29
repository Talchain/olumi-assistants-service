| Turn | class | words | bullets | ? | forbidden | mut-lang | chips | wall-ms |
|---|---|---|---|---|---|---|---|---|
| S3A0 | run_analysis | 55 | 0 | 0 | — | — | 2 | 36734 |
| S3O1 | coach | 252 | 3 | 1 | — | — | 1 | 16123 |
| S3O2 | coach | 245 | 3 | 1 | — | — | 1 | 15656 |
| S3O3 | coach | 180 | 3 | 4 | — | — | 2 | 12709 |

| Dim | verdict | note |
|---|---|---|
| D1-chip-no-repeat | PASS | fail = 2+ turns whose chip id+label set is IDENTICAL (Jaccard 1.0) to a non-empty set within the previous K turns |
| D2-chip-presence-per-question-class | FAIL | qualifying turn = assistant_text poses an either/or or enumerated-choice question (regex class, not exact text) |
| D3-question-budget | LOG | BASELINE-LOG mode: no pass/fail until ROADMAP 2.47(b) lands a ratified per-class budget |
| D4-brevity | ADVISORY-FAIL | word budget ~130 applies to coach-class turns (HARNESS-GUIDE rubric); advisory, not a gate |
| D8-latency-budget | ADVISORY-FAIL | ADVISORY budgets per turn class: coach<=30s, edit<=25s, run_analysis<=25s, draft<=75s |
| D9-consent-friction | LOG | no edit-intent turns in this journey |
| D10-reclick-safety | UNMEASURABLE |  |
| D11-production-guards | FAIL | guards are the PRODUCTION modules imported from src/ (forbidden phrases, success claims, held-science vocabulary, mutation language, structural success claims) |