# A/B comparison — armF-v42.1a-w vs armG-v42.2e-w

| Turn | exit A→B | LLM A→B | words A→B | bullets A→B | bold A→B | ¶ A→B | ? A→B | labels A→B | guards A→B | chips A→B |
|---|---|---|---|---|---|---|---|---|---|---|
| P21 | turn_executor→turn_executor | no→no | 316→322 | 0→3 | 0→3 | 6→4 | 0→0 | 7→4 | clean→clean | 1→1 |
| P22 | turn_executor→turn_executor | no→no | 13→285 | 0→3 | 0→3 | 1→4 | 0→1 | 0→5 | clean→clean | 2→1 |
| P23 | turn_executor→turn_executor | no→no | 277→22 | 3→0 | 3→0 | 4→1 | 2→0 | 4→1 | clean→clean | 2→2 |
| P24 | turn_executor→turn_executor | no→no | 13→248 | 0→3 | 0→3 | 1→3 | 0→1 | 0→4 | clean→clean | 2→2 |
| P25 | turn_executor→turn_executor | no→no | 262→219 | 3→3 | 3→3 | 4→3 | 1→0 | 3→4 | clean→clean | 2→2 |
| T01 | draft_graph→draft_graph | Y→Y | 110→136 | 0→0 | 0→0 | 5→5 | 0→0 | 6→6 | clean→clean | 3→3 |
| T02 | turn_executor→turn_executor | no→no | 94→216 | 0→0 | 0→0 | 1→3 | 0→0 | 4→5 | clean→clean | 1→1 |
| T03 | turn_executor→turn_executor | no→no | 10→10 | 0→0 | 0→0 | 1→1 | 0→0 | 0→0 | clean→clean | 1→1 |
| T04 | turn_executor→turn_executor | no→no | 27→11 | 0→0 | 0→0 | 1→1 | 0→0 | 1→0 | clean→clean | 1→1 |
| T05 | turn_executor→turn_executor | no→no | 69→73 | 0→0 | 0→0 | 3→3 | 0→0 | 2→2 | clean→clean | 2→2 |
| T06 | turn_executor→turn_executor | no→no | 69→68 | 0→0 | 0→0 | 2→3 | 1→1 | 3→2 | clean→clean | 2→2 |
| T07 | turn_executor→turn_executor | no→no | 267→285 | 0→3 | 0→3 | 6→4 | 0→0 | 10→6 | clean→clean | 1→1 |
| T08 | turn_executor→turn_executor | no→no | 78→95 | 0→0 | 0→0 | 2→2 | 0→0 | 3→4 | mut→mut | 0→0 |
| T09 | turn_executor→turn_executor | no→no | 233→259 | 0→3 | 0→3 | 6→4 | 0→0 | 8→6 | clean→clean | 1→1 |
| T10 | turn_executor→turn_executor | no→no | 11→19 | 0→0 | 0→0 | 1→1 | 0→0 | 0→0 | clean→clean | 2→2 |
| T11 | turn_executor→turn_executor | no→no | 54→14 | 0→0 | 2→0 | 3→1 | 1→1 | 2→0 | clean→clean | 2→1 |
| T12 | turn_executor→turn_executor | no→no | 40→40 | 0→0 | 0→0 | 2→2 | 0→0 | 1→1 | clean→clean | 1→1 |
| T13 | turn_executor→turn_executor | no→no | 30→30 | 0→0 | 0→0 | 1→1 | 1→1 | 0→0 | clean→clean | 1→1 |
| T14 | turn_executor→turn_executor | no→no | 28→28 | 0→0 | 0→0 | 1→1 | 0→0 | 0→0 | clean→clean | 1→1 |
| T15 | turn_executor→turn_executor | no→no | 52→18 | 0→0 | 0→0 | 2→1 | 0→0 | 2→2 | clean→clean | 2→2 |
| T16 | turn_executor→turn_executor | no→no | 28→28 | 0→0 | 0→0 | 1→1 | 0→0 | 1→1 | clean→clean | 0→0 |
| T17 | turn_executor→turn_executor | no→no | 249→319 | 0→3 | 0→3 | 5→5 | 0→0 | 5→7 | clean→clean | 1→1 |
| T18 | turn_executor→turn_executor | no→no | 117→121 | 4→3 | 4→3 | 5→5 | 2→2 | 1→2 | mut→clean | 2→2 |
| T19 | turn_executor→turn_executor | no→no | 128→234 | 0→3 | 0→3 | 4→3 | 2→1 | 2→5 | clean→clean | 2→2 |
| T20 | turn_executor→turn_executor | no→no | 251→253 | 0→3 | 0→3 | 4→3 | 1→0 | 2→5 | clean→clean | 3→3 |

**armF-v42.1a-w** — LLM turns: 1; avg words 110; guard hits 0; generic markers 0; avg labels 6.0

**armG-v42.2e-w** — LLM turns: 1; avg words 136; guard hits 0; generic markers 0; avg labels 6.0

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

### T07 — armG-v42.2e-w (285w, exit=turn_executor)

> Hire One Tech Lead comes out ahead because it is the only option that actively reduces the two biggest threats to your goal: Delivery Delay Risk and weak Technical Architecture Quality.
> 
> - **Delivery Delay Risk is the strongest drag on your goal.** It has a moderate negative causal link to shipping AI features within 6 months, and AI Feature Complexity — the top driver in your model — feeds directly into it. Hiring a tech lead is the only option with a moderate negative link to Delivery Delay Risk, meaning it structurally counteracts the very factor most likely to derail delivery.
> - **Technical Architecture Quality is the most vulnerable relationship in your model.** The connection between Technical Architecture Quality and your goal is the one fragile assumption the analysis flagged. A tech lead carries a moderate positive link to Technical Architecture Quality; no other option does. This matters because if architecture quality turns out to matter more than currently modelled, the lead for this option would widen, not narrow.
> - **The runner-up does less on both dimensions.** Hire Two Mid-Level Developers carries only weak positive links to Delivery Delay Risk and no meaningful link to Technical Architecture Quality, which is why it leads in just 12% of simulations compared to 86%.
> 
> The result is stable under most plausible variations, so the gap is unlikely to close unless your assumptions about AI Feature Complexity or the tech lead's actual impact on delay risk change materially.
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

### T09 — armG-v42.2e-w (259w, exit=turn_executor)

> The 15% delivery speed improvement target was scored from the modelled outcome distribution, so the comparison is built into the analysis results rather than shown as a separate per-option score. What the results do tell us clearly is how each option performs against your overall goal of shipping AI features within 6 months.
> 
> - **Hire One Tech Lead is the only option that looks credible against the target.** It leads in 86% of simulations, driven by its moderate positive causal link to Feature Delivery Speed and its unique ability to reduce Delivery Delay Risk. It is the only option structurally positioned to clear a meaningful delivery speed bar.
> - **Hire Two Mid-Level Developers falls well short.** Leading in just 12% of simulations, its moderate positive link to Feature Delivery Speed is undermined by a weak positive link to Delivery Delay Risk, meaning it adds headcount but also adds coordination overhead that erodes the speed gain.
> - **The deferred hire and status quo options are effectively ruled out.** They lead in 2% and 0% of simulations respectively, so neither is a realistic path to the 15% improvement.
> 
> To see per-option goal-fit scores directly against the 15% threshold, the goal-fit view would surface those; the current view confirms the ranking but does not break out individual scores against the constraint.
> 
> The evidence that would most improve confidence is real-world support for the link from 'Technical Architecture Quality' to 'Ship AI Features Within 6 Months' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### T13 — armF-v42.1a-w (30w, exit=turn_executor)

> These results may be out of date because the model has changed since the last analysis. Would you like to re-run analysis to see how your changes affect the results?

### T13 — armG-v42.2e-w (30w, exit=turn_executor)

> These results may be out of date because the model has changed since the last analysis. Would you like to re-run analysis to see how your changes affect the results?

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

### T17 — armG-v42.2e-w (319w, exit=turn_executor)

> Hire One Tech Lead leads in 86% of simulations, with a 75-percentage-point margin over Hire Two Mid-Level Developers, and the result holds under most plausible variations. That said, two risks stand out.
> 
> - **AI Feature Complexity is the strongest driver, and it cuts against you.** It has a moderate negative influence on the outcome, meaning the higher the complexity of your AI features, the harder it becomes to hit the six-month goal. You set this to 8, which is already elevated. If real complexity runs higher still, delivery delay risk rises and the case for a tech lead becomes even more critical — but the timeline pressure increases too. The most useful check here is whether your complexity estimate reflects the actual feature scope, not an optimistic version of it.
> 
> - **The relationship between Technical Architecture Quality and shipping on time is the most vulnerable assumption in your model.** If a tech lead improves architecture quality but that quality improvement does not translate into faster delivery as strongly as modelled, the lead's advantage narrows. This is the one causal link most likely to change the result if it turns out to be weaker in practice. A reference check with a team that has hired a tech lead into a similar AI delivery context would test this assumption directly.
> 
> - **The minimum delivery speed improvement constraint adds a floor you need to clear.** Your model now requires at least a 15% improvement in feature delivery speed. Hire One Tech Lead is well-positioned to meet this, but it is worth confirming that the modelled delivery speed improvement under that option actually clears 15% — the goal-fit view would show this.
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

### T19 — armG-v42.2e-w (234w, exit=turn_executor)

> Hire Two Mid-Level Developers leads in only 11% of simulations, compared to 75 percentage points behind Hire One Tech Lead on your current numbers. I can't confirm it as the strongest option, because your model says otherwise.
> 
> - **The gap is substantial, not marginal.** Hire One Tech Lead leads in 86% of simulations; the two-developer option comes out ahead in just 11%. That is not a close call your model is making, so the numbers would need to shift significantly for a different option to come out ahead.
> - **AI Feature Complexity is the key pressure point.** It has the biggest influence on the outcome, and your complexity is already set at 8. Two mid-level developers carry a higher delivery delay risk in your model than a tech lead does, precisely because the tech lead reduces that risk through a direct causal link that the mid-level option lacks.
> - **The most vulnerable assumption is worth checking before committing.** The relationship between Technical Architecture Quality and shipping on time is the one causal link most likely to change the result if it is weaker in practice. If you believe two developers would actually improve architecture quality more than your model assumes, that is the specific belief worth encoding and retesting.
> 
> What is the basis for your confidence in the two-developer path, and is it something we could encode in the model to test it properly?

### T20 — armF-v42.1a-w (251w, exit=turn_executor)

> The highest-value evidence to gather next centres on the two most vulnerable assumptions in your model, both of which sit in the same causal chain.
> 
> First, the relationship between Technical Architecture Quality and your goal of shipping within 6 months is the assumption most likely to change the outcome. The model treats this as a moderate positive connection, but that estimate is inferred rather than grounded in your specific context. Real-world evidence here could come from speaking to engineering teams who have shipped AI features at similar complexity levels: how much did architectural quality actually affect delivery speed, and by how much? Even one or two reference cases would sharpen this considerably.
> 
> Second, the causal link from AI Feature Complexity to Technical Architecture Quality is the other vulnerable assumption. You have set complexity to 8, which is high, but the model's view of how much that complexity degrades architecture quality is also inferred. A technical assessment from a senior engineer or architect who has worked on comparable AI feature sets would give you a grounded view of this relationship.
> 
> The good news is that gathering more data on AI Feature Complexity itself would add only weak value, because the result holds across the full tested range regardless of where complexity lands. The result is stable, so you are not in a situation where a single data point would overturn the conclusion. But if you want to increase confidence before committing, the architecture quality chain is where your effort is best spent.

### T20 — armG-v42.2e-w (253w, exit=turn_executor)

> The highest-value evidence targets the one assumption most likely to change the outcome: how strongly Technical Architecture Quality actually translates into shipping on time.
> 
> - **Validate the architecture quality link before committing.** The causal connection from Technical Architecture Quality to Ship AI Features Within 6 Months is the most vulnerable assumption in your model, and it is the one that most directly justifies the tech lead's advantage. Talk to a team that has hired a tech lead into a comparable AI delivery context and ask whether improved architecture quality visibly shortened their delivery timeline. A single reference conversation would test this cheaply.
> - **Gather a harder estimate of AI Feature Complexity.** It has the biggest influence on the outcome and you have it set at 8, which is already elevated. Your model shows no tipping point within the tested range, meaning complexity pressure only compounds. A scoping session with the engineers who would build these features would tell you whether 8 is realistic or optimistic, and that number matters more than any other input.
> - **Confirm the delivery speed improvement clears 15%.** Your model requires at least a 15% improvement in feature delivery speed. The goal-fit view would show whether Hire One Tech Lead clears that bar under the modelled outcome distribution. If it does not, the constraint becomes the binding issue, not the option ranking.
> 
> The architecture quality evidence is the priority: it is the assumption with the most leverage on the result and the least external grounding in your current model.

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

### P21 — armG-v42.2e-w (322w, exit=turn_executor)

> The analysis identifies two factors with meaningful influence on whether you ship AI features within six months, and the picture is fairly clear.
> 
> - **AI Feature Complexity has the biggest influence, and it works against you.** It carries a moderate negative influence on the outcome, meaning as complexity rises, your chances of hitting the six-month goal fall. You have this set at 8, which is already elevated, and the analysis found no tipping point within the tested range — so there is no safe ceiling to hide behind. The most useful action here is a scoping session with the engineers who would build these features to confirm whether 8 reflects reality or optimism.
> - **Hiring Budget has a weak positive influence.** More budget gives you more room to hire well, but its effect is modest compared to complexity. The analysis also shows its evidence value is weak, meaning gathering more precise budget data would not materially change the result. It is not the lever worth pulling.
> - **The most vulnerable relationship in your model sits between Technical Architecture Quality and the goal.** This causal link is flagged as the most fragile assumption: if a tech lead improves architecture quality but that improvement does not translate into faster delivery as strongly as modelled, the tech lead's advantage narrows. This is not a factor with a computed influence score, but it is the structural assumption most likely to change the outcome if it turns out to be weaker in practice.
> 
> The result is stable under most plausible variations, so neither factor is likely to overturn the current ranking on its own — but AI Feature Complexity is the one worth watching most closely.
> 
> The evidence that would most improve confidence is real-world support for the link from 'Technical Architecture Quality' to 'Ship AI Features Within 6 Months' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### P22 — armF-v42.1a-w (13w, exit=turn_executor)

> I couldn't complete that turn cleanly, but your current analysis is still available.

### P22 — armG-v42.2e-w (285w, exit=turn_executor)

> Your model scored goal fit from the modelled outcome distribution, so the 15% delivery speed improvement constraint was part of the analysis — but the per-option goal-fit scores are not in the current view, so I cannot confirm from here whether Hire One Tech Lead clears that bar specifically.
> 
> - **What the analysis does show is directionally encouraging.** Hire One Tech Lead leads in 86% of simulations, and the result is stable under most plausible variations. The tech lead path carries a moderate positive causal link to Feature Delivery Speed and a moderate negative link to Delivery Delay Risk — both of which point toward clearing a delivery speed threshold more reliably than the alternatives.
> - **The 15% bar is a constraint, not a confirmed outcome.** Goal fit was scored, but whether the modelled delivery speed improvement under Hire One Tech Lead actually clears 15% requires the goal-fit detail view. That is the one place where per-option constraint clearance is shown directly.
> - **The most vulnerable assumption sits between Technical Architecture Quality and the goal.** If that causal link is weaker in practice than modelled, the delivery speed benefit from hiring a tech lead could be lower than the analysis assumes — which is the scenario most likely to put the 15% target at risk.
> 
> The goal-fit view would give you a direct answer on constraint clearance. Would it help to open that, or would you prefer to stress-test the architecture quality assumption first?
> 
> The evidence that would most improve confidence is real-world support for the link from 'Technical Architecture Quality' to 'Ship AI Features Within 6 Months' rather than the current model estimate, since it is the assumption most likely to change the outcome.

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

### P23 — armG-v42.2e-w (22w, exit=turn_executor)

> Hire One Tech Lead leads in 86% of simulations; your model is not agreeing with your team, and by a wide margin.

### P24 — armF-v42.1a-w (13w, exit=turn_executor)

> Good structural question. Looking at your model, there are two moves worth considering.

### P24 — armG-v42.2e-w (248w, exit=turn_executor)

> Good structural question. Looking at your model, there are two factors worth reconsidering.
> 
> - **AI Feature Complexity sits outside your control, but it is modelled as a background factor rather than a constraint.** It has the biggest influence on the outcome and you have it set at 8, with no tipping point found within the tested range. If there is a complexity ceiling your team genuinely cannot exceed, encoding that as a constraint would make the model reflect a real boundary rather than a continuous pressure. If it is truly open-ended, it may be worth treating as a scenario variable and testing a higher value explicitly.
> - **Delivery Delay Risk flows from three separate sources, but nothing mediates the cumulative effect.** AI Feature Complexity, the mid-level indicator, and the hybrid indicator all feed into it independently. If in practice those risks compound rather than add linearly, a mediating factor between them and the goal would capture that dynamic more faithfully. This matters most if you believe two mid-level developers would create coordination overhead that a tech lead would not.
> - **Budget Overrun Risk has a weak influence on the goal, but no floor.** If there is a hard budget ceiling, that is better expressed as a constraint on Hiring Budget than as a risk factor with a soft causal link. A constraint would bind the analysis rather than just nudge it.
> 
> Would you like to encode a complexity ceiling, a budget cap, or both, and retest from there?

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

### P25 — armG-v42.2e-w (219w, exit=turn_executor)

> Hire One Tech Lead comes out ahead on your numbers, leading in 86% of simulations with a 75-percentage-point margin over the next best option, and the result is stable under most plausible variations.
> 
> - **The model is not close.** Hire Two Mid-Level Developers leads in only 11% of simulations, and the deferred hire and status quo options are effectively ruled out. The gap is wide enough that no single assumption change is likely to overturn it.
> - **One assumption still warrants a check before you commit.** The causal connection from Technical Architecture Quality to shipping on time is the most vulnerable assumption in your model. If a tech lead improves architecture quality but that improvement does not translate into faster delivery as strongly as modelled, the advantage narrows. A reference conversation with a team that has made a comparable hire would test this cheaply.
> - **AI Feature Complexity is the external pressure to watch.** It has the biggest influence on the outcome and is already set at an elevated level, with no safe ceiling found in the tested range. If scope grows further, the case for a tech lead strengthens, not weakens, since architecture quality becomes more valuable under higher complexity.
> 
> The one check worth doing before signing an offer: validate that architecture quality link against a real-world reference.

