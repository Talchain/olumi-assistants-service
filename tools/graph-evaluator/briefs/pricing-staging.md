---
expect_status_quo: true
has_numeric_target: true
complexity: moderate
# ── WP1 oracle (frozen with the evaluation contract, 21 Sep 2026) ────────────
# Derived from THIS BRIEF'S TEXT ONLY; every entry quotes its span verbatim.
# corpus_class: captured — this is Paul's real brief, not an authored fixture.
corpus_class: captured
expected_user_values:
  - value: 20000
    unit: "£"
    role: target
    quote: "£20k MRR"
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
    quote: "to £59 per month"
expected_constraints:
  # "under 4%" is STRICT. The operator recorded here is the closest the target
  # grammar can express (@talchain/schemas allows only ">=" / "<="); `strict`
  # carries the real semantics and G4 is what enforces it.
  - keyword: churn
    operator: "<="
    value: 4
    strict: true
    quote: "keeping monthly churn under 4%"
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

Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?
