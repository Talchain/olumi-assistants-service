---
# WP1 oracle for briefs/12-similar-options.md — derived from that brief's text
# only; every entry quotes its span verbatim. Brief bytes are sha256-pinned by
# the governed manifest, so the oracle lives here. See ./README.md.
corpus_class: authored
expected_user_values:
  - value: 19
    unit: "£/month"
    role: current
    quote: "Basic (£19/mo"
  - value: 49
    unit: "£/month"
    role: current
    quote: "Pro (£49/mo"
  - value: 149
    unit: "£/month"
    role: current
    quote: "Enterprise (£149/mo"
  - value: 56
    unit: "£/month"
    role: proposed
    # PRE-ROUNDED DERIVED VALUE: 15% of £49 is £56.35 and the brief writes £56.
    # A faithful candidate must declare the transformation, not silently recompute.
    quote: "to £22, £56, £171"
  - value: 194
    unit: "£/month"
    role: proposed
    quote: "to £194"
  - value: 215000
    unit: "£"
    role: baseline
    quote: "increase MRR from £215k"
  - value: 250000
    unit: "£"
    role: target
    quote: "to £250k"
  - value: 6
    unit: "months"
    role: horizon
    quote: "within 6 months"
  - value: 5
    unit: "%"
    role: limit
    quote: "without pushing churn above 5%"
  - value: 5000
    unit: "customers"
    role: current
    quote: "5,000 total customers"
expected_constraints:
  - keyword: churn
    operator: "<="
    value: 5
    strict: true
    quote: "without pushing churn above 5%"
  - keyword: mrr
    operator: ">="
    value: 250000
    strict: false
    quote: "increase MRR from £215k to £250k"
expected_user_options: 3
expected_horizon:
  value: 6
  unit: months
  quote: "within 6 months"
controllable_levers:
  - price
  - tier
---
