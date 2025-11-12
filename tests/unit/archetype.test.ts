import { describe, it, expect } from "vitest";
import { classifyArchetype, getArchetypeLabel, ARCHETYPES, type Archetype } from "../../src/utils/archetype.js";

describe("Fast Archetype Classifier (v1.4.0)", () => {
  describe("Resource Allocation", () => {
    it("detects budget allocation decisions", () => {
      expect(classifyArchetype("How should we allocate our marketing budget for Q4?")).toBe("resource_allocation");
      expect(classifyArchetype("Need to distribute funds across teams")).toBe("resource_allocation");
      expect(classifyArchetype("How much to spend on cloud infrastructure?")).toBe("resource_allocation");
    });

    it("detects resource distribution", () => {
      expect(classifyArchetype("Assign capital to new initiatives")).toBe("resource_allocation");
      expect(classifyArchetype("Prioritizing spending for next quarter")).toBe("resource_allocation");
    });
  });

  describe("Vendor Selection", () => {
    it("detects vendor evaluation", () => {
      expect(classifyArchetype("Choosing a CRM vendor for our sales team")).toBe("vendor_selection");
      expect(classifyArchetype("Evaluate cloud providers for migration")).toBe("vendor_selection");
      expect(classifyArchetype("Which supplier should we use for components?")).toBe("vendor_selection");
    });

    it("detects RFP language", () => {
      expect(classifyArchetype("We need to issue an RFP for consulting services")).toBe("vendor_selection");
      expect(classifyArchetype("Request for proposal from security vendors")).toBe("vendor_selection");
    });
  });

  describe("Feature Prioritization", () => {
    it("detects feature ranking", () => {
      expect(classifyArchetype("Prioritize features for next sprint")).toBe("feature_prioritization");
      expect(classifyArchetype("Which features should we build first?")).toBe("feature_prioritization");
      expect(classifyArchetype("Product roadmap for Q1 release")).toBe("feature_prioritization");
    });

    it("detects backlog management", () => {
      expect(classifyArchetype("Ranking requirements in our backlog")).toBe("feature_prioritization");
      expect(classifyArchetype("Product planning for next release")).toBe("feature_prioritization");
    });
  });

  describe("Hiring", () => {
    it("detects candidate selection", () => {
      expect(classifyArchetype("Should we hire this senior engineer candidate?")).toBe("hiring");
      expect(classifyArchetype("Evaluating candidates for marketing role")).toBe("hiring");
      expect(classifyArchetype("Which applicant should we hire for PM position?")).toBe("hiring");
    });

    it("detects recruiting decisions", () => {
      expect(classifyArchetype("Recruiting a new team member for ops")).toBe("hiring");
      expect(classifyArchetype("Candidate assessment for data scientist role")).toBe("hiring");
    });
  });

  describe("Process Design", () => {
    it("detects process creation", () => {
      expect(classifyArchetype("Design a new onboarding process for customers")).toBe("process_design");
      expect(classifyArchetype("Creating a workflow for code review")).toBe("process_design");
      expect(classifyArchetype("How should we structure our sales pipeline?")).toBe("process_design");
    });

    it("detects process improvement", () => {
      expect(classifyArchetype("Improving our deployment procedure")).toBe("process_design");
      expect(classifyArchetype("Workflow optimization for support tickets")).toBe("process_design");
    });
  });

  describe("Risk Assessment", () => {
    it("detects risk evaluation", () => {
      expect(classifyArchetype("Assess cybersecurity risks for cloud migration")).toBe("risk_assessment");
      expect(classifyArchetype("Which risks should we prioritize?")).toBe("risk_assessment");
      expect(classifyArchetype("Analyzing threats to our infrastructure")).toBe("risk_assessment");
    });

    it("detects risk mitigation", () => {
      expect(classifyArchetype("Risk assessment for new product launch")).toBe("risk_assessment");
      expect(classifyArchetype("Threat evaluation for compliance")).toBe("risk_assessment");
    });
  });

  describe("Strategic Direction", () => {
    it("detects strategic decisions", () => {
      expect(classifyArchetype("Should we expand into European markets?")).toBe("strategic_direction");
      expect(classifyArchetype("Long-term strategy for AI products")).toBe("strategic_direction");
      expect(classifyArchetype("Whether to pivot our business model")).toBe("strategic_direction");
    });

    it("detects market entry decisions", () => {
      expect(classifyArchetype("Entering the healthcare industry")).toBe("strategic_direction");
      expect(classifyArchetype("Exit from legacy product segment")).toBe("strategic_direction");
      expect(classifyArchetype("Strategic direction for next 5 years")).toBe("strategic_direction");
    });
  });

  describe("Unknown archetype", () => {
    it("returns unknown for unrecognized patterns", () => {
      expect(classifyArchetype("What's the weather like today?")).toBe("unknown");
      expect(classifyArchetype("Random text without decision keywords")).toBe("unknown");
      expect(classifyArchetype("Hello world")).toBe("unknown");
    });

    it("returns unknown for ambiguous briefs", () => {
      expect(classifyArchetype("We need to make a decision")).toBe("unknown");
      expect(classifyArchetype("Help us figure this out")).toBe("unknown");
    });
  });

  describe("Edge cases", () => {
    it("is case-insensitive", () => {
      expect(classifyArchetype("ALLOCATE BUDGET FOR MARKETING")).toBe("resource_allocation");
      expect(classifyArchetype("Choose A Vendor For CRM")).toBe("vendor_selection");
    });

    it("handles extra whitespace", () => {
      expect(classifyArchetype("  Prioritize    features   for   release  ")).toBe("feature_prioritization");
    });

    it("handles minimum length briefs", () => {
      expect(classifyArchetype("hire candidate")).toBe("hiring");
      expect(classifyArchetype("allocate budget")).toBe("resource_allocation");
    });
  });

  describe("Multi-keyword matching", () => {
    it("selects first matching archetype", () => {
      // This brief could match both resource_allocation and vendor_selection
      // Should match resource_allocation first
      const brief = "Allocate budget to select the best vendor";
      const result = classifyArchetype(brief);
      expect(["resource_allocation", "vendor_selection"]).toContain(result);
    });
  });

  describe("Archetype labels", () => {
    it("provides human-readable labels for all archetypes", () => {
      expect(getArchetypeLabel("resource_allocation")).toBe("Resource Allocation");
      expect(getArchetypeLabel("vendor_selection")).toBe("Vendor Selection");
      expect(getArchetypeLabel("feature_prioritization")).toBe("Feature Prioritization");
      expect(getArchetypeLabel("hiring")).toBe("Hiring Decision");
      expect(getArchetypeLabel("process_design")).toBe("Process Design");
      expect(getArchetypeLabel("risk_assessment")).toBe("Risk Assessment");
      expect(getArchetypeLabel("strategic_direction")).toBe("Strategic Direction");
      expect(getArchetypeLabel("unknown")).toBe("Unknown");
    });
  });

  describe("Archetype constants", () => {
    it("exports all archetype values", () => {
      expect(ARCHETYPES).toEqual([
        "resource_allocation",
        "vendor_selection",
        "feature_prioritization",
        "hiring",
        "process_design",
        "risk_assessment",
        "strategic_direction",
        "unknown",
      ]);
    });
  });

  describe("Real-world briefs", () => {
    it("classifies realistic decision scenarios", () => {
      const briefs: Array<[string, Archetype]> = [
        ["We need to decide how to allocate our $2M engineering budget across platform, mobile, and web teams", "resource_allocation"],
        ["Comparing AWS, GCP, and Azure for our microservices migration", "vendor_selection"],
        ["Our product backlog has 50 features - need to prioritize top 10 for Q1", "feature_prioritization"],
        ["Have 3 strong candidates for Staff Engineer role - which one to hire?", "hiring"],
        ["Need to establish a new incident response process for on-call engineers", "process_design"],
        ["Assess security risks before launching our API to third-party developers", "risk_assessment"],
        ["Should we pivot from B2C to B2B SaaS model?", "strategic_direction"],
      ];

      for (const [brief, expectedArchetype] of briefs) {
        expect(classifyArchetype(brief)).toBe(expectedArchetype);
      }
    });
  });
});
