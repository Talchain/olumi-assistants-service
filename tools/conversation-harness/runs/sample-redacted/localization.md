# Localization report v0 — tools/conversation-harness/runs/s3-demo

Layers captured: wire=yes · trace=yes · l0_db=yes · display=NO · manifest=yes

## D2-chip-presence-per-question-class — FAIL
- **wire**: chips ABSENT from the failing envelope(s) -> fault is at or before composition
- **display**: not exercised — wire already lacks chips
- **conclusion**: composition-or-prompt (CEE side); check prompt chip instructions + compose keep-list

## D4-brevity — ADVISORY-FAIL
- **wire**: captured
- **conclusion**: no v0 localization rule for this dim — layers listed for manual triage

## D8-latency-budget — ADVISORY-FAIL
- **trace**: trace present but carries no substage timings
- **conclusion**: below-turn-level attribution UNMEASURABLE without substage timings

## D10-reclick-safety — UNMEASURABLE
- **l0_db**: captured
- **conclusion**: unmeasurable: journey has no concurrent_duplicate turn

## D11-production-guards — FAIL
- **wire**: guard-pattern hit in the served assistant_text itself
- **conclusion**: CEE egress (prompt-or-composition): text with a production-guard hit reached the wire — check why the egress guard did not catch it in prod
