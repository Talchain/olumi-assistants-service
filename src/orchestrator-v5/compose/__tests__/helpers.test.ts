import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  safeLabel,
  sanitiseForUser,
  describeSchema,
  curatedHandlerChips,
  USER_FACING_HANDLERS,
} from '../helpers.js';
import type { HandlerValidationRegistry } from '../../routing/validator.js';

describe('safeLabel', () => {
  it('returns the trimmed label when present', () => {
    expect(safeLabel({ label: '  Churn Risk  ', kind: 'factor' })).toBe('Churn Risk');
  });

  it('falls back to "that {kind}" when label is missing', () => {
    expect(safeLabel({ kind: 'factor' })).toBe('that factor');
  });

  it('falls back to "that {kind}" when label is empty string', () => {
    expect(safeLabel({ label: '', kind: 'option' })).toBe('that option');
  });

  it('falls back to "that item" when both label and kind are missing', () => {
    expect(safeLabel({})).toBe('that item');
  });

  it('handles null and undefined inputs', () => {
    expect(safeLabel(null)).toBe('that item');
    expect(safeLabel(undefined)).toBe('that item');
  });

  it('never returns a raw ID-like string when only a label is provided', () => {
    const result = safeLabel({ label: 'Ok label' });
    expect(result).not.toMatch(/^(fac|opt|node|edge)_/);
  });

  it('caps output at 60 chars with ASCII "..." marker (defence-in-depth)', () => {
    const longLabel = 'A'.repeat(200);
    const out = safeLabel({ label: longLabel });
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('...')).toBe(true);
  });

  it('leaves 60-char labels untruncated', () => {
    const exact = 'A'.repeat(60);
    expect(safeLabel({ label: exact })).toBe(exact);
  });

  it('rejects id-shaped prefixed labels (e.g. opt_a, fac_churn_x7)', () => {
    expect(safeLabel({ label: 'opt_a', kind: 'option' })).toBe('that option');
    expect(safeLabel({ label: 'fac_churn_x7', kind: 'node' })).toBe('that node');
    expect(safeLabel({ label: 'goal_main', kind: 'goal' })).toBe('that goal');
  });

  it('rejects UUID-shaped labels', () => {
    const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(safeLabel({ label: uuid, kind: 'option' })).toBe('that option');
  });

  it('accepts real labels that merely contain an underscore but are not prefix_alphanum-shaped', () => {
    expect(safeLabel({ label: 'Plan A — growth bet' })).toBe('Plan A — growth bet');
    expect(safeLabel({ label: 'Low-risk plan' })).toBe('Low-risk plan');
  });

  it('does not reject Title_Case user labels containing underscores (lowercase-only id regex)', () => {
    // Previously the id-shape regex used `/i` which false-positived
    // Title_Case underscored labels. The tightened lowercase-only pattern
    // leaves these as valid user labels.
    expect(safeLabel({ label: 'Plan_A' })).toBe('Plan_A');
    expect(safeLabel({ label: 'Draft_v1' })).toBe('Draft_v1');
    expect(safeLabel({ label: 'My_Label' })).toBe('My_Label');
  });

  it('treats null label as missing', () => {
    expect(safeLabel({ label: null, kind: 'option' })).toBe('that option');
  });
});

describe('sanitiseForUser', () => {
  it('returns "unknown" for null and undefined', () => {
    expect(sanitiseForUser(null)).toBe('unknown');
    expect(sanitiseForUser(undefined)).toBe('unknown');
  });

  it('passes through short plain strings', () => {
    expect(sanitiseForUser('must be positive')).toBe('must be positive');
  });

  it('truncates long strings with ASCII "..." marker', () => {
    const long = 'x'.repeat(250);
    const out = sanitiseForUser(long);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('...')).toBe(true);
  });

  it('strips stack-trace-like fragments', () => {
    const raw = 'something failed at /app/src/foo.ts:123:45 in handler';
    const out = sanitiseForUser(raw);
    expect(out).not.toMatch(/at\s+\/app/);
  });

  it('converts arrays to comma-joined sanitised elements', () => {
    expect(sanitiseForUser(['a', 'b', 'c'])).toBe('a, b, c');
  });

  it('caps the joined output of large arrays at 100 chars', () => {
    const big = Array.from({ length: 50 }, (_, i) => `item${i}`);
    const out = sanitiseForUser(big);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('...')).toBe(true);
  });

  it('converts plain objects to "[complex value]"', () => {
    expect(sanitiseForUser({ nested: 'thing' })).toBe('[complex value]');
  });

  it('passes through numbers and booleans', () => {
    expect(sanitiseForUser(42)).toBe('42');
    expect(sanitiseForUser(true)).toBe('true');
  });
});

describe('describeSchema', () => {
  it('returns the explicit description when provided', () => {
    const schema = z.number().describe('a probability between 0 and 1');
    expect(describeSchema(schema)).toBe('a probability between 0 and 1');
  });

  it('matches z.number().min(0).max(1) → "a number between 0 and 1"', () => {
    expect(describeSchema(z.number().min(0).max(1))).toBe('a number between 0 and 1');
  });

  it('matches z.number().min(0) → "a positive number"', () => {
    expect(describeSchema(z.number().min(0))).toBe('a positive number');
  });

  it('matches z.string() → "text"', () => {
    expect(describeSchema(z.string())).toBe('text');
  });

  it('falls back to "a valid value" for unrecognised shapes', () => {
    expect(describeSchema(z.object({ a: z.string() }))).toBe('a valid value');
  });
});

describe('curatedHandlerChips', () => {
  it('excludes handlers not in USER_FACING_HANDLERS even when registered', () => {
    const registry: HandlerValidationRegistry = {
      run_analysis: {
        handler_id: 'run_analysis',
        accepted_entity_kinds: [],
        confirmation_template: 'ok',
      },
      secret_internal_tool: {
        handler_id: 'secret_internal_tool',
        accepted_entity_kinds: [],
        confirmation_template: 'nope',
      },
    };
    const chips = curatedHandlerChips(registry);
    const ids = chips.map((c) => c.handler_id);
    expect(ids).toContain('run_analysis');
    expect(ids).not.toContain('secret_internal_tool');
  });

  it('excludes handlers not registered even when in USER_FACING_HANDLERS', () => {
    const emptyRegistry: HandlerValidationRegistry = {};
    expect(curatedHandlerChips(emptyRegistry)).toEqual([]);
  });

  it('USER_FACING_HANDLERS lists run_analysis', () => {
    expect(USER_FACING_HANDLERS).toContain('run_analysis');
  });

  it('USER_FACING_HANDLERS excludes actions that would return FEATURE_NOT_ENABLED', () => {
    // These handlers either don't exist or return FEATURE_NOT_ENABLED on the V5 path.
    // They must never appear in the allowlist so they cannot be emitted as chips.
    const notFunctional = [
      'explain_result',
      'compare_options',
      'what_would_flip',
      'challenge_assumption',
      'run_premortem',
    ];
    for (const action of notFunctional) {
      expect(USER_FACING_HANDLERS).not.toContain(action);
    }
  });
});
