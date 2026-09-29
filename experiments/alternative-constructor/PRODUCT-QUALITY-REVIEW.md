# Independent product-quality review, four frozen cases

Question: **Does this model make the decision easier to understand and improve?**

Track C agent judgement of saved offline outputs, not a human-user study, fresh live comparison or deterministic fidelity score. A is the current-port M1 replay; B is the hire-scope compiler replay at `eb87db0`. Previous lead ratings are preserved separately. Fidelity comes before richness. Scores use 1 = obstructive, 2 = partial, 3 = useful with material gaps, 4 = strong, 5 = practically complete for the stated work.

| Case | A | B |
|---|---|---|
| paul-mrr | **3/5.** It preserves all stated figures and separates suggestions, but duplicated scope questions and an outcome-as-question leave the user without a small actionable next step. | **3/5.** It preserves the figures and exposes the real revenue-scope uncertainty, but asks a redundant option-binding question and still cannot compare outcomes. |
| cloud | **1/5.** It drops the explicitly supplied £45k monthly baseline and falsely says the brief does not state it, so the model and recovery text obscure the central cost-reduction question. | **2/5.** It retains £45k and the downtime limit, but misreads the 20% goal as an unassigned option change and asks the user to repair that interpretation. |
| E | **2/5.** It retains both hiring choices and the salary cap, but parks the two/four hires behind avoidable current-hires questions and creates unnecessary recovery work. | **3/5.** It correctly models two/four new hires without guessing total staffing, but the untyped Q3 deadline and a question that repeats the whole brief offer little help toward comparison. |
| support | **3/5.** It keeps current staffing, workload, CSAT, target, horizon and the no-hiring limit, but its generic effect question does not identify the smallest useful evidence to obtain. | **2/5.** It keeps the main figures but treats no hiring as a risk rather than a constraint and asks for a numeric level of the email channel instead of clarifying live-chat effects. |

**Decision evidence:** no overall product-quality winner. B now represents hiring amounts more directly; A preserves the support no-hiring constraint. Neither produces a satisfactory cloud model, and all eight outputs need better next-step guidance. These ratings do not justify replacing A with B yet. The highest-value bounded improvement is retaining cloud £45k current spend and its 20% reduction target on the same quantity with their correct roles, without asking for facts already supplied.

The synthetic journey is separate. Its settled Canvas calls “Keep Pro price” a “Baseline option”, although the saved candidate says `is_status_quo: false`, subscribers change from 1,000 to 1,120, and Run `analysis_ready` says `is_baseline: false`. This is a Canvas label mismatch; it is not an A payload or scientific Run classification. No UI patch was made.

Exact artifact paths and SHA256 values are in `.artifacts/alternative-constructor/product-quality-review-20260929.json`. No new provider attempt or scenario was used.
