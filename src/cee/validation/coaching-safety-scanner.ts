/**
 * Coaching output-safety scanner (v0.11.0 schema amendment).
 *
 * Flags raw node-ID prefixes leaking into user-facing coaching prose.
 * Severity: warning telemetry on detection — never reject.
 *
 * Scanned fields (all user-facing prose):
 *  - coaching.summary
 *  - coaching.strengthen_items[*].label
 *  - coaching.strengthen_items[*].detail
 *  - coaching.widening_log.elements_considered_but_excluded[*]
 *  - coaching.bias_signals[*].detail
 *
 * NOT scanned:
 *  - coaching.widening_log.elements_added[*] — by contract these ARE
 *    structural node IDs; flagging them would be a false positive.
 *  - coaching.strengthen_items[*].id — internal identifiers.
 */

export interface CoachingSafetyHit {
  /** Path to the offending field, e.g. "coaching.strengthen_items[2].label". */
  path: string;
  /** The matched ID-like substring. */
  match: string;
  /** Snippet of surrounding text (≤100 chars). */
  snippet: string;
}

const NODE_ID_PREFIXES = [
  "fac_",
  "opt_",
  "out_",
  "risk_",
  "goal_",
  "dec_",
  "node_",
];

// Match any of the prefixes followed by ≥1 word character.
// Case-insensitive to be safe; production prompts emit lowercase.
const NODE_ID_PATTERN = new RegExp(
  `\\b(?:${NODE_ID_PREFIXES.join("|")})\\w+\\b`,
  "gi",
);

function* scanField(
  path: string,
  value: unknown,
): Generator<CoachingSafetyHit> {
  if (typeof value !== "string" || value.length === 0) return;
  for (const m of value.matchAll(NODE_ID_PATTERN)) {
    const idx = m.index ?? 0;
    const start = Math.max(0, idx - 30);
    const end = Math.min(value.length, idx + m[0].length + 30);
    yield {
      path,
      match: m[0],
      snippet: value.slice(start, end),
    };
  }
}

/**
 * Scan a coaching object for raw node-ID leakage in user-facing prose.
 * Returns an empty array when the input is shape-invalid (be permissive).
 */
export function scanCoachingForIdLeakage(coaching: unknown): CoachingSafetyHit[] {
  const hits: CoachingSafetyHit[] = [];
  if (!coaching || typeof coaching !== "object") return hits;
  const c = coaching as Record<string, unknown>;

  // coaching.summary
  for (const hit of scanField("coaching.summary", c.summary)) {
    hits.push(hit);
  }

  // coaching.strengthen_items[*].label and .detail
  if (Array.isArray(c.strengthen_items)) {
    c.strengthen_items.forEach((raw, i) => {
      if (!raw || typeof raw !== "object") return;
      const item = raw as Record<string, unknown>;
      for (const hit of scanField(
        `coaching.strengthen_items[${i}].label`,
        item.label,
      )) {
        hits.push(hit);
      }
      for (const hit of scanField(
        `coaching.strengthen_items[${i}].detail`,
        item.detail,
      )) {
        hits.push(hit);
      }
    });
  }

  // coaching.widening_log.elements_considered_but_excluded[*]
  // (NOT elements_added — those are structural node IDs by contract.)
  const wl = c.widening_log;
  if (wl && typeof wl === "object") {
    const excluded = (wl as Record<string, unknown>).elements_considered_but_excluded;
    if (Array.isArray(excluded)) {
      excluded.forEach((entry, i) => {
        for (const hit of scanField(
          `coaching.widening_log.elements_considered_but_excluded[${i}]`,
          entry,
        )) {
          hits.push(hit);
        }
      });
    }
  }

  // coaching.bias_signals[*].detail
  if (Array.isArray(c.bias_signals)) {
    c.bias_signals.forEach((raw, i) => {
      if (!raw || typeof raw !== "object") return;
      const sig = raw as Record<string, unknown>;
      for (const hit of scanField(
        `coaching.bias_signals[${i}].detail`,
        sig.detail,
      )) {
        hits.push(hit);
      }
    });
  }

  return hits;
}

export const COACHING_SAFETY_SCANNED_FIELDS = [
  "coaching.summary",
  "coaching.strengthen_items[*].label",
  "coaching.strengthen_items[*].detail",
  "coaching.widening_log.elements_considered_but_excluded[*]",
  "coaching.bias_signals[*].detail",
] as const;
