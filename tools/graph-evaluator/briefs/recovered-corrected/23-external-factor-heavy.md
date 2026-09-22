---
# CORRECTED FIXTURE. The recovered original encoded the relaxation its own prose forbids
# ("under" as <=, "above" as >=). Operators restored to strict + strict: true.
# ⛔ EXPECTED: today's CEE FAILS these cases — its wire operator enum is [">=","<="] and no
# producer emits strictness/relaxed_to. That failure is the deliverable, not a regression.
expect_status_quo: true
has_numeric_target: false
complexity: complex
expect_external_factor: true
expected_constraints:
  - keyword: margin
    operator: ">"
    strict: true
    value: 0.15
    can_exceed_one: false
ratio_metrics: []
---

Should we enter the US market now or wait 12 months? We're a UK fintech with £2M runway. US competitors are consolidating, regulation is shifting towards open banking, and the dollar-pound exchange rate has been volatile. Our product handles FCA compliance but not SEC requirements. We need to maintain profitability with margins above 15%.
