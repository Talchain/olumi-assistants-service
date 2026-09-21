---
# WP1 oracle for briefs/02-multi-option-constrained.md. See ./README.md.
corpus_class: authored
expected_user_values:
  - value: 15
    unit: "%"
    role: target
    quote: "achieve 15% revenue growth"
  - value: 18
    unit: "months"
    role: horizon
    quote: "within 18 months"
  - value: 2000000
    unit: "£"
    role: limit
    quote: "below £2M"
  - value: 35
    unit: "people"
    role: current
    quote: "current team is 35 people"
expected_constraints:
  - keyword: cost
    operator: "<="
    value: 2000000
    strict: true
    quote: "keeping total expansion costs below £2M"
  - keyword: growth
    operator: ">="
    value: 15
    strict: false
    quote: "achieve 15% revenue growth"
expected_user_options: 3
expected_horizon:
  value: 18
  unit: months
  quote: "within 18 months"
expected_qualitative:
  - "regulation"
  - "currency risk"
  - "barrier to entry"
  - "international experience"
controllable_levers:
  - market
  - hire
---
