---
# CORRECTED FIXTURE. The recovered original encoded the relaxation its own prose forbids
# ("under" as <=, "above" as >=). Operators restored to strict + strict: true.
# ⛔ EXPECTED: today's CEE FAILS these cases — its wire operator enum is [">=","<="] and no
# producer emits strictness/relaxed_to. That failure is the deliverable, not a regression.
expect_status_quo: true
has_numeric_target: true
complexity: complex
expect_external_factor: true
expected_constraints:
  - keyword: churn
    operator: "<"
    strict: true
    value: 0.04
    can_exceed_one: false
  - keyword: NRR
    operator: ">"
    strict: true
    value: 1.10
    can_exceed_one: true
ratio_metrics:
  - keyword: NRR
    expected_min: 1.0
---

We're deciding whether to build a dedicated mid-market product tier, move upmarket with a sales-led motion, or partner with agencies. Our goal is to reach 800 mid-market customers within 12 months while keeping monthly churn under 4% and maintaining NRR above 110%. We currently have 320 mid-market customers, NRR is 104%, and churn is 3.6%.
