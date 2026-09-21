---
# WP1 oracle for briefs/pricing-staging-b.md — the PERTURBED pricing brief.
# Lives in a sidecar because another lane owns that brief file; the mechanism is
# the same one the sha256-pinned briefs use. See ./README.md.
#
# corpus_class: captured — the DECISION is Paul's real one and every expected
# value is his; only the WORDING is a perturbation. It is not an independently
# captured brief, and it must not be counted as a second capture when the
# capture/authored split is reported (amendment 4).
corpus_class: captured
expected_user_values:
  - value: 20000
    unit: "£"
    role: target
    quote: "target is £20k MRR"
  - value: 12
    unit: "months"
    role: horizon
    quote: "within 12 months"
  - value: 4
    unit: "%"
    role: limit
    quote: "under 4%"
  - value: 49
    unit: "£/month"
    role: current
    quote: "from £49"
  - value: 59
    unit: "£/month"
    role: proposed
    quote: "to £59 a month"
expected_constraints:
  - keyword: churn
    operator: "<="
    value: 4
    strict: true
    quote: "Monthly churn needs to stay under 4%"
expected_user_options: 1
expected_horizon:
  value: 12
  unit: months
  quote: "within 12 months"
expected_temporal:
  - "feature release"
controllable_levers:
  - price
---
