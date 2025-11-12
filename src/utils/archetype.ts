/**
 * Fast Archetype Classifier (v1.4.0)
 *
 * Inline archetype detection using regex patterns - no LLM call required.
 * Classifies decision briefs into common decision archetypes for telemetry
 * and UI optimization.
 */

export const ARCHETYPES = [
  "resource_allocation",
  "vendor_selection",
  "feature_prioritization",
  "hiring",
  "process_design",
  "risk_assessment",
  "strategic_direction",
  "unknown",
] as const;

export type Archetype = typeof ARCHETYPES[number];

/**
 * Archetype detection patterns.
 * Each archetype has multiple regex patterns (case-insensitive).
 */
const ARCHETYPE_PATTERNS: Record<Exclude<Archetype, "unknown">, RegExp[]> = {
  resource_allocation: [
    /\b(allocat(e|ing|ion)|distribut(e|ing|ion)|assign(ing|ment)?)\b.*\b(budget|resource|fund|capital|money)\b/i,
    /\b(budget|resource|fund|capital)\b.*\b(allocat|distribut|assign)/i,
    /\bhow\s+(much|many).*\b(spend|invest|allocat)/i,
    /\bprioritiz(e|ing)\b.*\b(spending|investment|resource)/i,
    /\bdistribut(e|ing|ion)\b.*\b(fund)/i,
  ],
  vendor_selection: [
    /\b(select|choos(e|ing)|evaluat(e|ing)|compar(e|ing))\b.*\b(vendor|supplier|provider|partner)\b/i,
    /\bvendor\b.*\b(selection|evaluation|comparison)/i,
    /\b(which|what)\b.*\b(vendor|supplier|provider)\b.*\b(use|choose|select)/i,
    /\b(RFP|request\s+for\s+proposal)\b/i,
    /\bcompar(e|ing)\b.*(AWS|GCP|Azure|cloud\s+provider)/i,
    /\bevaluat(e|ing)\b.*\b(provider|cloud)/i,
  ],
  feature_prioritization: [
    /\b(prioritiz(e|ing)|rank(ing)?)\b.*\b(feature|capability|functionality|requirement)\b/i,
    /\bfeature\b.*\b(priorit|roadmap|backlog)/i,
    /\bproduct\b.*\b(roadmap|backlog|planning)/i,
    /\b(which|what)\b.*\bfeature(s)?\b.*\b(build|develop|implement)/i,
    /\bprioritiz(e|ing)\b.*\bfeatures?\b/i,
    /\bproduct\s+planning\b/i,
    /\brank(ing)?\b.*\b(requirement|backlog)/i,
  ],
  hiring: [
    /\b(hir(e|ing)|recruit(ing|ment)?)\b.*\b(candidate|person|employee|staff|team\s+member)\b/i,
    /\bshould\s+(we|i)\s+hire\b/i,
    /\b(candidate|applicant)\b.*\b(evaluation|selection|assessment)/i,
    /\b(which|what)\b.*\bcandidate\b.*\b(hire|select|choose)/i,
    /\bevaluat(e|ing)\b.*\bcandidate/i,
    /\bcandidate(s)?\b.*(which\s+one|to\s+hire)/i,
  ],
  process_design: [
    /\b(design(ing)?|creat(e|ing)|establish(ing)?|implement(ing)?)\b.*\b(process|procedure|workflow|system)\b/i,
    /\bprocess\b.*\b(design|improvement|optimization)/i,
    /\bhow\b.*(structure|organize|streamline)/i,
    /\b(workflow|procedure|methodology)\b.*\b(design|change|improvement)/i,
    /\bimprov(e|ing)\b.*\b(procedure|process|deployment)/i,
    /\b(workflow|deployment)\b.*\b(optimization)/i,
  ],
  risk_assessment: [
    /\b(assess(ing|ment)?|evaluat(e|ing)|analyz(e|ing))\b.*\b(risk|threat|vulnerability)\b/i,
    /\brisk\b.*\b(assessment|analysis|evaluation|mitigation)/i,
    /\b(what|which)\b.*\brisk(s)?\b.*\b(address|mitigate|prioritize)/i,
    /\bthreat\b.*\b(assessment|analysis|evaluation)/i,
    /\brisk(s)?\b.*\b(for|to|before|cloud|cybersecurity|security)/i,
    /\b(which|what)\b.*\brisk(s)?\b/i,
    /\banalyz(e|ing)\b.*\bthreat/i,
  ],
  strategic_direction: [
    /\b(strategic|strategy|vision|direction|pivot)\b/i,
    /\b(expand(ing)?|enter(ing)?|exit(ing)?)\b.*\b(market|industry|segment)\b/i,
    /\b(long[- ]term|future)\b.*\b(direction|strategy|plan)/i,
    /\b(should\s+we|whether\s+to)\b.*\b(expand|pivot|enter|exit|acquire|merge)\b/i,
    /\benter(ing)?\b.*\b(market|industry|segment|healthcare|finance|tech)/i,
  ],
};

/**
 * Classify a decision brief into an archetype using regex patterns.
 *
 * @param brief - The decision brief text
 * @returns The detected archetype ("unknown" if no match)
 */
export function classifyArchetype(brief: string): Archetype {
  const normalizedBrief = brief.toLowerCase().trim();

  // Check each archetype's patterns
  for (const [archetype, patterns] of Object.entries(ARCHETYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedBrief)) {
        return archetype as Archetype;
      }
    }
  }

  return "unknown";
}

/**
 * Get human-readable label for archetype.
 */
export function getArchetypeLabel(archetype: Archetype): string {
  const labels: Record<Archetype, string> = {
    resource_allocation: "Resource Allocation",
    vendor_selection: "Vendor Selection",
    feature_prioritization: "Feature Prioritization",
    hiring: "Hiring Decision",
    process_design: "Process Design",
    risk_assessment: "Risk Assessment",
    strategic_direction: "Strategic Direction",
    unknown: "Unknown",
  };
  return labels[archetype];
}
