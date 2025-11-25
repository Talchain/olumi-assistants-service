import type { components } from "../../generated/openapi.d.ts";

export interface BiasDefinition {
  code: string;
  label: string;
  mechanism: string;
  citation: string;
  category: "individual" | "team" | "strategic";
  typical_interventions: string[];
}

export const BIAS_LIBRARY: BiasDefinition[] = [
  {
    code: "CONFIRMATION_BIAS",
    label: "Confirmation bias",
    mechanism:
      "Tendency to seek evidence supporting existing beliefs while dismissing contradictory data.",
    citation: "Nickerson (1998) - Review of General Psychology",
    category: "individual",
    typical_interventions: [
      "Write down one plausible scenario where your preferred option fails.",
      "List 1-2 pieces of evidence that would support that failure scenario.",
    ],
  },
  {
    code: "ANCHORING",
    label: "Anchoring",
    mechanism:
      "Over-reliance on the first piece of information encountered when making estimates.",
    citation: "Tversky & Kahneman (1974) - Science",
    category: "individual",
    typical_interventions: [
      "Ask each person to write down their estimate independently without seeing others.",
      "Only then compare and discuss the spread of estimates.",
    ],
  },
  {
    code: "SUNK_COST",
    label: "Sunk cost fallacy",
    mechanism:
      "Continued investment based on past costs rather than future value.",
    citation: "Arkes & Blumer (1985) - Psychological Bulletin",
    category: "strategic",
    typical_interventions: [
      "Imagine you were joining this team today with fresh budget and no history.",
      "Would you still choose to invest in this option? If not, write what you would recommend.",
    ],
  },
  {
    code: "GROUPTHINK",
    label: "Groupthink",
    mechanism:
      "Tendency for cohesive groups to suppress dissent and converge on consensus prematurely.",
    citation: "Janis (1972) - Victims of Groupthink",
    category: "team",
    typical_interventions: [
      "Before the next meeting, ask each stakeholder to write a private one-paragraph critique.",
      "Read them out anonymously and discuss the strongest concerns.",
    ],
  },
  {
    code: "PLANNING_FALLACY",
    label: "Planning fallacy",
    mechanism:
      "Underestimation of time, costs, and risks in planning due to optimism bias.",
    citation:
      "Buehler et al. (1994) - Journal of Personality and Social Psychology",
    category: "strategic",
    typical_interventions: [
      "Identify one similar project from the last year.",
      "Compare its original estimate vs actual duration/cost and adjust your current estimate.",
    ],
  },
  {
    code: "BASE_RATE_NEGLECT",
    label: "Base-rate neglect",
    mechanism:
      "Ignoring statistical base rates when reasoning about specific cases.",
    citation: "Kahneman & Tversky (1973) - Psychological Bulletin",
    category: "individual",
    typical_interventions: [
      "Write down: out of 10 similar initiatives, how many actually hit their target?",
      "Update your probability estimate to reflect that base rate.",
    ],
  },
  {
    code: "AVAILABILITY_BIAS",
    label: "Availability bias",
    mechanism:
      "Overweighting recent, vivid, or emotionally-charged examples when estimating frequency or probability.",
    citation: "Tversky & Kahneman (1973) - Cognitive Psychology",
    category: "individual",
    typical_interventions: [
      "List 5 examples from the past year, not just the ones that come to mind first",
      "Check base rates from actual data before estimating probability",
    ],
  },
  {
    code: "STATUS_QUO_BIAS",
    label: "Status quo bias",
    mechanism:
      "Preference for the current state of affairs, treating it as the reference point even when change would be beneficial.",
    citation: "Samuelson & Zeckhauser (1988) - Journal of Risk and Uncertainty",
    category: "strategic",
    typical_interventions: [
      "Imagine you are starting fresh with no existing system - what would you build?",
      "List the switching costs explicitly and compare to potential gains",
    ],
  },
  {
    code: "OPTIMISM_BIAS",
    label: "Optimism bias",
    mechanism:
      "Systematic tendency to underestimate risks and overestimate likelihood of positive outcomes.",
    citation: "Weinstein (1980) - Journal of Personality and Social Psychology",
    category: "individual",
    typical_interventions: [
      "Write down three specific ways this could fail",
      "Ask a skeptical colleague to challenge your assumptions",
    ],
  },
  {
    code: "OVERCONFIDENCE",
    label: "Overconfidence",
    mechanism:
      "Excessive certainty in own judgments, leading to overly narrow confidence intervals and underestimation of uncertainty.",
    citation: "Lichtenstein et al. (1982) - Judgment Under Uncertainty",
    category: "individual",
    typical_interventions: [
      "Widen your confidence interval: what would make you 90% confident vs 50%?",
      "List three things you might be wrong about in this analysis",
    ],
  },
  {
    code: "AUTHORITY_BIAS",
    label: "Authority bias",
    mechanism:
      "Tendency to attribute greater accuracy to opinions of authority figures, regardless of content.",
    citation: "Milgram (1963) - Journal of Abnormal and Social Psychology",
    category: "team",
    typical_interventions: [
      "Collect input anonymously before revealing who said what",
      "Explicitly ask junior team members to share their view first",
    ],
  },
  {
    code: "FRAMING_EFFECT",
    label: "Framing effect",
    mechanism:
      "Drawing different conclusions from the same information depending on how it is presented.",
    citation: "Tversky & Kahneman (1981) - Science",
    category: "individual",
    typical_interventions: [
      "Reframe the decision as a loss rather than a gain (or vice versa)",
      "Present the same data in at least two different formats before deciding",
    ],
  },
];

export function getBiasDefinition(code: string): BiasDefinition | undefined {
  const normalized = code.toUpperCase();
  return BIAS_LIBRARY.find((b) => b.code === normalized);
}

export const BIAS_DEFINITIONS: Record<string, BiasDefinition> = BIAS_LIBRARY.reduce(
  (acc, def) => {
    acc[def.code] = def;
    return acc;
  },
  {} as Record<string, BiasDefinition>,
);

export type CEEBiasFindingV1 = components["schemas"]["CEEBiasFindingV1"] & {
  code?: string;
  mechanism?: string;
  citation?: string;
  micro_intervention?: {
    steps?: string[];
    estimated_minutes?: number;
  };
};

export function applyBiasDefinition(
  finding: CEEBiasFindingV1,
  code: string,
  options?: { estimatedMinutes?: number },
): CEEBiasFindingV1 {
  const def = getBiasDefinition(code);
  if (!def) {
    return finding;
  }

  const estimatedMinutes = options?.estimatedMinutes ?? 3;

  return {
    ...finding,
    code: def.code,
    mechanism: def.mechanism,
    citation: def.citation,
    micro_intervention: {
      steps: def.typical_interventions.slice(0, 3),
      estimated_minutes: estimatedMinutes,
    },
  };
}
