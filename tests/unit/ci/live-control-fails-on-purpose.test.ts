/**
 * DO NOT MERGE: live false-green control A for #1850 (throwaway head).
 *
 * One deliberately failing test. Whichever required-tests shard collects it
 * must go red, and the required context `Lint, TypeCheck, Unit Tests` must go
 * red with it (needs.required-tests.result = failure). No provider call.
 */
import { describe, expect, it } from "vitest";

describe("live control A: a failing test in one shard fails the required context", () => {
  it("fails on purpose", () => {
    expect(1).toBe(2);
  });
});
