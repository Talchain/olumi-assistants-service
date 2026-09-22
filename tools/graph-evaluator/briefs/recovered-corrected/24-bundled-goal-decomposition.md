---
# CORRECTED FIXTURE. The recovered original encoded the relaxation its own prose forbids
# ("under" as <=, "above" as >=). Operators restored to strict + strict: true.
# ⛔ EXPECTED: today's CEE FAILS these cases — its wire operator enum is [">=","<="] and no
# producer emits strictness/relaxed_to. That failure is the deliverable, not a regression.
expect_status_quo: true
has_numeric_target: true
complexity: complex
expect_external_factor: false
expected_constraints:
  - keyword: acquisition cost
    operator: "<"
    strict: true
    value: 500
    can_exceed_one: false
  - keyword: churn
    operator: "<"
    strict: true
    value: 0.03
    can_exceed_one: false
ratio_metrics: []
---

Help us reach £50k MRR while keeping customer acquisition cost under £500 and maintaining monthly churn below 3%. We currently have 200 customers paying £20/month average. We're considering raising prices, launching a freemium tier, or investing in content marketing.
