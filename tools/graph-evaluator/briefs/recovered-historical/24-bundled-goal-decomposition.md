---
expect_status_quo: true
has_numeric_target: true
complexity: complex
expect_external_factor: false
expected_constraints:
  - keyword: acquisition cost
    operator: "<="
    value: 500
    can_exceed_one: false
  - keyword: churn
    operator: "<="
    value: 0.03
    can_exceed_one: false
ratio_metrics: []
---

Help us reach £50k MRR while keeping customer acquisition cost under £500 and maintaining monthly churn below 3%. We currently have 200 customers paying £20/month average. We're considering raising prices, launching a freemium tier, or investing in content marketing.
