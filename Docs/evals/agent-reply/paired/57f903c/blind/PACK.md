# Reply review pack

You are reviewing replies written by an AI assistant (Olumi) inside a decision-modelling product. For each case you get a short context card, then two or three replies to exactly the same situation. The replies are labelled with letters in a random order that differs per case. Judge only the text shown; nothing else distinguishes the replies.

The replies are shown exactly as the user would see them. There are 5 cases. (A further discussion-card case produced no reply text in any version and is not included.)

## Case 1

### Context

- **What the user asked** (the first message of a new decision): “Should I hire a Tech lead or two developers to increase productivity?”
- **What Olumi did this turn** (the same for every reply below): built a first model with the options “Hire Tech Lead”, “Hire Two Developers”, “Maintain Current Staffing”, “Hire One Developer”; then proposed starting values for the user to approve or change. Nothing has been adopted yet and no analysis has been run.
- **Figures Olumi proposed** (Olumi’s assumptions, not the user’s and not measurements): Coordination quality = 50 index points out of 100; Developer hires = 0 hires; Engineering capacity = 50 index points out of 100; Onboarding demand = 0 additional hires being onboarded; Tech lead hires = 0 hires; Technical direction quality = 50 index points out of 100. Option levels: Maintain Current Staffing: Developer hires = 0; Maintain Current Staffing: Tech lead hires = 0.
- **Whether a leading option may be named:** no — nothing has been analysed.
- **Controls shown under the reply:** “Use as starting assumptions” · “Change something first” · “Run analysis”.
- **What the approval control does in this product:** pressing “Use as starting assumptions” saves the proposed values as one change and does not run the analysis. If the user instead types an approval (e.g. “yes”), the assistant handles it in its next turn, so what happens then depends on that turn and is not fixed by the product.
- **Text Olumi adds under every reply:** each reply below ends with the same paragraph written by Olumi’s server (“The model was saved. Questions this model does not answer yet: …”). It is identical in every reply for this case.

### Replies (2)

#### Reply A

~~~~text
It depends chiefly on whether your bottleneck is leadership/coordination or hands-on delivery; the model cannot yet distinguish them.

I’ve set up the comparison, including “maintain staffing” and “hire one developer” as inferred alternatives. It needs six starting assumptions. These are **assumptions to test, not measurements**:

- Current capacity, coordination, and technical direction: **50/100** each (neutral placeholders); current additional developer and Tech Lead hires: **0**; onboarding demand: **0**.
- “Maintain current staffing” would set both additional developer and Tech Lead hires to **0**.

These rest on no team baseline being provided. Adopt these starting assumptions?

The model was saved. Questions this model does not answer yet: What is the current team size and current productivity baseline? How much delivery work would a new Tech Lead perform directly versus spend on leadership and coordination? What is the expected onboarding time and available mentoring capacity for additional developers?
~~~~

#### Reply B

~~~~text
I’ve set up a comparison model. It includes your two options, plus **maintain current staffing** and **hire one developer** as reference cases.

The model says all four can affect productivity, but it cannot compare them yet: **six factors have no starting values**, and “maintain current staffing” currently has no recorded effect. The build also surfaced the key unknowns: current team size/productivity, how hands-on the Tech Lead would be, and onboarding/mentoring capacity.

I can record the following as **my starting assumptions — not measurements — for you to adopt or correct**:

**Current starting point**
- Developer hires: **0 hires**
- Tech Lead hires: **0 hires**
- Engineering capacity: **50/100** (neutral placeholder)
- Coordination quality: **50/100** (neutral placeholder)
- Technical direction quality: **50/100** (neutral placeholder)
- Onboarding demand: **0 additional hires being onboarded**

**What each option sets**
- **Hire Tech Lead:** 1 Tech Lead hire  
- **Hire Two Developers:** 2 developer hires  
- **Maintain Current Staffing:** 0 developer hires; 0 Tech Lead hires  
- **Hire One Developer:** 1 developer hire  

The proposal could not record “zero hires” against factors an option does not actually affect; those are deliberately left out rather than forcing links that are not in the model.

If you approve these starting assumptions, I’ll save them and run the comparison.

The model was saved. Questions this model does not answer yet: What is the current team size and current productivity baseline? How much delivery work would a new Tech Lead perform directly versus spend on leadership and coordination? What is the expected onboarding time and available mentoring capacity for additional developers?
~~~~

## Case 2

### Context

- **What the user asked** (the first message of a new decision): “Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?”
- **What Olumi did this turn** (the same for every reply below): built a first model with the options “Keep £49 With Release”, “Raise to £59 With Release”, “Phase Price After Release”; then proposed starting values for the user to approve or change. Nothing has been adopted yet and no analysis has been run.
- **Figures Olumi proposed** (Olumi’s assumptions, not the user’s and not measurements): Monthly churn = 3 %; Pro conversion rate = 5 %; Pro feature value = 70 out of 100; Pro subscriber count = 250 subscribers. Option levels: Keep £49 With Release: Pro feature value = 70; Phase Price After Release: Pro feature value = 70; Phase Price After Release: Pro plan price = 59 GBP/month; Raise to £59 With Release: Pro feature value = 70.
- **Whether a leading option may be named:** no — nothing has been analysed.
- **Controls shown under the reply:** “Use as starting assumptions” · “Change something first” · “Run analysis”.
- **What the approval control does in this product:** pressing “Use as starting assumptions” saves the proposed values as one change and does not run the analysis. If the user instead types an approval (e.g. “yes”), the assistant handles it in its next turn, so what happens then depends on that turn and is not fixed by the product.
- **Text Olumi adds under every reply:** each reply below ends with the same paragraph written by Olumi’s server (“The model was saved. Questions this model does not answer yet: …”). It is identical in every reply for this case.

### Replies (2)

#### Reply A

~~~~text
I’ve set up a comparison model with three paths: keep £49 with the release, raise to £59 with it, or phase the increase after it.

Your stated facts are: current Pro price **£49/month**, a target of **£20k MRR**, and monthly churn to remain **under 4%**. The 12‑month horizon is retained in the decision record, though the model’s goal projection cannot encode the deadline itself.

To run a first comparison, adopt or correct these **machine-authored starting assumptions — not measurements**:

- Current monthly churn: **3%** — a working baseline below the 4% limit.
- Pro conversion rate: **5%** — provisional, pending your funnel data.
- Current Pro subscribers: **250 subscribers** — provisional revenue base.
- Feature-release value: **70/100** — assumes a meaningfully valuable release.

And the options would be recorded as:

- **Keep £49 With Release:** feature value **70/100**; price remains **£49/month**.
- **Raise to £59 With Release:** feature value **70/100**; price **£59/month**.
- **Phase Price After Release:** feature value **70/100**; ultimately **£59/month**. Timing and any intermediate price are not represented, so this is a simplified phased path.

These figures are assumptions to test, not claimed evidence. If you approve this exact starting point, I’ll save it and run the comparison.

The model was saved. Questions this model does not answer yet: What are the current Pro conversion rate, Pro subscriber count, and monthly churn rate? How much customer value will the next Pro feature release add, and will it be available at the same time as the price change? How price-sensitive are prospective and existing Pro customers at £59 per month?
~~~~

#### Reply B

~~~~text
Not yet: the model needs baseline commercial assumptions before it can test the £59 change against MRR and churn.

It represents three paths—keep £49 with the release, raise to £59 with it, or phase the increase—but the 12‑month deadline is retained only in the brief, not the calculation.

I’ve prepared one set of **assumptions, not measurements**, to enable a first comparison:

- Current Pro base: **250 subscribers**; conversion: **5%**; monthly churn: **3%**.
- Feature value: **70/100** for the next release.
- The release is set to **70/100** under all three paths; the phased path ultimately sets price to **£59/month**.

These are reasoned starting points to adopt or correct. Shall I apply this set?

The model was saved. Questions this model does not answer yet: What are the current Pro conversion rate, Pro subscriber count, and monthly churn rate? How much customer value will the next Pro feature release add, and will it be available at the same time as the price change? How price-sensitive are prospective and existing Pro customers at £59 per month?
~~~~

## Case 3

### Context

- **What the user asked** (the first message of a new decision): “Should our hospital emergency department add a second triage nurse on night shifts or open a rapid-assessment unit, given 4-hour waits breach 30% of nights?”
- **What Olumi did this turn** (the same for every reply below): built a first model with the options “Second triage nurse”, “Rapid-assessment unit”, “Maintain current setup”, “Phased rapid assessment”; then proposed starting values for the user to approve or change. Nothing has been adopted yet and no analysis has been run. (A first proposal was refused by Olumi as incomplete and replaced by the one below.)
- **Figures Olumi proposed** (Olumi’s assumptions, not the user’s and not measurements): ED patient flow = 80 patients per night; Night-shift triage staffing = 1 nurses; Rapid-assessment capacity = 0 patients per night; Time to clinician assessment = 90 minutes; Time to triage = 20 minutes. Option levels: Maintain current setup: Night-shift triage staffing = 1; Maintain current setup: Rapid-assessment capacity = 0; Phased rapid assessment: Rapid-assessment capacity = 10; Rapid-assessment unit: Rapid-assessment capacity = 20.
- **Whether a leading option may be named:** no — nothing has been analysed.
- **Controls shown under the reply:** “Use as starting assumptions” · “Change something first”.
- **What the approval control does in this product:** pressing “Use as starting assumptions” saves the proposed values as one change and does not run the analysis. If the user instead types an approval (e.g. “yes”), the assistant handles it in its next turn, so what happens then depends on that turn and is not fixed by the product.
- **Text Olumi adds under every reply:** each reply below ends with the same paragraph written by Olumi’s server (“The model was saved. Questions this model does not answer yet: …”). It is identical in every reply for this case.

### Replies (2)

#### Reply A

~~~~text
I’ve set up the comparison around reducing 4-hour wait breaches, currently reported on 30% of nights.

To make it analysable, these are **my assumptions, not measurements**—adopt or correct them:

- Current overnight state: 1 triage nurse; no rapid-assessment capacity; 80 patients/night; 20 minutes to triage; 90 minutes to clinician assessment.
- Options: maintain current setup = 1 nurse and 0 rapid-assessment patients/night; phased rapid assessment = 10 patients/night; full rapid-assessment unit = 20 patients/night.
- A second triage nurse is already represented as increasing triage staffing.

Say **yes** to adopt this complete starting point, or tell me which figures to alter.

The model was saved. Questions this model does not answer yet: The stated current incidence is that 4-hour waits breach on 30% of nights; what reduction target should the decision be assessed against? What are the current night-shift triage staffing level, rapid-assessment capacity, triage time, clinician-assessment time, and ED patient flow? Would a rapid-assessment unit use additional staff or redeploy existing night-shift staff? What scope and operating hours would a phased rapid-assessment option have?
~~~~

#### Reply B

~~~~text
I’ve created a comparison model around the shared goal of reducing **4-hour wait breaches**, currently stated as occurring on **30% of nights**. It includes:

- **Second triage nurse** and **rapid-assessment unit** (your options)
- **Maintain current setup** and **phased rapid assessment** (comparison cases)
- Relevant drivers: overnight triage staffing, rapid-assessment capacity, time to triage, time to clinician assessment, and overnight ED flow.

The model still needs starting levels before it can compare options. I have **not** treated these as measurements; they are assumptions for you to adopt or correct:

| Item | Starting assumption | Basis |
|---|---:|---|
| Overnight ED flow | 80 patients/night | Illustrative night volume; replace with local arrivals |
| Dedicated night triage staffing | 1 nurse | Assumes one current triage nurse |
| Current rapid-assessment capacity | 0 patients/night | Assumes no overnight RAU |
| Time to triage | 20 minutes | Illustrative for recurrent breach nights |
| Time to clinician assessment | 90 minutes | Illustrative affected-night performance |
| Maintain current setup | 1 triage nurse; 0 RAU patients/night | No service change |
| Phased rapid assessment | 10 patients/night | Illustrative limited overnight scope |
| Rapid-assessment unit | 20 patients/night | Illustrative full overnight RAU scope |

The second-triage-nurse option already has an implied modelled level of **two dedicated triage nurses**.

The model also cannot yet determine a target—for example, whether you need breaches below 20%, 10%, or another level—and it does not yet capture whether an RAU would require extra staff or redeploy existing staff. Those are important uncertainties, not facts.

If you approve these starting assumptions, I’ll save them together and run the comparison.

The model was saved. Questions this model does not answer yet: The stated current incidence is that 4-hour waits breach on 30% of nights; what reduction target should the decision be assessed against? What are the current night-shift triage staffing level, rapid-assessment capacity, triage time, clinician-assessment time, and ED patient flow? Would a rapid-assessment unit use additional staff or redeploy existing night-shift staff? What scope and operating hours would a phased rapid-assessment option have?
~~~~

## Case 4

### Context

- **The conversation so far:** the user’s brief was “Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?”. Olumi built a model and proposed starting values; the user replied “Yes, use those.” (so those Olumi-proposed values are now in the model). The user then pressed **Run analysis**.
- **Values now in the model** (proposed by Olumi in its earlier reply and adopted by the user — Olumi’s assumptions, not measurements): Monthly churn: 3% · Pro subscriber base: 250 subscribers · Pro conversion rate: 5% · Perceived Pro value: 60% · Price–release alignment: 50% · MRR per Pro subscriber: £49/month · Raise Pro to £59 at release: price–release alignment 100% · Phase Pro price increase: Pro price £54/month and price–release alignment 50% · The existing model already has £49/month for keeping price flat and £59/month for the direct increase
- **Run result:** the analysis ran and completed. Options: “Keep Pro at £49”, “Phase Pro price increase”, “Raise Pro to £59 at release”. Share of simulations in which each option had the highest modelled outcome: Keep Pro at £49 15.39%; Phase Pro price increase 1.33%; Raise Pro to £59 at release 83.28%. Robustness: high.
- **Olumi’s result card beside the reply says:** “Ran analysis on your current scenario. One limit on your model could not be checked: “Monthly churn rate < 4%”. We could not line it up with anything this analysis measures, so it was not part of the comparison. The part of your model it points at is worked out from other parts, so it has no measured starting point of its own, and restating the limit cannot give it one. Tell me which part of your model it applies to and I will record it there; this one stays on the model. Then run the analysis again.”
- **Factor sensitivity order the assistant was given** (most to least): Monthly churn rate > Pro subscriber base > MRR per Pro subscriber > Perceived Pro value > Pro conversion rate > Price-release alignment > Pro plan price.
- **Switch points tested:** Pro plan price (now 49 £ per month): no switch found (structurally invariant); Price-release alignment (now 50 %): the ordering switches towards “Keep Pro at £49” if it is changed (direction: increase) to 97.92 %.
- **What each option sets in the model:** “Keep Pro at £49”: pro plan price 49 £ per month; “Raise Pro to £59 at release”: pro plan price 59 £ per month, price release alignment 100%; “Phase Pro price increase”: pro plan price 54 £ per month, price release alignment 50%.
- **Whether a leading option may be named:** no — Olumi withholds the leader claim (reason: constraint verdict withheld). No option may be named or ranked as leading, and the percentages may not be used as a ranking.
- **Controls shown under the reply:** none.
- **This reply is an explanation only:** the assistant could not act on this turn.

### Replies (3)

#### Reply A

~~~~text
**Model finding:** on the current assumptions, **raising Pro to £59 with the feature release leads the MRR comparison**. It led in 83.28% of the model’s simulated cases, versus 15.39% for keeping £49 and 1.33% for phasing the rise. The run describes this ordering as robust under the changes it tested.

Why it appears: the £59 option combines **£59/month** per Pro subscriber with **100% price–release alignment**, whereas the phased route is modelled at **£54/month** and **50% alignment**. This result rests on the planning assumptions previously adopted, rather than observed conversion or retention evidence.

**Critical limitation:** it does **not** answer whether the £59 change keeps monthly churn below **4%**. The model could not score that constraint: monthly churn is calculated from other factors, and the constraint has no specified value frame or compatible measured baseline. As a result, the comparison is an MRR ordering only—not evidence that any option satisfies the churn limit or achieves **£20,000 MRR within 12 months**.

The ordering can change in the model if price–release alignment is lower: in the tested sensitivity, reducing that alignment from the phased assumption of **50%** was sufficient to switch the ordering towards keeping Pro at £49 at an alignment of **97.92%** in the stated test context. That is a tested switch condition, not a measure of overall stability or an observed customer response.
~~~~

#### Reply B

~~~~text
The comparison is incomplete: it could not assess the **monthly churn under 4%** constraint, so it cannot answer whether £59 meets both of your stated conditions. On the model’s current assumptions, the £59-at-release path produced the strongest MRR comparison, but that is not a recommendation or a verified constraint-safe result.

- The comparison assumes that higher MRR is the objective; that direction was not explicitly recorded.
- Monthly churn is the most influential assumption, and its current **3%** is a user-adopted planning estimate, not a measurement.
- The next useful step is to define how the 4% churn limit should be evaluated against the model, then rerun.
~~~~

#### Reply C

~~~~text
The £59-at-release path produces the highest MRR outcome in this model, but it does **not** answer whether it keeps churn below 4%.

- That result rests on the adopted assumptions, especially the assumed **3% monthly churn**, **250 Pro subscribers**, and the feature’s perceived value. The comparison was robust under the modelled tests, though confidence remains provisional.
- The churn constraint was not scored: “under 4%” could not be aligned with the model’s calculated churn measure, and the £20k MRR threshold was also not assessed against a baseline level.
- The ordering can flip in a tested scenario if price–release alignment rises from the assumed **50%** to **97.92%**; this shows that change can flip the ordering, not that it is the most important assumption to investigate.

So this is directional support for £59 with the release, not a conclusion that it satisfies your churn guardrail.
~~~~

## Case 5

### Context

- **The conversation so far:** the user’s brief was “Should I hire a Tech lead or two developers to increase productivity?”. Olumi built a model and proposed starting values; the user replied “Yes, use those.” (so those Olumi-proposed values are now in the model). The user then pressed **Run analysis**.
- **Values now in the model** (proposed by Olumi in its earlier reply and adopted by the user — Olumi’s assumptions, not measurements): Tech-lead capacity: 4 capacity points (0–10) · Developer capacity: 8 capacity points (0–20) · Work prioritisation: 60 index points (0–100) · Engineering coordination: 60 index points (0–100) · Delivery capacity: 12 capacity points (0–30) · New-hire ramp-up: 50 index points (0–100) · Hire a Tech Lead → Tech-lead capacity: 8 · Hire One Developer → Developer capacity: 10 · Hire Two Developers → Developer capacity: 12
- **Run result:** the analysis did NOT run (status: blocked). “Continue Current Staffing” sets no level on any factor, so it cannot be compared. Ready options: “Hire a Tech Lead” (8 capacity points (0–10)); “Hire Two Developers” (12 capacity points (0–20)); “Hire One Developer” (10 capacity points (0–20)).
- **Whether a leading option may be named:** no — Olumi withholds the leader claim (reason: constraint verdict withheld). No option may be named or ranked as leading, and the percentages may not be used as a ranking.
- **Controls shown under the reply:** “Suggest what it still needs”.
- **This reply is an explanation only:** the assistant could not act on this turn.

### Replies (3)

#### Reply A

~~~~text
The comparison cannot run yet because **“Continue Current Staffing” has no factor connection or stated effect**. That blocks the whole model, even though the Tech Lead and developer options are otherwise ready.

For a genuine baseline, it would normally set:
- Tech-lead capacity to **4 capacity points (0–10)**
- Developer capacity to **8 capacity points (0–20)**

Those are the current-position assumptions already used in the model, not new measurements. The model also requires that this option is linked to at least one factor before it can be analysed.
~~~~

#### Reply B

~~~~text
The comparison did not run because **Continue Current Staffing** has no defined effect in the model.

To include it, specify which factor it changes and to what level—most plausibly, it could leave developer capacity at **8 capacity points (0–20)** and tech-lead capacity at **4 capacity points (0–10)**. Those would be assumptions to test, not measurements.
~~~~

#### Reply C

~~~~text
The analysis cannot run because **Continue Current Staffing** is not connected to any factor.

The other hiring options are ready, but this option blocks the whole comparison. We need to state what maintaining staffing changes — for example, whether it leaves developer capacity at **8 capacity points (0–20)** and tech-lead capacity at **4 capacity points (0–10)**, or whether you expect either to change over the period considered.
~~~~

## Scoring rubric

Score every reply on each criterion: **0** = not met, **1** = partly met, **2** = fully met. If a criterion cannot apply to a case, score 2 and write “n/a”.

1. **Concise** — About 90 words or fewer by default in the assistant’s own words; longer only when the content needs it. No minimum.
2. **Shape** — Opens with a lead sentence; then at most 3 bullets.
3. **Decisive caveat** — The one caveat that changes what the user may conclude is stated plainly.
4. **Next move** — At most one next move, offered only when the state supports it.
5. **Questions** — At most one question.
6. **Leader honesty** — When a leading option may not be named: no option is named or ranked as leading, and percentages are not used as a ranking.
7. **Nothing invented** — No claimed or promised save, run, edit, leader, sensitivity, evidence, assumption or numerical comparison that the context does not support.
8. **Attribution** — Olumi’s estimates are attributed to Olumi; the user’s or measured figures are never called estimates.
9. **Provisional vs validated** — A provisional result is not presented as a validated conclusion.
10. **Fidelity** — Option names, units and constraints are preserved exactly.
11. **Uncertainty** — Uncertainty is handled honestly — neither hidden nor overstated.
12. **Useful next step** — The takeaway or next step helps the user make the decision.

## Reply template (please fill in)

### Case 1

| Criterion | Reply A | Reply B |
|---|---:|---:|
| Concise |   |   |
| Shape |   |   |
| Decisive caveat |   |   |
| Next move |   |   |
| Questions |   |   |
| Leader honesty |   |   |
| Nothing invented |   |   |
| Attribution |   |   |
| Provisional vs validated |   |   |
| Fidelity |   |   |
| Uncertainty |   |   |
| Useful next step |   |   |
| **Total (0–24)** |   |   |

- Reply A — one-line reason:
- Reply B — one-line reason:
- Preferred reply (one letter):

### Case 2

| Criterion | Reply A | Reply B |
|---|---:|---:|
| Concise |   |   |
| Shape |   |   |
| Decisive caveat |   |   |
| Next move |   |   |
| Questions |   |   |
| Leader honesty |   |   |
| Nothing invented |   |   |
| Attribution |   |   |
| Provisional vs validated |   |   |
| Fidelity |   |   |
| Uncertainty |   |   |
| Useful next step |   |   |
| **Total (0–24)** |   |   |

- Reply A — one-line reason:
- Reply B — one-line reason:
- Preferred reply (one letter):

### Case 3

| Criterion | Reply A | Reply B |
|---|---:|---:|
| Concise |   |   |
| Shape |   |   |
| Decisive caveat |   |   |
| Next move |   |   |
| Questions |   |   |
| Leader honesty |   |   |
| Nothing invented |   |   |
| Attribution |   |   |
| Provisional vs validated |   |   |
| Fidelity |   |   |
| Uncertainty |   |   |
| Useful next step |   |   |
| **Total (0–24)** |   |   |

- Reply A — one-line reason:
- Reply B — one-line reason:
- Preferred reply (one letter):

### Case 4

| Criterion | Reply A | Reply B | Reply C |
|---|---:|---:|---:|
| Concise |   |   |   |
| Shape |   |   |   |
| Decisive caveat |   |   |   |
| Next move |   |   |   |
| Questions |   |   |   |
| Leader honesty |   |   |   |
| Nothing invented |   |   |   |
| Attribution |   |   |   |
| Provisional vs validated |   |   |   |
| Fidelity |   |   |   |
| Uncertainty |   |   |   |
| Useful next step |   |   |   |
| **Total (0–24)** |   |   |   |

- Reply A — one-line reason:
- Reply B — one-line reason:
- Reply C — one-line reason:
- Preferred reply (one letter):

### Case 5

| Criterion | Reply A | Reply B | Reply C |
|---|---:|---:|---:|
| Concise |   |   |   |
| Shape |   |   |   |
| Decisive caveat |   |   |   |
| Next move |   |   |   |
| Questions |   |   |   |
| Leader honesty |   |   |   |
| Nothing invented |   |   |   |
| Attribution |   |   |   |
| Provisional vs validated |   |   |   |
| Fidelity |   |   |   |
| Uncertainty |   |   |   |
| Useful next step |   |   |   |
| **Total (0–24)** |   |   |   |

- Reply A — one-line reason:
- Reply B — one-line reason:
- Reply C — one-line reason:
- Preferred reply (one letter):

