---
expect_status_quo: true
has_numeric_target: false
complexity: simple
# ── WP1 oracle (frozen 21 Sep 2026). Derived from this brief's text only.
corpus_class: authored
expected_user_values:
  - value: 6
    unit: "months"
    role: horizon
    quote: "within 6 months"
  - value: 200000
    unit: "£"
    role: limit
    quote: "budget under £200k"
  - value: 2
    unit: "people"
    role: proposed
    quote: "two developers"
expected_constraints:
  - keyword: budget
    operator: "<="
    value: 200000
    strict: true
    quote: "budget under £200k"
expected_user_options: 2
expected_horizon:
  value: 6
  unit: months
  quote: "within 6 months"
controllable_levers:
  - hire
---

Should I hire a tech lead or two developers to ship AI features within 6 months, budget under £200k?
