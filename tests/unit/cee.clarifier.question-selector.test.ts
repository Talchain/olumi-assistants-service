import { describe, it, expect } from "vitest";
import {
  selectBestQuestion,
  rankAndScoreCandidates,
  scoreQuestionCandidate,
  createQuestionCandidate,
  type QuestionCandidate,
  type ConversationHistoryEntry,
} from "../../src/cee/clarifier/question-selector.js";
import type { Ambiguity } from "../../src/cee/clarifier/ambiguity-detector.js";

describe("CEE clarifier question selector", () => {
  describe("createQuestionCandidate", () => {
    it("should create a question candidate from ambiguity", () => {
      const ambiguity: Ambiguity = {
        id: "amb_1",
        type: "missing_node",
        description: "Missing risk assessment",
        confidence: 0.8,
      };

      const candidate = createQuestionCandidate(
        ambiguity,
        "What risks should we consider?",
        "open_ended"
      );

      expect(candidate.id).toMatch(/^q_[a-f0-9]{8}$/);
      expect(candidate.question).toBe("What risks should we consider?");
      expect(candidate.question_type).toBe("open_ended");
      expect(candidate.ambiguity_type).toBe("missing_node");
      expect(candidate.targets_ambiguity).toBe("Missing risk assessment");
    });

    it("should include options for multiple choice", () => {
      const ambiguity: Ambiguity = {
        id: "amb_2",
        type: "uncertain_edge",
        description: "Unclear relationship",
        confidence: 0.7,
      };

      const candidate = createQuestionCandidate(
        ambiguity,
        "How are these related?",
        "multiple_choice",
        ["Directly", "Indirectly", "Not related"]
      );

      expect(candidate.question_type).toBe("multiple_choice");
      expect(candidate.options).toEqual(["Directly", "Indirectly", "Not related"]);
    });
  });

  describe("scoreQuestionCandidate", () => {
    it("should score missing_node higher than uncertain_edge", () => {
      const missingNode: Omit<QuestionCandidate, "score"> = {
        id: "1",
        question: "What's missing?",
        question_type: "open_ended",
        ambiguity_type: "missing_node",
        targets_ambiguity: "Missing node",
      };

      const uncertainEdge: Omit<QuestionCandidate, "score"> = {
        id: "2",
        question: "How related?",
        question_type: "multiple_choice",
        ambiguity_type: "uncertain_edge",
        targets_ambiguity: "Uncertain edge",
        options: ["A", "B"],
      };

      const missingScore = scoreQuestionCandidate(missingNode, []);
      const edgeScore = scoreQuestionCandidate(uncertainEdge, []);

      expect(missingScore).toBeGreaterThan(edgeScore);
    });

    it("should apply diversity bonus for different question types", () => {
      const candidate: Omit<QuestionCandidate, "score"> = {
        id: "1",
        question: "Binary question?",
        question_type: "binary",
        ambiguity_type: "uncertain_edge",
        targets_ambiguity: "Test",
      };

      // History with only open_ended questions (with question_type for diversity scoring)
      const historyWithTypes: ConversationHistoryEntry[] = [
        { question_id: "q1", question: "First?", answer: "Answer 1", question_type: "open_ended" },
        { question_id: "q2", question: "Second?", answer: "Answer 2", question_type: "open_ended" },
      ];

      // History without question_type (legacy format)
      const historyWithoutTypes: ConversationHistoryEntry[] = [
        { question_id: "q1", question: "First?", answer: "Answer 1" },
        { question_id: "q2", question: "Second?", answer: "Answer 2" },
      ];

      const scoreWithDiversity = scoreQuestionCandidate(candidate, historyWithTypes);
      const scoreWithoutDiversity = scoreQuestionCandidate(candidate, historyWithoutTypes);
      const scoreEmpty = scoreQuestionCandidate(candidate, []);

      // With diverse history (different type), should get a bonus
      expect(scoreWithDiversity).toBeGreaterThan(scoreEmpty);
      // Without question_type in history, no diversity bonus
      expect(scoreWithoutDiversity).toBe(scoreEmpty);
    });

    it("should NOT apply diversity bonus when question type is same as recent", () => {
      const candidate: Omit<QuestionCandidate, "score"> = {
        id: "1",
        question: "Another open ended?",
        question_type: "open_ended",
        ambiguity_type: "uncertain_edge",
        targets_ambiguity: "Test",
      };

      // History with open_ended questions (same type as candidate)
      const history: ConversationHistoryEntry[] = [
        { question_id: "q1", question: "First?", answer: "Answer 1", question_type: "open_ended" },
      ];

      const scoreWithSameType = scoreQuestionCandidate(candidate, history);
      const scoreEmpty = scoreQuestionCandidate(candidate, []);

      // Same type should NOT get diversity bonus
      expect(scoreWithSameType).toBe(scoreEmpty);
    });

    it("should penalize repetitive questions (exact text match)", () => {
      const candidate: Omit<QuestionCandidate, "score"> = {
        id: "1",
        question: "Already asked question?",
        question_type: "open_ended",
        ambiguity_type: "missing_node",
        targets_ambiguity: "Same ambiguity",
      };

      const historyWithSameQuestion: ConversationHistoryEntry[] = [
        { question_id: "q1", question: "Already asked question?", answer: "Answer" },
      ];

      const scoreWithSameQuestion = scoreQuestionCandidate(candidate, historyWithSameQuestion);

      // Should be penalized (score = 0) for asking same question
      expect(scoreWithSameQuestion).toBe(0);
    });
  });

  describe("rankAndScoreCandidates", () => {
    it("should sort candidates by score descending", () => {
      const candidates: Array<Omit<QuestionCandidate, "score">> = [
        {
          id: "1",
          question: "Multiple interpretations?",
          question_type: "open_ended",
          ambiguity_type: "multiple_interpretations",
          targets_ambiguity: "Interpretation",
        },
        {
          id: "2",
          question: "Missing node?",
          question_type: "open_ended",
          ambiguity_type: "missing_node",
          targets_ambiguity: "Missing",
        },
        {
          id: "3",
          question: "Uncertain edge?",
          question_type: "multiple_choice",
          ambiguity_type: "uncertain_edge",
          targets_ambiguity: "Edge",
          options: ["A", "B"],
        },
      ];

      const ranked = rankAndScoreCandidates(candidates, []);

      // Should be sorted by score (missing_node should be first)
      expect(ranked[0].ambiguity_type).toBe("missing_node");
      expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
      expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score);
    });
  });

  describe("selectBestQuestion", () => {
    it("should return null for empty candidates", () => {
      const result = selectBestQuestion([], []);
      expect(result).toBeNull();
    });

    it("should select highest scoring question", () => {
      const candidates: QuestionCandidate[] = [
        {
          id: "1",
          question: "Low score?",
          question_type: "open_ended",
          ambiguity_type: "multiple_interpretations",
          targets_ambiguity: "Low",
          score: 0.3,
        },
        {
          id: "2",
          question: "High score?",
          question_type: "open_ended",
          ambiguity_type: "missing_node",
          targets_ambiguity: "High",
          score: 0.9,
        },
      ];

      const result = selectBestQuestion(candidates, []);

      expect(result).not.toBeNull();
      expect(result!.id).toBe("2");
      expect(result!.score).toBe(0.9);
    });

    it("should filter out very low scoring questions", () => {
      const candidates: QuestionCandidate[] = [
        {
          id: "1",
          question: "Too low?",
          question_type: "open_ended",
          ambiguity_type: "multiple_interpretations",
          targets_ambiguity: "Low",
          score: 0.05, // Below threshold
        },
      ];

      const result = selectBestQuestion(candidates, []);

      expect(result).toBeNull();
    });

    it("should prefer new questions over already-asked ones (via scoring)", () => {
      // When scoreQuestionCandidate detects same question text, it sets score to 0
      // So the second candidate (with different text) should be selected
      const candidates: QuestionCandidate[] = [
        {
          id: "1",
          question: "Already asked?",
          question_type: "open_ended",
          ambiguity_type: "missing_node",
          targets_ambiguity: "Asked",
          score: 0, // Already asked question would have 0 score
        },
        {
          id: "2",
          question: "New question?",
          question_type: "open_ended",
          ambiguity_type: "uncertain_edge",
          targets_ambiguity: "New",
          score: 0.6,
        },
      ];

      const result = selectBestQuestion(candidates, []);

      expect(result).not.toBeNull();
      expect(result!.id).toBe("2");
    });
  });
});
