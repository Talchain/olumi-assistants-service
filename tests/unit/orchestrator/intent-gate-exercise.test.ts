/**
 * Intent Gate — run_exercise Pattern Tests
 *
 * Verifies:
 * 1. All 15 exercise patterns route to run_exercise with the correct ExerciseType
 * 2. No collision between exercise patterns and non-exercise patterns
 * 3. No duplicate patterns in the full table (including exercise patterns)
 */

import { describe, it, expect } from "vitest";
import {
  classifyIntent,
  INTENT_PATTERN_ENTRIES,
  PATTERN_TO_EXERCISE,
} from "../../../src/orchestrator/intent-gate.js";
import type { ExerciseType } from "../../../src/orchestrator/intent-gate.js";

// ============================================================================
// Pattern coverage test
// ============================================================================

describe("run_exercise intent patterns", () => {
  // pre_mortem patterns
  describe("pre_mortem patterns", () => {
    it.each([
      "pre-mortem",
      "pre mortem",
      "premortem",
      "what could go wrong",
      "imagine this failed",
    ])("routes %j to run_exercise with exercise: pre_mortem", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBe("run_exercise");
      expect(result.routing).toBe("deterministic");
      expect(result.exercise).toBe("pre_mortem");
    });
  });

  // devil_advocate patterns
  describe("devil_advocate patterns", () => {
    it.each([
      "devil's advocate",
      "devils advocate",
      "play devil's advocate",
      "argue against this recommendation",
      "argue the other side",
    ])("routes %j to run_exercise with exercise: devil_advocate", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBe("run_exercise");
      expect(result.routing).toBe("deterministic");
      expect(result.exercise).toBe("devil_advocate");
    });
  });

  // disconfirmation patterns
  describe("disconfirmation patterns", () => {
    it.each([
      "disconfirmation",
      "what would change this",
      "what evidence would change this",
      "what would flip this",
      "prove me wrong",
    ])("routes %j to run_exercise with exercise: disconfirmation", (message) => {
      const result = classifyIntent(message);
      expect(result.tool).toBe("run_exercise");
      expect(result.routing).toBe("deterministic");
      expect(result.exercise).toBe("disconfirmation");
    });
  });

  // Normalisation: trailing punctuation stripped
  it("normalises trailing punctuation before matching", () => {
    const result = classifyIntent("pre-mortem!");
    expect(result.tool).toBe("run_exercise");
    expect(result.exercise).toBe("pre_mortem");
  });

  // Case insensitivity
  it("matches case-insensitively", () => {
    const result = classifyIntent("Pre-Mortem");
    expect(result.tool).toBe("run_exercise");
    expect(result.exercise).toBe("pre_mortem");
  });
});

// ============================================================================
// PATTERN_TO_EXERCISE coverage
// ============================================================================

describe("PATTERN_TO_EXERCISE", () => {
  it("covers all 15 exercise patterns", () => {
    expect(PATTERN_TO_EXERCISE.size).toBe(15);
  });

  it("maps every key to a valid ExerciseType", () => {
    const validTypes: ExerciseType[] = ['pre_mortem', 'devil_advocate', 'disconfirmation'];
    for (const [pattern, exerciseType] of PATTERN_TO_EXERCISE) {
      expect(validTypes).toContain(exerciseType);
      // Verify the pattern exists in the main intent map
      const result = classifyIntent(pattern);
      expect(result.tool, `Pattern "${pattern}" should route to run_exercise`).toBe('run_exercise');
    }
  });
});

// ============================================================================
// Collision test
// ============================================================================

describe("Exercise pattern collision", () => {
  it("no exercise pattern collides with a non-exercise tool", () => {
    const exercisePatterns = new Set<string>(
      [...PATTERN_TO_EXERCISE.keys()],
    );

    const nonExerciseEntries = INTENT_PATTERN_ENTRIES.filter(([, tool]) => tool !== 'run_exercise');
    const nonExercisePatterns = new Set(nonExerciseEntries.map(([pattern]) => pattern));

    const collisions: string[] = [];
    for (const pattern of exercisePatterns) {
      if (nonExercisePatterns.has(pattern)) {
        collisions.push(pattern);
      }
    }

    expect(collisions).toEqual([]);
  });

  it("no duplicate patterns anywhere in the full table", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const [pattern] of INTENT_PATTERN_ENTRIES) {
      if (seen.has(pattern)) {
        duplicates.push(pattern);
      }
      seen.add(pattern);
    }
    expect(duplicates).toEqual([]);
  });
});
