# A/B comparison — armA-v42.1a vs armB-v42.2a

| Turn | exit A→B | LLM A→B | words A→B | bullets A→B | bold A→B | ¶ A→B | ? A→B | labels A→B | guards A→B | chips A→B |
|---|---|---|---|---|---|---|---|---|---|---|
| P21 | turn_executor→turn_executor | no→no | 283→338 | 0→0 | 0→0 | 5→6 | 0→0 | 8→11 | clean→clean | 1→1 |
| P22 | turn_executor→turn_executor | no→no | 24→230 | 0→0 | 0→0 | 1→5 | 0→0 | 1→5 | clean→clean | 1→1 |
| P23 | turn_executor→turn_executor | no→no | 250→236 | 3→3 | 3→3 | 4→4 | 2→2 | 2→3 | clean→clean | 2→2 |
| P24 | turn_executor→turn_executor | no→no | 325→283 | 0→4 | 0→4 | 5→6 | 0→1 | 8→4 | clean→clean | 1→2 |
| P25 | turn_executor→turn_executor | no→no | 258→221 | 3→3 | 3→3 | 4→3 | 1→0 | 2→3 | clean→mut | 2→2 |
| T01 | draft_graph→draft_graph | Y→Y | 112→108 | 0→0 | 0→0 | 5→5 | 0→0 | 6→6 | clean→clean | 3→3 |
| T02 | turn_executor→turn_executor | no→no | 239→218 | 0→0 | 0→0 | 5→4 | 0→0 | 8→8 | clean→clean | 1→1 |
| T03 | turn_executor→turn_executor | no→no | 10→10 | 0→0 | 0→0 | 1→1 | 0→0 | 0→0 | clean→clean | 1→1 |
| T04 | turn_executor→turn_executor | no→no | 11→11 | 0→0 | 0→0 | 1→1 | 0→0 | 0→0 | clean→clean | 1→1 |
| T05 | turn_executor→turn_executor | no→no | 69→71 | 0→0 | 0→0 | 3→3 | 0→0 | 2→2 | clean→clean | 2→2 |
| T06 | turn_executor→turn_executor | no→no | 64→63 | 0→0 | 0→0 | 3→3 | 1→1 | 2→2 | clean→clean | 2→2 |
| T07 | turn_executor→turn_executor | no→no | 278→272 | 0→0 | 0→0 | 4→6 | 1→0 | 10→9 | clean→clean | 1→1 |
| T08 | turn_executor→turn_executor | no→no | 78→78 | 0→0 | 0→0 | 2→2 | 0→0 | 3→3 | mut→mut | 0→0 |
| T09 | turn_executor→turn_executor | no→no | 252→13 | 0→0 | 0→0 | 6→1 | 0→0 | 9→0 | clean→clean | 1→2 |
| T10 | turn_executor→turn_executor | no→no | 243→208 | 3→3 | 3→3 | 5→3 | 1→1 | 8→9 | clean→clean | 2→2 |
| T11 | turn_executor→turn_executor | no→no | 21→51 | 0→0 | 0→2 | 1→3 | 0→1 | 0→2 | clean→clean | 0→2 |
| T12 | turn_executor→turn_executor | no→no | 13→40 | 0→0 | 0→0 | 1→2 | 1→0 | 0→1 | clean→clean | 2→1 |
| T13 | turn_executor→turn_executor | no→no | 97→230 | 0→3 | 0→3 | 1→4 | 1→1 | 4→8 | clean→clean | 1→2 |
| T14 | turn_executor→turn_executor | no→no | 29→28 | 0→0 | 0→0 | 1→1 | 0→0 | 0→0 | clean→clean | 0→1 |
| T15 | turn_executor→turn_executor | no→no | 18→18 | 0→0 | 0→0 | 1→1 | 0→0 | 2→2 | clean→clean | 2→2 |
| T16 | turn_executor→turn_executor | no→no | 27→28 | 0→0 | 0→0 | 1→1 | 0→0 | 1→1 | clean→clean | 0→0 |
| T17 | turn_executor→turn_executor | no→no | 311→282 | 0→0 | 0→0 | 6→6 | 0→0 | 7→6 | clean→clean | 1→1 |
| T18 | turn_executor→turn_executor | no→no | 139→129 | 3→3 | 3→3 | 5→4 | 1→1 | 4→3 | clean→clean | 2→2 |
| T19 | turn_executor→turn_executor | no→no | 270→195 | 3→3 | 3→3 | 4→4 | 1→3 | 5→4 | clean→clean | 2→2 |
| T20 | turn_executor→turn_executor | no→no | 236→203 | 0→0 | 0→0 | 3→4 | 0→1 | 3→4 | clean→clean | 3→3 |

**armA-v42.1a** — LLM turns: 1; avg words 112; guard hits 0; generic markers 0; avg labels 6.0

**armB-v42.2a** — LLM turns: 1; avg words 108; guard hits 0; generic markers 0; avg labels 6.0

## Key texts (probe + explanation turns)

### T07 — armA-v42.1a (278w, exit=turn_executor)

> Hire One Tech Lead comes out ahead in 98% of simulations because it is the only option that simultaneously raises Team Seniority Level sharply while keeping Additional Developer Headcount low. That combination matters because seniority has the broadest positive influence in your model: it accelerates AI Feature Delivery Speed, improves Technical Architecture Quality, and reduces both Coordination and Ramp-Up Overhead and Delivery Delay Beyond 6 Months. Hiring two mid-level developers adds more headcount, but the seniority gain is smaller, and the model shows that higher headcount increases Budget Overrun Risk and coordination pressure, both of which drag on your goal.
> 
> The two top drivers in the analysis are AI Feature Complexity, which has a moderate negative influence on the goal across all options, and Hiring Budget, which has a weak positive influence. Because AI Feature Complexity affects every option equally as an external factor, it does not change the relative ranking; it simply sets the overall difficulty level. Hiring Budget slightly favours the tech lead option because a single senior hire is more budget-efficient than two mid-level salaries, reducing the risk of a budget overrun.
> 
> The result is stable, meaning it holds under most plausible variations of your assumptions, so the 97-percentage-point margin is not a close call. The main scenario in which a different option could come out ahead would require the seniority advantage of a tech lead to be much smaller than assumed, or the coordination overhead of two mid-level developers to be negligible. Would you like to explore either of those assumptions?
> 
> The evidence that would most improve confidence is firmer support for 'AI Feature Complexity', since it carries the most weight in this result.

### T07 — armB-v42.2a (272w, exit=turn_executor)

> Hire One Tech Lead comes out ahead in 96% of simulations, and the model structure explains why clearly. Technical Seniority of Hire is the decisive factor: hiring a tech lead sets seniority high, which has a moderate positive causal link to Feature Delivery Speed and a moderate negative link to 6-Month Deadline Miss. Both of those flow directly into your goal, so higher seniority simultaneously accelerates delivery and reduces the biggest risk to shipping on time.
> 
> By contrast, Hire Two Mid-Level Developers adds headcount without the same seniority lift. More headcount does help Feature Delivery Speed, but it also carries a moderate positive link to Budget Overrun Risk and a weak positive link to Onboarding and Ramp-Up Delay, both of which pull against your goal. The net effect is that the two-developer option trades away seniority benefits for risks that partially cancel out the headcount gain.
> 
> AI Feature Complexity is the top driver in the analysis, with a moderate negative influence on the goal. Because a tech lead's seniority directly reduces the 6-Month Deadline Miss risk that complexity amplifies, the tech lead option is better insulated against that uncertainty than the mid-level alternative.
> 
> Budget Utilisation is the second driver, with a weak negative influence. Hiring two developers pushes headcount higher, which your model links to greater budget overrun risk, so this factor also favours the single tech lead.
> 
> The result is stable, meaning it holds under most plausible variations of your assumptions, which gives you reasonable confidence before acting.
> 
> The evidence that would most improve confidence is firmer support for 'AI Feature Complexity', since it carries the most weight in this result.

### T09 — armA-v42.1a (252w, exit=turn_executor)

> The 15% minimum delivery speed improvement constraint sits on AI Feature Delivery Speed, so each option is assessed against whether it clears that threshold.
> 
> Hire One Tech Lead is the only option that comes out ahead in the analysis, leading in 98% of simulations. Its advantage comes from the sharp rise in Team Seniority Level, which has a direct positive causal link to AI Feature Delivery Speed. A single senior hire also keeps Additional Developer Headcount low, which limits Coordination and Ramp-Up Overhead and Budget Overrun Risk — both of which drag on the goal. The model suggests this option is well-placed to meet the 15% target.
> 
> Hire Two Mid-Level Developers leads in only 1% of simulations. It adds more headcount, which does positively influence delivery speed, but the seniority gain is smaller than the tech lead option. The model shows that higher headcount increases coordination pressure and budget overrun risk, and the seniority-driven delivery speed improvement is less likely to clear the 15% threshold reliably.
> 
> Delay Hire (Status Quo) does not add seniority or meaningful headcount, so it has the weakest path to any delivery speed improvement and is the least likely to meet the constraint.
> 
> In short, Hire One Tech Lead is the option your model shows as most likely to clear the 15% delivery speed target, driven primarily by the seniority advantage and lower coordination overhead.
> 
> The evidence that would most improve confidence is firmer support for 'AI Feature Complexity', since it carries the most weight in this result.

### T09 — armB-v42.2a (13w, exit=turn_executor)

> I couldn't complete that turn cleanly, but your current analysis is still available.

### T13 — armA-v42.1a (97w, exit=turn_executor)

> Hire One Tech Lead performs best, with a probability of 98%. That is ahead of Hire Two Mid-Level Developers by 97 percentage points, so the lead is meaningful rather than marginal. The result is driven mainly by AI Feature Complexity, which moderately weakens the lead, and Hiring Budget, which slightly strengthens the lead. This result looks stable, so it should hold under reasonable variation. The evidence that would most improve confidence is firmer support for 'AI Feature Complexity', since it carries the most weight in this result. Would you like to explore what would change this result?

### T13 — armB-v42.2a (230w, exit=turn_executor)

> The analysis is stale following the change to AI Feature Complexity, so the results shown still reflect the model before that edit. The 96% figure for Hire One Tech Lead comes from the latest available run, not the updated model.
> 
> That said, here is why the structural logic has consistently favoured that option, and why a rerun is unlikely to reverse it dramatically.
> 
> - **Seniority is the decisive mechanism.** The tech lead option sets Technical Seniority of Hire high, which has direct positive causal links to Feature Delivery Speed and Technical Quality and Architecture, and a direct negative link to 6-Month Deadline Miss. No other option replicates that combination through a single hire.
> - **Higher complexity strengthens the case for seniority.** You just raised AI Feature Complexity to 8. That factor has a moderate positive causal link to 6-Month Deadline Miss, meaning the deadline risk has increased. A senior hire directly buffers that risk; two mid-level developers do not, so the gap between options may actually widen after a rerun.
> - **Headcount alone does not compensate.** Two mid-level developers add headcount, which has a moderate positive link to delivery speed, but also carries positive links to Budget Overrun Risk and Onboarding and Ramp-Up Delay, both of which flow negatively into your goal.
> 
> Would you like to rerun the analysis now to see how the complexity change affects the updated result?

### T17 — armA-v42.1a (311w, exit=turn_executor)

> The three risks in your model are Delivery Delay Beyond 6 Months, Budget Overrun Risk, and Coordination and Ramp-Up Overhead. Here is how they stack up given the current analysis.
> 
> Delivery Delay Beyond 6 Months is the most consequential. It has a direct moderate negative link to your goal, and AI Feature Complexity — the strongest driver in the whole model — feeds into it with a moderate positive link. That means if your AI features turn out to be harder than expected, this risk amplifies and the 6-month deadline becomes genuinely threatened. Hiring One Tech Lead helps here because higher team seniority has a moderate negative link to this risk, reducing its likelihood.
> 
> Budget Overrun Risk is present but less decisive. Hiring Budget has a moderate negative link to it, meaning a larger budget reduces the risk, and Additional Developer Headcount has a moderate positive link, meaning more hires increase it. This is one reason Hire Two Mid-Level Developers scores lower: two hires raise headcount more, which pushes budget overrun risk up.
> 
> Coordination and Ramp-Up Overhead is the weakest of the three in terms of its influence on the goal, with only a weak negative link. However, it is worth watching if you were to add more junior hires, since headcount increases it and seniority reduces it. The tech lead option benefits here too, as higher seniority dampens coordination overhead.
> 
> The most vulnerable assumption underlying all three risks is AI Feature Complexity. It is the strongest driver in the model and you have flagged it as an external factor, meaning it is outside your direct control. If complexity is higher than your current estimate, delivery delay risk rises and the case for a senior hire strengthens further.
> 
> The evidence that would most improve confidence is firmer support for 'AI Feature Complexity', since it carries the most weight in this result.

### T17 — armB-v42.2a (282w, exit=turn_executor)

> Hire One Tech Lead comes out ahead in 97% of simulations, with a 94 percentage point margin over Hire Two Mid-Level Developers, and the result is stable under most plausible variations. That said, two risks stand out as worth watching.
> 
> First, AI Feature Complexity is the strongest driver in the model and has a moderate positive causal link to 6-Month Deadline Miss, which in turn has a moderate negative link to your goal. You have already set complexity to 8, which is high. If the actual complexity of your AI features turns out to be even higher than assumed, deadline risk rises further and the case for a senior hire becomes even more critical. The relationship between AI Feature Complexity and Feature Delivery Speed is also flagged as the most vulnerable assumption in the model, meaning small changes to how strongly complexity slows delivery could shift the numbers.
> 
> Second, the path from 6-Month Deadline Miss to your goal is the other vulnerable relationship in the model. If deadline risk materialises more severely than the model assumes, the goal score drops sharply. This is the mechanism most likely to erode the lead if things go wrong in practice.
> 
> Budget Utilisation has a weak negative influence and is a secondary concern, but worth monitoring if headcount costs run over.
> 
> The minimum delivery speed improvement constraint of at least 15% is now in the model, so the next analysis run will score options against that threshold too.
> 
> The evidence that would most improve confidence is real-world support for the link from 'AI Feature Complexity' to 'Feature Delivery Speed' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### T19 — armA-v42.1a (270w, exit=turn_executor)

> The analysis actually points the other way. Hire One Tech Lead comes out ahead in 98% of simulations, with a 97 percentage point lead over Hire Two Mid-Level Developers. That result holds under most plausible variations, so it is not a close call.
> 
> I want to be genuinely useful here rather than just confirm what you already believe, so it is worth understanding what is driving this gap.
> 
> - **Team Seniority Level is the decisive mechanism.** The tech lead option produces higher seniority, which has direct positive links to both delivery speed and architecture quality, while also reducing coordination overhead and delivery delay risk. Two mid-level developers raise headcount, but the model shows headcount has a weaker positive link to delivery speed and actively increases budget overrun risk.
> - **AI Feature Complexity amplifies the seniority advantage.** It is the strongest driver in the model and feeds directly into delivery delay risk. When complexity is high, the senior hire's ability to dampen that risk matters more, not less. If your AI features are harder than expected, the case for a tech lead strengthens further.
> - **Your new constraint may be relevant here.** You have set a minimum 15% delivery speed improvement. The two mid-level developers option scores lower on delivery speed in the current model, so it is worth checking whether it would even clear that threshold.
> 
> What is the reasoning behind your confidence in the two-developer option? If there is something the model is not capturing, such as specific skills those developers would bring or a lower complexity estimate, that is worth encoding so the analysis reflects your actual situation.

### T19 — armB-v42.2a (195w, exit=turn_executor)

> Hire One Tech Lead comes out ahead in 97% of simulations, with a 94 percentage point margin over Hire Two Mid-Level Developers. The result is stable under most plausible variations, so the numbers don't support the two-developer option on your current assumptions.
> 
> That said, your instinct may be picking up on something the model isn't capturing. A few things worth checking:
> 
> - **What's driving your confidence in two developers?** If it's about redundancy, knowledge sharing, or team resilience, those factors aren't currently in the model. Encoding them could genuinely shift the result.
> - **Technical Seniority is a key mechanism.** The model shows that higher seniority reduces deadline risk through a moderate causal link to 6-Month Deadline Miss. Two mid-level hires score lower on seniority, which is the main reason they trail. If you believe their combined output would match a tech lead's, that relationship is worth adjusting.
> - **AI Feature Complexity is the most vulnerable assumption.** If complexity is lower than the current setting of 8, the gap between options narrows. What's your read on actual complexity?
> 
> What's the strongest reason you're leaning toward two developers? That's the assumption most worth encoding before you decide.

### T20 — armA-v42.1a (236w, exit=turn_executor)

> The highest-value evidence you could gather is a firmer estimate of AI Feature Complexity. It is the strongest driver in your model and it sits outside your direct control, which makes it both the most influential and the most uncertain input. It feeds directly into Delivery Delay Beyond 6 Months with a moderate positive link, and also weakens AI Feature Delivery Speed. Because the tech lead option's advantage partly rests on its ability to dampen delivery delay risk, if complexity turns out to be higher than your current estimate, that advantage grows further. If it is lower, the case for two mid-level developers becomes slightly more plausible, though the 97 percentage point margin means it would need to shift substantially to change the outcome.
> 
> The most practical way to gather this evidence is to get a technical scoping estimate from someone who has built comparable AI features, ideally an external reference rather than an internal optimistic forecast. Even a rough complexity band, low, medium, or high, would let you stress-test the model against a realistic range rather than a single point estimate.
> 
> Secondary evidence worth gathering is whether either hiring option would realistically clear your 15% delivery speed improvement constraint. The two mid-level developers option scores lower on delivery speed in the current model, so confirming whether that gap is real, based on comparable team compositions, would either validate the constraint or reveal it needs recalibrating.

### T20 — armB-v42.2a (203w, exit=turn_executor)

> The highest-value evidence targets the two most vulnerable assumptions in your model, both of which sit on the path most likely to change the outcome.
> 
> First, the relationship between AI Feature Complexity and Feature Delivery Speed is the most vulnerable assumption in the model. AI Feature Complexity is also the strongest driver of your result. Any real-world data on how your specific AI features have slowed delivery in comparable projects, such as engineering post-mortems, sprint velocity data, or estimates from engineers who have built similar systems, would directly ground this link and either confirm or challenge the current assumption.
> 
> Second, the causal link from 6-Month Deadline Miss to your goal is the other vulnerable relationship. Evidence here means understanding how severe a deadline slip would actually be: is six months a hard commercial deadline, a board commitment, or an internal target? The answer changes how much weight this risk should carry in the model.
> 
> Beyond those two, the minimum delivery speed improvement constraint of at least 15% is now in the model but has not yet been scored against the options. Running the analysis would show whether Hire One Tech Lead actually clears that threshold, which is the next concrete check worth making.

### P21 — armA-v42.1a (283w, exit=turn_executor)

> The analysis identifies two factors as the main drivers of the outcome.
> 
> AI Feature Complexity has the biggest influence, and it works against your goal. It has a moderate positive causal link to Delivery Delay Beyond 6 Months, and a weak negative link to AI Feature Delivery Speed. Because it sits outside your direct control, it is both the most influential and the most uncertain input in the model. When complexity is high, the risk of missing the 6-month deadline rises, and the advantage of hiring a senior engineer who can manage that complexity grows with it.
> 
> Hiring Budget has a weaker positive influence on the goal. It works through Budget Overrun Risk: a larger budget has a moderate negative link to that risk, meaning more budget reduces the chance of an overrun. This is a relatively minor pathway compared to the complexity route, but it does mean that budget constraints could quietly erode the result if they tighten.
> 
> The remaining factors — Team Seniority Level and Additional Developer Headcount — are not listed as top computed drivers, but they are the mechanism through which your hiring options differ. Seniority has moderate positive links to delivery speed and architecture quality, and moderate negative links to both coordination overhead and delivery delay risk. Headcount has a moderate positive link to delivery speed but also raises budget overrun risk and coordination overhead. This is precisely why Hire One Tech Lead comes out ahead: it produces higher seniority, which dampens the two biggest risks, while adding only one hire keeps headcount-related risks low.
> 
> The evidence that would most improve confidence is firmer support for 'AI Feature Complexity', since it carries the most weight in this result.

### P21 — armB-v42.2a (338w, exit=turn_executor)

> The analysis identifies two factors with meaningful influence on the outcome, and they pull in the same direction.
> 
> AI Feature Complexity has the biggest influence on the result. It works through two paths: a weak negative causal link to Feature Delivery Speed, which slows progress directly, and a moderate positive causal link to 6-Month Deadline Miss, which then carries a moderate negative link to your goal. Because complexity is currently set to 8, this factor is already pushing deadline risk upward. It is also the most vulnerable assumption in the model, meaning the relationship between AI Feature Complexity and Feature Delivery Speed is the one most likely to change the outcome if it turns out to be stronger or weaker than assumed.
> 
> Budget Utilisation has a weak negative influence. It flows through Budget Overrun Risk, which carries a weak negative link to your goal. At its current level it is a secondary concern, but worth watching if headcount costs run over.
> 
> Technical Seniority of Hire is not listed as a top driver in the computed results, but structurally it has moderate positive causal links to both Feature Delivery Speed and Technical Quality and Architecture, and a moderate negative link to 6-Month Deadline Miss. This is the mechanism that separates Hire One Tech Lead from Hire Two Mid-Level Developers: higher seniority reduces deadline risk and improves delivery speed, which is why the tech lead option comes out ahead in 97% of simulations.
> 
> Developer Headcount Added has a moderate positive link to Feature Delivery Speed but also a moderate positive link to Budget Overrun Risk and a weak positive link to Onboarding and Ramp-Up Delay, so adding headcount brings both benefits and costs. The net effect favours the tech lead option because seniority matters more than raw headcount on your current assumptions.
> 
> The evidence that would most improve confidence is real-world support for the link from 'AI Feature Complexity' to 'Feature Delivery Speed' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### P22 — armA-v42.1a (24w, exit=turn_executor)

> I wasn't sure what you meant by AI Feature Delivery Speed. Try asking about a specific option, or describe what you'd like to change.

### P22 — armB-v42.2a (230w, exit=turn_executor)

> The current analysis shows Hire One Tech Lead comes out ahead in 97% of simulations, but the 15% minimum delivery speed improvement constraint was only added after the last run. That means the analysis has not yet scored either option against that threshold, so we cannot say from the current results whether the tech lead option actually clears it.
> 
> Structurally, the case is encouraging: Technical Seniority of Hire has a moderate positive causal link to Feature Delivery Speed, and that is the main mechanism separating the tech lead from the two mid-level developers. Higher seniority also carries a moderate negative link to 6-Month Deadline Miss, which reinforces delivery pace. So the model's logic points toward the tech lead being more likely to hit a speed improvement target.
> 
> However, the relationship between AI Feature Complexity and Feature Delivery Speed is the most vulnerable assumption in the model, and complexity is currently set to 8. If that link is stronger than assumed, delivery speed gains could be smaller than expected, making the 15% threshold harder to clear.
> 
> Running the analysis now would score both options against the constraint and give you a concrete answer.
> 
> The evidence that would most improve confidence is real-world support for the link from 'AI Feature Complexity' to 'Feature Delivery Speed' rather than the current model estimate, since it is the assumption most likely to change the outcome.

### P23 — armA-v42.1a (250w, exit=turn_executor)

> The analysis still points the other way, and I'd be doing you a disservice to confirm something the model contradicts.
> 
> Hire One Tech Lead comes out ahead in 98% of simulations, with a 97 percentage point lead. That result is stable under most plausible variations.
> 
> - **Team consensus is not the same as evidence.** When everyone agrees, it often means the group is reasoning from the same shared assumptions rather than independently testing them. The question worth asking your team is: what specifically would make the tech lead option worse? If no one can name it, the agreement may be less informative than it feels.
> - **The two-developer option's weakness is structural.** Adding headcount raises budget overrun risk and coordination overhead, while seniority is what actually dampens delivery delay risk and improves architecture quality. Two mid-level developers produce lower seniority, and that gap runs through most of the pathways to your goal.
> - **Your 15% delivery speed constraint may already rule it out.** You set a minimum 15% improvement threshold. The two-developer option scores lower on delivery speed in the current model, so it is worth checking whether it would even clear that bar before treating it as viable.
> 
> If there is something your team knows that the model does not capture, such as specific skills those developers bring, a lower complexity estimate, or a cost constraint that makes the tech lead unaffordable, that is genuinely worth encoding. What is the strongest argument your team is making for two developers?

### P23 — armB-v42.2a (236w, exit=turn_executor)

> The numbers still point the other way. Hire One Tech Lead comes out ahead in 97% of simulations, with a 94 percentage point margin over Hire Two Mid-Level Developers. That result is stable under most plausible variations.
> 
> Team consensus is worth taking seriously, but it is worth asking what it is based on.
> 
> - **Seniority is the deciding mechanism.** The model shows that higher seniority reduces deadline risk and improves delivery speed through moderate causal links to both. Two mid-level hires score lower on seniority, and that gap is what drives the result. If your team believes their combined output would match a tech lead's, that relationship is the one to challenge and adjust.
> - **Shared conviction can mask a shared blind spot.** When everyone agrees quickly, it is worth asking whether the team is weighing the same evidence or reinforcing each other's assumptions. What is the strongest specific reason your team gives for two developers? If it is redundancy, knowledge sharing, or resilience, those factors are not currently in the model and could genuinely shift the result if encoded.
> - **AI Feature Complexity is the most vulnerable assumption.** If your team believes complexity is lower than the current setting of 8, narrowing that would be the fastest way to test whether the gap between options closes.
> 
> What is the core argument your team is making? That is the assumption most worth encoding before you decide.

### P24 — armA-v42.1a (325w, exit=turn_executor)

> Looking at the current model structure, a few factors are worth reconsidering.
> 
> AI Feature Complexity is currently modelled as an external factor with a direct causal link to both Delivery Delay Beyond 6 Months and AI Feature Delivery Speed. This is structurally sound, but because it sits outside your control and carries the most weight in the result, it may be worth treating it explicitly as a range of scenarios rather than a single estimate. If your team has a view on whether complexity is low, medium, or high, encoding that as a bounded uncertainty would make the model more honest about what you actually know.
> 
> Additional Developer Headcount and Team Seniority Level are both modelled as controllable factors, but they are currently set by whichever option is chosen rather than being independently adjustable. This is appropriate for a hiring decision, but it means the model assumes each option produces a fixed seniority level. If the tech lead you hire could vary in seniority, or if one of the mid-level developers has more experience than the other, that variation is not currently captured. You could split seniority into a range rather than a point value to reflect that uncertainty.
> 
> Budget Overrun Risk is modelled as a risk that flows to the goal, but Hiring Budget flows into it only through a moderate negative link. If you have an actual budget ceiling, the existing constraint on delivery speed is doing some of this work, but a hard budget cap on the hiring decision itself might be more structurally accurate than a soft dampening relationship.
> 
> Coordination and Ramp-Up Overhead has only a weak negative link to the goal, and it is driven by both headcount and seniority. This feels structurally light given that coordination overhead is often cited as a real cost of adding junior developers. If your team believes this risk is more significant than the model currently reflects, strengthening that relationship would be worth testing.

### P24 — armB-v42.2a (283w, exit=turn_executor)

> A good structural question. Looking at your model, there are a couple of factors that would work better if their role were reconsidered.
> 
> - **Technical Seniority of Hire is doing double duty.** It is currently a controllable factor, but it is also the primary mechanism separating your options. Because each option sets seniority differently, it is effectively acting as a mediator between the hiring choice and your outcomes. Making this explicit, with seniority sitting clearly between the options and the delivery/deadline outcomes, would make the causal logic easier to interrogate and adjust.
> 
> - **Developer Headcount Added has the same structural issue.** It is a controllable factor, but its value is entirely determined by which option you choose. A factor that cannot vary independently of the option is better treated as an option attribute than a free-standing factor. As it stands, it may be absorbing uncertainty it should not.
> 
> - **Onboarding and Ramp-Up Delay is underweighted for its mechanism.** It has a weak negative link to your goal, but the delay it represents could be material if complexity is high. It would work better as a time-based constraint rather than a soft risk, since a ramp-up period has a concrete duration that either fits inside six months or does not.
> 
> - **AI Feature Complexity is external but fixed.** It is categorised as external, which is right, but it has no uncertainty range attached. Given it is the strongest driver and the most vulnerable assumption, treating it as a range rather than a point value would let the model reflect genuine uncertainty about how complex your AI features actually are.
> 
> Which of these feels most misaligned with how your team actually thinks about the decision?

### P25 — armA-v42.1a (258w, exit=turn_executor)

> Hire One Tech Lead comes out ahead in 98% of simulations, with a 97 percentage point lead over the two mid-level developers option. That result is stable under most plausible variations.
> 
> That said, a few things are worth holding in mind before you act on it.
> 
> - **The result is driven by seniority, not headcount.** The tech lead option wins because higher seniority dampens delivery delay risk and improves architecture quality across multiple pathways. If the specific tech lead you hire turns out to be less senior than assumed, that advantage narrows. It is worth confirming the seniority level of your actual candidate against what the model assumes.
> - **AI Feature Complexity is the biggest uncertainty.** It sits outside your control and has the strongest influence on the outcome. Your current estimate is a single point; if complexity is higher than expected, the tech lead advantage actually grows. If it is lower, the two-developer case becomes marginally more plausible, though the margin is large enough that it would need to shift substantially to change the outcome.
> - **Your 15% delivery speed constraint is the practical test.** The two-developer option scores lower on delivery speed in the current model. Before closing the door on it entirely, it is worth checking whether it would even clear that bar based on comparable team compositions you have seen.
> 
> The model points clearly toward the tech lead. The one question worth sitting with: do you have a specific candidate in mind, and does their profile match the seniority level the model is assuming?

### P25 — armB-v42.2a (221w, exit=turn_executor)

> The numbers point clearly toward Hire One Tech Lead, though the call is yours to make.
> 
> - **The result is stable and wide.** The tech lead option comes out ahead in 97% of simulations, with a 94 percentage point margin over two mid-level developers. That kind of gap does not close under minor assumption changes, so the model is not on a knife edge.
> - **Seniority is the deciding mechanism.** Higher seniority reduces deadline risk and improves delivery speed through moderate causal links to both. Two mid-level hires score lower on seniority, and that single difference is what drives the result across nearly every simulated scenario.
> - **One check worth making before you commit.** The relationship between AI Feature Complexity and Feature Delivery Speed is the most vulnerable assumption in the model. If your team genuinely believes complexity is lower than the current setting of 8, adjusting that is the fastest way to test whether the gap narrows. If it still holds, you have a much stronger basis for the decision.
> 
> The one thing the model has not yet answered is whether the tech lead option actually clears your 15% delivery speed improvement constraint, since that threshold was added after the last run. Rerunning the analysis would score both options against it and give you a complete picture before you decide.

