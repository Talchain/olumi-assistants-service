/**
 * Pin the exact user-facing strings for NODE_LIMIT_EXCEEDED and
 * EDGE_LIMIT_EXCEEDED.
 *
 * ORIGINAL RULE (Fix 2A, kept): the copy must not leak the internal
 * `${MAX_NODES}-node limit` / `${MAX_EDGES}-edge limit` phrasing or the
 * constant names — the user flagged those as internal jargon.
 *
 * ADDED 2026-08-18, and it pulls against the original in one respect, so it is
 * written down rather than left implicit. Fix 2A removed the NUMBER along with
 * the jargon, which left a user refused for size with no idea what size was
 * allowed — and the `detail` string that did carry it
 * (`"21 nodes exceeds limit of 20"`) is dropped by `structuralIssue()` in
 * `analysis-ready-helper.ts` and never reaches the wire. So the number is back,
 * in plain language, DERIVED from `graphCaps` rather than typed in here: a
 * literal would be the hand-maintained mirror that produced the 20/30-vs-50/100
 * split in the first place.
 *
 * The EDGE message also no longer claims the model is "too complex to analyse
 * reliably". That was a compute claim nothing in the codebase supported and
 * measurement refutes — at the 50/100 ceiling a full analysis costs 63.1% of
 * ISL's 24,000,000-unit budget, and a typical refused draft (24 nodes /
 * 46 edges) costs 24.6%.
 */

import { describe, it, expect } from "vitest";
import { VIOLATION_MESSAGES } from "../../../src/orchestrator/graph-structure-validator.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../../../src/config/graphCaps.js";

describe('VIOLATION_MESSAGES — user-facing language (Fix 2A)', () => {
  it('NODE_LIMIT_EXCEEDED uses plain user-facing language with no jargon', () => {
    expect(VIOLATION_MESSAGES.NODE_LIMIT_EXCEEDED).toBe(
      `Olumi can analyse models of up to ${GRAPH_MAX_NODES} nodes. This one goes past that — remove a node to make room.`,
    );
    expect(VIOLATION_MESSAGES.NODE_LIMIT_EXCEEDED).not.toMatch(/\d+-node limit/);
    expect(VIOLATION_MESSAGES.NODE_LIMIT_EXCEEDED).not.toContain('MAX_NODES');
  });

  it('EDGE_LIMIT_EXCEEDED uses plain user-facing language with no jargon', () => {
    expect(VIOLATION_MESSAGES.EDGE_LIMIT_EXCEEDED).toBe(
      `Olumi can analyse models of up to ${GRAPH_MAX_EDGES} connections. This one goes past that — remove a connection to make room.`,
    );
    expect(VIOLATION_MESSAGES.EDGE_LIMIT_EXCEEDED).not.toMatch(/\d+-edge limit/);
    expect(VIOLATION_MESSAGES.EDGE_LIMIT_EXCEEDED).not.toContain('MAX_EDGES');
  });

  it('neither limit message asserts a reliability claim about analysis', () => {
    for (const message of [
      VIOLATION_MESSAGES.NODE_LIMIT_EXCEEDED,
      VIOLATION_MESSAGES.EDGE_LIMIT_EXCEEDED,
    ]) {
      expect(message).not.toContain('too complex');
      expect(message).not.toContain('reliably');
    }
  });

  it('both limit messages state the size a refused user has to work to', () => {
    expect(VIOLATION_MESSAGES.NODE_LIMIT_EXCEEDED).toContain(String(GRAPH_MAX_NODES));
    expect(VIOLATION_MESSAGES.EDGE_LIMIT_EXCEEDED).toContain(String(GRAPH_MAX_EDGES));
  });
});
