# A/B comparison — armF-v42.1a-w vs armE-v42.2d-w

| Turn | exit A→B | LLM A→B | words A→B | bullets A→B | bold A→B | ¶ A→B | ? A→B | labels A→B | guards A→B | chips A→B |
|---|---|---|---|---|---|---|---|---|---|---|
| P21 | turn_executor→turn_executor | no→no | 316→299 | 0→3 | 0→3 | 6→4 | 0→0 | 7→8 | clean→clean | 1→1 |
| P22 | turn_executor→turn_executor | no→no | 13→60 | 0→0 | 0→0 | 1→2 | 0→0 | 0→2 | clean→clean | 2→2 |
| P23 | turn_executor→turn_executor | no→no | 277→195 | 3→3 | 3→3 | 4→3 | 2→2 | 4→5 | clean→clean | 2→2 |
| P24 | turn_executor→turn_executor | no→no | 13→323 | 0→4 | 0→4 | 1→2 | 0→0 | 0→6 | clean→clean | 2→1 |
| P25 | turn_executor→turn_executor | no→no | 262→203 | 3→3 | 3→3 | 4→3 | 1→1 | 3→6 | clean→clean | 2→2 |
| T01 | draft_graph→draft_graph | Y→Y | 110→105 | 0→0 | 0→0 | 5→5 | 0→0 | 6→6 | clean→clean | 3→3 |
| T02 | turn_executor→turn_executor | no→no | 94→176 | 0→0 | 0→0 | 1→4 | 0→0 | 4→6 | clean→clean | 1→1 |
| T03 | turn_executor→turn_executor | no→no | 10→10 | 0→0 | 0→0 | 1→1 | 0→0 | 0→0 | clean→clean | 1→1 |
| T04 | turn_executor→turn_executor | no→no | 27→11 | 0→0 | 0→0 | 1→1 | 0→0 | 1→0 | clean→clean | 1→1 |
| T05 | turn_executor→turn_executor | no→no | 69→87 | 0→0 | 0→0 | 3→3 | 0→0 | 2→2 | clean→clean | 2→2 |
| T06 | turn_executor→turn_executor | no→no | 69→41 | 0→0 | 0→0 | 2→2 | 1→0 | 3→2 | clean→clean | 2→2 |
| T07 | turn_executor→turn_executor | no→no | 267→301 | 0→3 | 0→3 | 6→4 | 0→1 | 10→7 | clean→clean | 1→1 |
| T08 | turn_executor→turn_executor | no→no | 78→95 | 0→0 | 0→0 | 2→2 | 0→0 | 3→4 | mut→mut | 0→0 |
| T09 | turn_executor→turn_executor | no→no | 233→267 | 0→3 | 0→3 | 6→4 | 0→1 | 8→5 | clean→clean | 1→1 |
| T10 | turn_executor→turn_executor | no→no | 11→181 | 0→3 | 0→3 | 1→3 | 0→1 | 0→2 | clean→clean | 2→2 |
| T11 | turn_executor→turn_executor | no→no | 54→21 | 0→0 | 2→0 | 3→1 | 1→0 | 2→0 | clean→clean | 2→0 |
| T12 | turn_executor→turn_executor | no→no | 40→13 | 0→0 | 0→0 | 2→1 | 0→1 | 1→0 | clean→clean | 1→2 |
| T13 | turn_executor→turn_executor | no→no | 30→116 | 0→0 | 0→0 | 1→1 | 1→1 | 0→6 | clean→clean | 1→1 |
| T14 | turn_executor→turn_executor | no→no | 28→29 | 0→0 | 0→0 | 1→1 | 0→0 | 0→0 | clean→clean | 1→0 |
| T15 | turn_executor→turn_executor | no→no | 52→51 | 0→0 | 0→0 | 2→2 | 0→0 | 2→2 | clean→clean | 2→2 |
| T16 | turn_executor→turn_executor | no→no | 28→27 | 0→0 | 0→0 | 1→1 | 0→0 | 1→1 | clean→clean | 0→0 |
| T17 | turn_executor→turn_executor | no→no | 249→330 | 0→3 | 0→3 | 5→4 | 0→2 | 5→7 | clean→clean | 1→1 |
| T18 | turn_executor→turn_executor | no→no | 117→134 | 4→3 | 4→3 | 5→4 | 2→1 | 1→4 | mut→clean | 2→2 |
| T19 | turn_executor→turn_executor | no→no | 128→200 | 0→3 | 0→3 | 4→3 | 2→2 | 2→5 | clean→clean | 2→2 |
| T20 | turn_executor→turn_executor | no→no | 251→220 | 0→3 | 0→3 | 4→2 | 1→0 | 2→6 | clean→clean | 3→3 |

**armF-v42.1a-w** — LLM turns: 1; avg words 110; guard hits 0; generic markers 0; avg labels 6.0

**armE-v42.2d-w** — LLM turns: 1; avg words 105; guard hits 0; generic markers 0; avg labels 6.0

## Key texts (probe + explanation turns)

### T07 — armF-v42.1a-w (267w, exit=turn_executor)

> Hire One Tech Lead comes out ahead in 92% of simulations, and the model structure explains why quite clearly.
> 
> The two outcomes that feed your goal, Technical Architecture Quality and Development Throughput, both benefit from having a tech lead in place. The causal link from Tech Lead Hired to Technical Architecture Quality is moderately positive, and there is a further moderate positive link from Technical Architecture Quality to Ship AI Features Within 6 Months. Critically, Tech Lead Hired also has a moderate negative link to Feature Delivery Delay, meaning hiring a tech lead actively reduces the risk that most threatens your goal.
> 
> AI Feature Complexity is the strongest driver in the analysis, and it has a moderate positive link to Feature Delivery Delay. The tech lead option is the one best placed to absorb that complexity, because it directly suppresses delivery delay while also improving architecture quality. Hire Two Mid-Level Developers does boost Development Throughput, but it does not reduce Feature Delivery Delay in the same way, and it carries a small additional Budget Overrun Risk. Delay Hire does neither.
> 
> Remaining Budget After Hire has a weak positive influence, which slightly favours the tech lead option over hiring two mid-level developers, since the latter costs more and leaves less budget headroom.
> 
> In short, the tech lead option is the only one that simultaneously improves architecture quality, reduces delivery delay, and preserves budget, which is why it leads so decisively against your 6-month shipping goal.
> 
> The evidence that would most improve confidence is firmer support for 'AI Feature Complexity', since it carries the most weight in this result.

### T07 — armE-v42.2d-w (301w, exit=turn_executor)

> Hire One Tech Lead comes out ahead because it scores highest on the two factors that matter most to your goal: Technical Seniority of Hire and, through that, the suppression of Delivery Delay Beyond 6 Months.
> 
> - **Seniority is the decisive mechanism.** A tech lead brings high seniority, which has a moderate positive connection to AI Feature Delivery Speed and a moderate negative connection to Delivery Delay Beyond 6 Months. Delivery delay, in turn, has a moderate negative connection to your goal, so reducing it is the most direct path to shipping within 6 months. The two mid-level options simply cannot match this on seniority.
> - **AI Feature Complexity is the strongest driver in the result, and a tech lead absorbs it better.** Complexity has a moderate positive link to delivery delay, which works against your goal. A senior hire is better placed to manage that complexity, which is why this option pulls so far ahead. The 94-percentage-point margin reflects how much this pathway dominates the simulation.
> - **The most vulnerable assumption is the connection between Technical Architecture Quality and your goal.** That relationship is the one fragile link in the model. If architecture quality matters less than assumed, the result barely changes given the margin. But if it matters more, the case for a tech lead strengthens further, not weakens.
> 
> The result is stable, so it holds under most plausible variations. The one check worth making: how confident are you in your estimate of the tech lead's seniority level, given that this is the factor doing the most work?
> 
> The evidence that would most improve confidence is real-world support for the link from 'Technical Architecture Quality' to 'Ship AI Features Within 6 Months' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### T09 — armF-v42.1a-w (233w, exit=turn_executor)

> Against your 15% delivery speed improvement target, the options separate quite clearly.
> 
> Hire One Tech Lead comes out ahead in 92% of simulations, making it the only option with a strong likelihood of meeting the target. Its advantage comes from two directions: it improves Technical Architecture Quality through a moderate positive causal link, and it actively reduces Feature Delivery Delay through a moderate negative causal link. That combination is what puts it well above the 15% threshold in most scenarios.
> 
> Hire Two Mid-Level Developers leads in only 7% of simulations. It does boost Development Throughput through a moderate positive causal link, but it does not suppress Feature Delivery Delay in the same way, and it carries a small additional Budget Overrun Risk. That limits how reliably it clears the target.
> 
> Delay Hire (Status Quo) leads in just 1% of simulations, meaning it almost never meets the 15% improvement target. Without a new hire, neither architecture quality nor delivery delay improves, so the goal is effectively out of reach under this option.
> 
> The 85 percentage point margin between the top two options, and the stable result across plausible variations, suggests the 15% target is doing real work here: it is a threshold that only the tech lead option clears with confidence.
> 
> The evidence that would most improve confidence is firmer support for 'AI Feature Complexity', since it carries the most weight in this result.

### T09 — armE-v42.2d-w (267w, exit=turn_executor)

> Only Hire One Tech Lead clears the 15% delivery speed improvement target with any meaningful probability, leading in 97% of simulations. The runner-up, Hire Two Mid-Level Developers, manages just 3%, and the remaining two options are effectively eliminated at 0%.
> 
> - **The seniority pathway is what clears the bar.** A tech lead's seniority has a moderate positive connection to AI Feature Delivery Speed, which is the factor your 15% constraint sits on. The two mid-level options simply cannot generate the same lift through that pathway, which is why the gap is so wide.
> - **Headcount alone does not compensate.** Hire Two Mid-Level Developers adds more headcount, which has a moderate positive connection to delivery speed, but the model shows this is not enough to offset the seniority advantage. The 94-percentage-point margin reflects how decisively seniority dominates over raw headcount in reaching your target.
> - **The most vulnerable assumption is still the connection between Technical Architecture Quality and your goal.** If that relationship were stronger, the case for a tech lead would widen further. If weaker, the margin narrows slightly but the leading option does not change given the scale of the gap.
> 
> The result is stable, so it holds under most plausible variations. The one check worth making: how confident are you in the assumed seniority level of the tech lead candidate you have in mind?
> 
> The evidence that would most improve confidence is real-world support for the link from 'Technical Architecture Quality' to 'Ship AI Features Within 6 Months' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### T13 — armF-v42.1a-w (30w, exit=turn_executor)

> These results may be out of date because the model has changed since the last analysis. Would you like to re-run analysis to see how your changes affect the results?

### T13 — armE-v42.2d-w (116w, exit=turn_executor)

> Hire One Tech Lead performs best, with a probability of 97%. That is ahead of Hire Two Mid-Level Developers by 94 percentage points, so the lead is meaningful rather than marginal. The result is driven mainly by AI Feature Complexity, which moderately weakens the lead, and Hiring Budget Utilised, which slightly weakens the lead. This result looks stable, so it should hold under reasonable variation. The evidence that would most improve confidence is real-world support for the link from 'Technical Architecture Quality' to 'Ship AI Features Within 6 Months' rather than the current model estimate, since it is the assumption most likely to change the outcome. Would you like to explore what would change this result?

### T17 — armF-v42.1a-w (249w, exit=turn_executor)

> The two biggest risks in your model are both connected to AI Feature Complexity, which has the strongest influence on the outcome.
> 
> First, AI Feature Complexity drives Feature Delivery Delay through a moderate positive causal link, and Feature Delivery Delay in turn has a moderate negative effect on your goal of shipping within 6 months. You have set complexity to 8, which is high, and the model shows no tipping point within the tested range, meaning this risk is persistent rather than threshold-based. If complexity is higher than assumed in practice, delivery slips further.
> 
> Second, the relationship between Technical Architecture Quality and your shipping goal is one of the two most vulnerable assumptions in your model. AI Feature Complexity weakens Technical Architecture Quality through a direct causal link, and Technical Architecture Quality then feeds your goal through a moderate positive link. This chain is where the tech lead option earns most of its advantage: hiring a tech lead strengthens Technical Architecture Quality, partially offsetting the complexity drag. If that architecture improvement does not materialise as expected, the case for the tech lead weakens.
> 
> Budget Overrun Risk is present but has only a weak negative effect on the goal, so it is a secondary concern at current model settings.
> 
> The evidence that would most improve confidence is real-world support for the link from 'Technical Architecture Quality' to 'Ship AI Features Within 6 Months' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### T17 — armE-v42.2d-w (330w, exit=turn_executor)

> Hire One Tech Lead leads comfortably, but two risks in your model could erode that confidence if left unexamined.
> 
> - **AI Feature Complexity is the strongest drag on your goal.** It has a moderate negative influence on the outcome and flows through Delivery Delay Beyond 6 Months, which in turn has a moderate negative connection to shipping on time. If your features turn out to be more complex than assumed, the delivery timeline tightens for every option, not just the leading one. The most useful next step is to pressure-test your complexity estimate: is it based on a scoped backlog, or a rough assumption?
> - **The Technical Architecture Quality link is the most vulnerable assumption in your model.** The connection from Technical Architecture Quality to your goal is currently weak and positive, but it is the relationship most likely to change the outcome if it turns out to be wrong. A tech lead hire is partly justified by the expectation that seniority improves architecture quality, which then supports on-time delivery. If that link is weaker in practice than modelled, the case for a tech lead over two mid-level developers narrows. Real-world evidence here, such as a reference from a similar team or a short technical assessment, would be the highest-value information you could gather.
> - **Budget Overrun Risk is a secondary concern.** It has a weak negative connection to the goal, driven by both headcount added and hiring budget utilised. At current model levels it is not deciding the outcome, but it is worth monitoring if the hire takes longer than expected or salary negotiations run high.
> 
> Would you like to stress-test the complexity assumption, or explore what it would take for a different option to come out ahead?
> 
> The evidence that would most improve confidence is real-world support for the link from 'Technical Architecture Quality' to 'Ship AI Features Within 6 Months' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### T19 — armF-v42.1a-w (128w, exit=turn_executor)

> Hire Two Mid-Level Developers comes out ahead in only 7% of simulations in the current analysis. Hire One Tech Lead leads in 93%, with an 86 percentage point margin, and the result is stable under most plausible variations.
> 
> I can't confirm the two-developer option as the stronger choice because the model consistently points the other way.
> 
> It's worth asking: what's driving your confidence here? If you have information the model doesn't, such as a different view on how complexity will play out, or a stronger belief in throughput over architecture quality, encoding that and rerunning would either strengthen your case or surface the specific assumption where you and the model disagree. That's a much more useful place to land than a confirmation.
> 
> What's the reasoning behind your view?

### T19 — armE-v42.2d-w (200w, exit=turn_executor)

> Hire Two Mid-Level Developers comes out ahead in only 3% of simulations in your current model, against 97% for Hire One Tech Lead. That is a very large gap, so your model does not support that call on its current numbers.
> 
> - **The seniority pathway is what separates them.** Technical Seniority of Hire has a moderate positive causal link to both AI Feature Delivery Speed and Technical Architecture Quality. A tech lead scores much higher on seniority, which flows through to your goal more strongly than the headcount advantage two mid-level hires bring.
> - **Your intuition may be capturing something the model does not.** If you believe two developers is the right call, it is worth asking what that belief is based on: team dynamics, knowledge spread, redundancy, or something else? If those factors are real, they belong in the model so the analysis can reflect them.
> - **The most vulnerable assumption is the architecture quality link.** If that connection is weaker in practice than modelled, the gap between the two options narrows. That is the one check that could genuinely shift the picture.
> 
> What is driving your confidence in two developers, and is that factor currently in your model?

### T20 — armF-v42.1a-w (251w, exit=turn_executor)

> The highest-value evidence to gather next centres on the two most vulnerable assumptions in your model, both of which sit in the same causal chain.
> 
> First, the relationship between Technical Architecture Quality and your goal of shipping within 6 months is the assumption most likely to change the outcome. The model treats this as a moderate positive connection, but that estimate is inferred rather than grounded in your specific context. Real-world evidence here could come from speaking to engineering teams who have shipped AI features at similar complexity levels: how much did architectural quality actually affect delivery speed, and by how much? Even one or two reference cases would sharpen this considerably.
> 
> Second, the causal link from AI Feature Complexity to Technical Architecture Quality is the other vulnerable assumption. You have set complexity to 8, which is high, but the model's view of how much that complexity degrades architecture quality is also inferred. A technical assessment from a senior engineer or architect who has worked on comparable AI feature sets would give you a grounded view of this relationship.
> 
> The good news is that gathering more data on AI Feature Complexity itself would add only weak value, because the result holds across the full tested range regardless of where complexity lands. The result is stable, so you are not in a situation where a single data point would overturn the conclusion. But if you want to increase confidence before committing, the architecture quality chain is where your effort is best spent.

### T20 — armE-v42.2d-w (220w, exit=turn_executor)

> The result is stable, but two pieces of evidence would most improve your confidence before committing.
> 
> - **Validate the architecture quality link first.** The connection from Technical Architecture Quality to shipping on time is the most vulnerable assumption in your model. A tech lead hire is partly justified by the expectation that seniority lifts architecture quality, which then supports on-time delivery. Real-world evidence here, such as a reference check with a team that hired a similar tech lead, or a short technical assessment of your current codebase gaps, would be the highest-value information you could gather. If that link turns out weaker than modelled, the gap between Hire One Tech Lead and Hire Two Mid-Level Developers narrows.
> - **Pressure-test your AI Feature Complexity estimate.** This is the strongest driver of your goal, with a moderate negative influence flowing through Delivery Delay Beyond 6 Months. If your complexity estimate is based on a rough assumption rather than a scoped backlog, it is worth grounding it before acting. A one-day scoping exercise with your current team would tell you whether the 6-month window is realistic under any hiring option.
> - **Budget evidence is lower priority.** Hiring Budget Utilised has only a weak negative influence, and its evidence value is also weak, so gathering more data here would not materially shift the result.

### P21 — armF-v42.1a-w (316w, exit=turn_executor)

> The analysis identifies two factors with meaningful influence on your goal of shipping AI features within 6 months, and a third with a smaller role.
> 
> AI Feature Complexity has the biggest influence on the outcome, and it works against you. It drives Feature Delivery Delay through a moderate positive causal link, and that delay then feeds your goal through a moderate negative link. You have set complexity to 8, which is high, and the model shows no tipping point within the tested range, meaning this drag is persistent across all plausible scenarios. Gathering more data on complexity itself would add only weak value, because the result holds regardless of where complexity lands.
> 
> Remaining Budget After Hire has a weak positive influence on the outcome. It works by reducing Budget Overrun Risk, which in turn has a weak negative effect on the goal. This factor matters, but it is not deciding the result at current settings.
> 
> Two factors sit behind the most vulnerable assumptions in the model rather than being top drivers themselves. Technical Architecture Quality has a moderate positive causal link to your goal, and the relationship between AI Feature Complexity and Technical Architecture Quality is also flagged as a vulnerable assumption. These two links are where the tech lead option earns most of its advantage: hiring a tech lead strengthens Technical Architecture Quality through a moderate positive link, partially offsetting the complexity drag, while hiring two mid-level developers has only a weak positive link to Development Throughput and no meaningful architecture benefit.
> 
> In short, complexity is the persistent headwind, architecture quality is the mechanism that separates the options, and budget is a secondary consideration.
> 
> The evidence that would most improve confidence is real-world support for the link from 'Technical Architecture Quality' to 'Ship AI Features Within 6 Months' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### P21 — armE-v42.2d-w (299w, exit=turn_executor)

> The analysis identifies two factors with computed influence on your goal, and the picture is fairly clear.
> 
> - **AI Feature Complexity is the strongest driver, and it works against you.** It has a moderate negative influence on the outcome, flowing through Delivery Delay Beyond 6 Months, which in turn has a moderate negative connection to shipping on time. This is the factor most likely to erode any option's chances if your features turn out harder than assumed. It is external and not directly controllable, which makes it the most important thing to pressure-test before committing.
> - **Hiring Budget Utilised has a weak negative influence.** It flows through Budget Overrun Risk, which has a weak negative connection to the goal. At current model levels it is not deciding the outcome, and the evidence value of gathering more data here is also weak, so it is a lower priority.
> - **Two intermediate outcomes carry influence but are not top drivers themselves.** AI Feature Delivery Speed has a moderate positive connection to the goal, and Technical Architecture Quality has a weak positive connection. Both are shaped by Technical Seniority of Hire, which is why the tech lead option performs so strongly: seniority lifts both pathways simultaneously. The most vulnerable assumption in your model sits on the Technical Architecture Quality connection, so if that link is weaker in practice, the gap between options narrows.
> 
> The analysis view covers the strongest computed drivers. If you want the full picture across every factor, running a fresh analysis with updated assumptions would surface any shifts.
> 
> The evidence that would most improve confidence is real-world support for the link from 'Technical Architecture Quality' to 'Ship AI Features Within 6 Months' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### P22 — armF-v42.1a-w (13w, exit=turn_executor)

> I couldn't complete that turn cleanly, but your current analysis is still available.

### P22 — armE-v42.2d-w (60w, exit=turn_executor)

> The analysis scores goal fit against your delivery goal, but does not directly score whether each option clears the 15% delivery speed improvement constraint you have just added.
> 
> Hire One Tech Lead currently leads by 94 percentage points because AI Feature Complexity is the strongest driver. 2 options are effectively eliminated (each has less than a 1% chance of winning).

### P23 — armF-v42.1a-w (277w, exit=turn_executor)

> The analysis doesn't support that conclusion, and I'd be doing you a disservice to confirm it.
> 
> Hire One Tech Lead comes out ahead in 93% of simulations, with Hire Two Mid-Level Developers leading in only 7%. That is an 86 percentage point margin, and the result is stable under most plausible variations of your assumptions.
> 
> - **Team consensus isn't the same as evidence.** When everyone agrees quickly, it often means the group is converging on what feels intuitive rather than what the model shows. The intuition here, that more developers means more output, is reasonable on its face, but your model shows the bottleneck is architectural quality, not raw throughput. Two developers add throughput; they don't address the complexity drag.
> - **The mechanism matters.** AI Feature Complexity is set to 8, a high value, and it persistently degrades Technical Architecture Quality. Hiring a tech lead has a moderate positive causal link to architecture quality, which is the factor most directly connected to your goal. Two mid-level developers have only a weak positive link to throughput, with no meaningful architecture benefit.
> - **Shared confidence can mask a shared blind spot.** It's worth asking: does your team's view account for the architecture quality chain, or is the reasoning mainly about headcount and velocity? If the team has specific knowledge that the model doesn't, such as a strong belief that throughput matters more than architecture in your context, that assumption can be encoded and tested.
> 
> What is the reasoning your team is using? If there's a specific belief driving the consensus, encoding it and rerunning would either validate the team's view or show exactly where it diverges from the model.

### P23 — armE-v42.2d-w (195w, exit=turn_executor)

> Your model disagrees with your team, and by a wide margin.
> 
> - **Hire One Tech Lead comes out ahead in 97% of simulations.** Hire Two Mid-Level Developers leads in only 3%. That is not a close call on your current numbers, so confirming the two-developer choice would mean ignoring what the model actually shows.
> - **Group agreement is worth examining here.** When a whole team converges on the same answer quickly, it is worth asking whether everyone is reasoning independently or reinforcing each other. The strongest check is simple: what specific factor does your team believe two developers handles better than a tech lead? If it is real, it belongs in the model.
> - **The seniority pathway is what the model is responding to.** Technical Seniority of Hire has a moderate positive causal link to both AI Feature Delivery Speed and Technical Architecture Quality, and a tech lead scores much higher on that factor. Two mid-level hires bring more headcount, but headcount has a weaker connection to your goal than seniority does.
> 
> What does your team believe two developers gets right that a tech lead does not, and is that factor currently in your model?

### P24 — armF-v42.1a-w (13w, exit=turn_executor)

> Good structural question. Looking at your model, there are two moves worth considering.

### P24 — armE-v42.2d-w (323w, exit=turn_executor)

> A few factors in your model would work harder in a different structural role, and the differences matter for how the analysis interprets them.
> 
> - **AI Feature Complexity is external and uncontrollable, but it sits as a plain factor.** It has the biggest influence on your goal, flowing through Delivery Delay Beyond 6 Months with a moderate positive causal link. Because no hiring option can change it, it would work better as an external uncertainty or scenario variable rather than a factor that options implicitly compete on. Treating it that way would let you stress-test the result across low, medium, and high complexity scenarios, which is more useful than a single point estimate.
> - **Additional Headcount Added is controllable but currently set to zero.** It has a moderate positive causal link to AI Feature Delivery Speed, yet its display value suggests it has not been set per option. If headcount differs meaningfully between options (one tech lead versus two mid-level hires is a real difference), encoding that difference explicitly would sharpen the analysis rather than leaving it implicit in the seniority pathway.
> - **Budget Overrun Risk flows to the goal with only a weak negative link, but you have a hard constraint on delivery speed.** The constraint on minimum delivery speed improvement sits on AI Feature Delivery Speed, not on the budget risk pathway. If budget overrun could genuinely threaten delivery (for example, by forcing a mid-project pause), a direct causal link from Budget Overrun Risk to Delivery Delay Beyond 6 Months would capture that mechanism and make the budget pathway more decision-relevant.
> - **Technical Architecture Quality connects to the goal with a weak positive link, yet it is the most vulnerable assumption in your model.** If architecture quality is genuinely important to shipping on time, that link may be understated. Strengthening it, if your evidence supports it, would test whether the tech lead advantage grows or holds under a more realistic weighting.

### P25 — armF-v42.1a-w (262w, exit=turn_executor)

> Hire One Tech Lead comes out ahead in 93% of simulations, with an 86 percentage point margin over the two mid-level developers option. The result is stable under most plausible variations of your assumptions, so the model gives you a clear steer.
> 
> That said, a few things are worth holding in mind before you commit.
> 
> - **The architecture quality chain is doing most of the work.** The tech lead option earns its advantage primarily through Technical Architecture Quality, which has a moderate positive causal link to your goal. If your specific context means throughput matters more than architecture, that belief is worth encoding and testing, because it is the assumption most likely to change the picture.
> - **Two vulnerable assumptions remain unvalidated.** The relationships between AI Feature Complexity and Technical Architecture Quality, and between Technical Architecture Quality and shipping within 6 months, are both inferred rather than grounded in your context. Speaking to engineering teams who have shipped AI features at similar complexity levels would sharpen confidence considerably before you commit headcount.
> - **Your team's consensus deserves scrutiny, not just confirmation.** As discussed, the intuition that more developers means more output is reasonable on its face, but your model shows the bottleneck is architectural quality, not raw throughput. If the team has specific knowledge the model doesn't capture, now is the time to surface it.
> 
> The model points clearly toward the tech lead. The question worth sitting with is: what would have to be true about your situation for that conclusion to be wrong, and do you believe any of those things?

### P25 — armE-v42.2d-w (203w, exit=turn_executor)

> Hire One Tech Lead comes out ahead in 97% of simulations, with a 94 percentage point lead over the next best option.
> 
> - **The model is clear, but the decision is still yours.** Technical Seniority of Hire is the mechanism doing the work, lifting both AI Feature Delivery Speed and Technical Architecture Quality simultaneously. No other option replicates that through a single hire.
> - **The one assumption worth checking before committing.** The connection from Technical Architecture Quality to shipping on time is the most vulnerable in your model. If a tech lead's architecture advantage turns out weaker in practice, the gap narrows. A reference check with a team that made a similar hire would be the highest-value evidence you could gather right now.
> - **AI Feature Complexity is outside your control and matters most.** It has the strongest influence on the outcome, flowing through Delivery Delay Beyond 6 Months. Whatever you hire, grounding your complexity estimate against a scoped backlog reduces the biggest source of uncertainty in the result.
> 
> The result is stable under most plausible variations, so the case for a tech lead is not fragile. What is your team's strongest specific objection, and is that factor currently reflected in the model?

