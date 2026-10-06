# MC unsized-link build: CEE #2673 @ 8bc5bd6a6e9ad5fbddccd3d9c1bf15c3c28c01e7 (draft, HIGH, CLEAN), 6 Oct 12:37Z
| draft | unsized links (first Run) | does the brief state a size? | class |
|---|---|---|---|
| dental-4 / dental-20 | 2 / 4 (invented *fee* risks) | no; no target or level either | legit ask + invented |
| bakery-6 | 7 | "£40k a year each": not bound, which step dropped it is UNVERIFIED; "60 cafés at £300": product (#2663); margin: no | legit + product + unbound |
| arch-10 | 6 | the brief has no figures | legit ask |
| consult-12 | 6 | "150 days a year" / "£95k each": products (#2663); total days not stated | product + legit |
| investor-18 | 1 (invented "Revenue lost to … delay") | no | #2662 cut stays off until "20%→30%" binds (#2668) |
| mealkit-14 | 6 (2 invented) | no | legit + invented |
| support-8 | 4 (2 invented) | "4% … against 1.5%" (a group contrast) | contrast (Science) + legit + invented |
- **Legit asks dominate.** In the 23 non-T1b drafts, 70/74 unsized links have no figure in the brief and 48/74 have an end with no unit or size. The runner answered 0 times on 7/8, because it only answers from brief facts.
- **Support-8 loop.** The runner re-sent the brief sentence 3 times. The agent made 0 tool calls and said "not represented" because `_not_modelled` lists the figures as absent. It asked for the share waiting over a day twice (turns 5 and 11) and for overall churn once (turn 8). The door refuses the sentence anyway: no node carries a share.
- **Class picked.** The door re-asks for a figure the answer already gave: a switch's figure, or a figure inside the user's own range. Both readings are already Science-ruled at construction. It covers 0/8 witness fails directly; it does cover 8 banked T1b drafts plus g1-2633t d1, which was refused live @c787820.
- **User-visible change.** "…would win about 150 new subscribers, between 80 and 250" now gets the card `Record: turning on "Starter tier launched" → +150 subscribers…`. On approval it is stored as the user's 150 with its 80–250 range, and the link is held. Before, Olumi asked "…rather than a range?" or "…in figures?".
- **Bench (97 drafts).** 20 → 20; T1b 19/53 → 19/53; other briefs 1/44 → 1/44; PASS→FAIL 0 (8074ecac→8bc5bd6a and f9aa21fc→ace7c292). The bench replays the Run, so it cannot see the answer door. A closest 0-LLM door replay gives switch→subscribers 0/8 → 8/8 written and held, and the 3 declared non-T1b answers 0/3 → 0/3.
- **Tests.** 21 rows on real banked graphs: 10 RED at staging, 21/21 GREEN. Mutants 7/7 RED. Neighbour tests (local): 368 + 211 passed. tsc build: exit 0.
- **CI round 1 (ace7c292).** Required tests 3/5 and 5/5 went RED, caused by this PR. 4 whole route-v2 files hit a `configHolder` TDZ because my import pulled in factor-extraction → config. Fixed in 49a9db5f by moving `centreRangeAt` into stated-by-user. No row was re-picked; staging was merged in.
- **Required @8bc5bd6a.** All success: "Required — lint, typecheck, guards" and "Required — tests" 1/5, 2/5, 3/5, 4/5 and 5/5. "Lint, TypeCheck, Unit Tests" also success.
- **Readers and writers.** Door (`linkEffectTheUserStated`): `proposeLinkEffect`, single and grouped. Writer: agent-capabilities ×3, option-intervention-edit ×2. `stated_range`: written by construction and chat; read by heldLinkOf (→ hash, serialise, compact), user-figure-held, admit-candidate, refit-frames. Card: approvalChipsFor, applyLinkEffect.
- **NEXT class: a unitless end's own label is its unit (needs a DL/Science ruling).** Rows on banked graphs.
  - **Must read:** mealkit-14 "The pause option would cut monthly cancellations by about 40." → cancellations/month; consult-12 "Each senior consultant should bill about 150 days a year." → days/year; dental-4 "Each appointment cancelled in advance prevents about 1 no-show." → no-shows, with the source read as appointments, not "rescheduled"; bakery-6 "Each shop we close avoids about £40k a year of losses." → £/year (today misread as points).
  - **Must not:** read the other end's noun (150 consultants); read another quantity's noun ("cut late deliveries by 40"); read a measure that differs from the label head ("2 hours" into "…response time") until ruled; re-unit an end that already has a level or a differently-sized link (U1); adopt a bare % on a unitless end (U3 still asks); read "cut cancellations by 40%" as 40 cancellations.
