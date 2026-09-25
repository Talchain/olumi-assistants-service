Each reply below is the visible answer to an explicit Run. Evidence per reply = the per-option modelled goal outcome it was given (mean, p50). In every case below `leader_may_be_named` is false unless stated.

### S1 — leader permitted: False, separation: near_tie, admission mode: quantified_provisional, run: complete_current
Evidence: [{"label": "Hire two senior engineers", "mean": -0.0169, "p50": 0}, {"label": "Hire four junior engineers", "mean": -0.0196, "p50": 0}, {"label": "Continue current staffing", "mean": -0.0204, "p50": 0}, {"label": "Hire one senior and junior", "mean": -0.0183, "p50": 0}]
~~~text
No hiring option can be put forward from this run, because the £400k annual-salary constraint was not scorable in the model.

- The comparison is **fragile**: small changes in the estimated delivery-capacity, onboarding, or salary relationships can change the ordering. All underlying figures are Olumi estimates, not user-provided evidence.
- The most influential assumption is platform delivery capacity—currently an Olumi estimate of **2 FTE-equivalent months/month**. Its source is not recorded as operational data.
- The model’s **annual salary spend ≤ £400k/year** limit could not be aligned to a comparable measured quantity, so it was excluded from the comparison. A current analysis needs that spending measure and its frame clarified.
~~~

### S2 — leader permitted: False, separation: separated, admission mode: comparative_leader, run: complete_current
Evidence: [{"label": "Two Senior Engineers", "mean": -0.013, "p50": 0}, {"label": "Four Junior Engineers", "mean": -0.0299, "p50": 0}, {"label": "Continue Current Staffing", "mean": -0.0206, "p50": 0}, {"label": "One Senior, Two Juniors", "mean": -0.0215, "p50": 0}]
~~~text
No hiring plan can be put forward from this run because the **£400k/year constraint was not checkable** against the model’s salary-spend measure.

- The comparison is **fragile**: delivery capacity is the most sensitive assumption, and it is an Olumi estimate rather than user-provided evidence. The model’s delivery, ramp-up and Q3 assumptions remain unvalidated.
- The run compared four scenarios, including two inferred alternatives, but the salary cap was excluded from their comparison; so it does not establish that any scenario stays within budget.
- The useful next reasoning step is to define how total annual salary spend should be measured against the £400k cap, including which current payroll and employment costs count.
~~~

### S3 — leader permitted: False, separation: separated, admission mode: comparative_leader, run: complete_current
Evidence: [{"label": "Raise £59 at next release", "mean": 0.1413, "p50": 0.1504}, {"label": "Keep Pro at £49", "mean": 0.1257, "p50": 0.1299}, {"label": "Raise Pro to £54", "mean": 0.1335, "p50": 0.1402}]
~~~text
This run cannot support a price decision yet, because it did not test your under‑4% churn requirement.

- The churn limit could not be scored against the model, so no option can be put forward on the stated goal.
- The result also rests partly on machine-authored inputs: monthly churn is assumed at **3% per month**, feature value at **60/100**, and non‑Pro MRR defaulted to **£0/month** because no figure was supplied.
- The comparison is moderately robust only within those provisional settings; the price-to-MRR relationship is a fragile edge, so the conclusion is especially exposed to its assumptions.

The key unresolved point is what observed churn measure the <4% limit should constrain.
~~~

### S4 — leader permitted: False, separation: near_tie, admission mode: quantified_provisional, run: complete_current
Evidence: [{"label": "Hire 2 Senior Engineers", "mean": 0.0003, "p50": 0}, {"label": "Hire 4 Junior Engineers", "mean": -0.0103, "p50": -0.0078}, {"label": "Continue Current Staffing", "mean": -0.0, "p50": 0}, {"label": "Hire 2 Junior Engineers", "mean": -0.0052, "p50": -0.0044}]
~~~text
This run cannot put either hiring plan forward because the £400k constraint was not assessed.

- Annual salary spend has no recorded option-level values, so the analysis treated all four options as unchanged on salary; that makes the central constraint unusable.
- The comparison is also very fragile: delivery capacity and onboarding load are Olumi estimates, not inputs you validated.
- The next reasoning step is to specify annual salary spend for each option—including current staffing—so the £400k limit can be tested.
~~~

### S5 — leader permitted: False, separation: separated, admission mode: comparative_leader, run: complete_current
Evidence: [{"label": "Hire 2 senior engineers", "mean": 0.0896, "p50": 0.075}, {"label": "Hire 4 junior engineers", "mean": 0.0846, "p50": 0.0708}, {"label": "Continue current staffing", "mean": 0.0948, "p50": 0.0805}, {"label": "Hire 1 senior and 2 juniors", "mean": 0.0871, "p50": 0.0729}]
~~~text
The analysis cannot answer your stated decision yet, because it did not test the **£400k/year salary limit**.

- The model could compare the hiring scenarios on its provisional shipping outcome, but no option can be put forward: salary spend is modelled as a derived change rather than a comparable annual £ figure, so the constraint was withheld.
- The comparison is **fragile**. It is particularly sensitive to delivery capacity and annual salary spend—both are assumptions you adopted, not measured inputs.
- The model also lacks an attested goal direction and a usable frame for the Q3 target.

A meaningful next step is to express salary spend as annual £ costs for the relevant hires and existing team, so the £400k limit can be checked.
~~~

### S6 — leader permitted: False, separation: separated, admission mode: comparative_leader, run: complete_current
Evidence: [{"label": "£59 on Next Release", "mean": 0.2823, "p50": 0.2753}, {"label": "Keep £49 Price", "mean": 0.2647, "p50": 0.2576}, {"label": "£55 on Next Release", "mean": 0.2753, "p50": 0.2685}]
~~~text
No option can be put forward yet, because the under-4% monthly churn limit was not checkable in this run.

- The comparison itself was robust under the changes tested, but it measures an internal outcome rather than whether churn remains below **4% per month**.
- The result rests on four Olumi estimates: active Pro subscribers, new Pro subscribers, monthly churn, and feature-release value—not user-supplied measurements.
- The most consequential uncertainty is the link from Pro price to MRR: the tested perturbation can change the ordering, so the pricing conclusion is not settled.
~~~

### S7 — leader permitted: False, separation: separated, admission mode: comparative_leader, run: complete_current
Evidence: [{"label": "£59 with Pro release", "mean": 0.1744, "p50": 0.1764}, {"label": "Keep Pro at £49", "mean": 0.157, "p50": 0.1564}, {"label": "Raise Pro to £54", "mean": 0.1657, "p50": 0.1666}]
~~~text
No option can be put forward yet, because the model did not score the churn constraint.

- The run compared £59, £49 and £54 per month, but could not test **monthly churn <4%**: churn is currently modelled as a calculated outcome rather than a measure on the constraint’s scale.
- It also could not assess whether any option reaches **£20,000/month MRR**, because the goal’s direction and threshold frame were not established in the analysis.
- The comparison is most sensitive to Pro subscriber count—currently Olumi’s estimate of **250 subscribers**, not a user-provided measurement.
~~~

### S8 — leader permitted: False, separation: separated, admission mode: comparative_leader, run: complete_current
Evidence: [{"label": "Raise Pro to £59", "mean": 0.1919, "p50": 0.1883}, {"label": "Keep Pro at £49", "mean": 0.1744, "p50": 0.167}, {"label": "Phase Pro to £54", "mean": 0.1831, "p50": 0.1777}]
~~~text
No option can be put forward yet: the analysis could not test your requirement that monthly churn stay **below 4%**.

- The price scenarios were compared, and the comparison held up under the tested perturbations, but that is not compliance with the churn limit.
- The model treats monthly churn as calculated from other inputs, rather than a measured level on the same frame as the 4% constraint; the £20k MRR threshold was also not scored against the output frame.
- The most sensitive assumption is the Pro subscriber base—currently Olumi’s estimate of **300 subscribers**, not user evidence.
~~~
