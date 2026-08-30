/**
 * Capture-time redaction for the continuity harness.
 *
 * WHY THIS IS A MODULE AND NOT THREE LINES INLINE
 * -----------------------------------------------
 * The harness writes every wire capture to disk. A capture that carries a live
 * bearer token is a credential leak with a long tail — it survives in evidence
 * directories, in pasted excerpts, and in whatever a later session greps.
 *
 * The redaction therefore runs at CAPTURE time, never at print time: by the
 * point a value reaches a reporter it must already be unrecoverable.
 *
 * THE CONTROL IS THE LOAD-BEARING PART. A redactor that silently stops matching
 * is indistinguishable from a payload that never contained a secret — both
 * produce clean output. This estate has shipped exactly that defect (CLAUDE.md
 * trap 13: an absence assertion that has never proven it can see a presence).
 * `proveRedactorFires()` therefore runs a POSITIVE control (a JWT-shaped string
 * MUST be destroyed) and a CONTRAST control (an ordinary string that merely
 * looks tokenish MUST survive) before the first capture is taken. Absence is
 * only evidence when the same instrument demonstrates it can produce a
 * presence — and the contrast half is what distinguishes "the redactor is
 * discriminating" from "the redactor eats everything", which would be just as
 * broken and far easier to miss.
 */

import { createHash } from 'node:crypto';

/**
 * JWT shape: three base64url segments separated by dots, leading segment
 * beginning with the `eyJ` that base64url-encoded `{"` always produces.
 * Deliberately shape-based rather than context-based — a token is a token
 * wherever it appears, including inside a nested error string that no
 * field-name allowlist would have covered.
 */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;

/** Bearer prefixes, whose value may or may not itself be JWT-shaped. */
const BEARER_PATTERN = /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{16,})/gi;

/** Supabase / Olumi service key shapes seen on this estate's headers. */
const SERVICE_KEY_PATTERN = /\b(sb[ps]-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,})\b/g;

/** Report a secret as a SHA-256 prefix. NEVER the value itself. */
export function fingerprint(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 12);
}

/**
 * Redact every secret-shaped substring in an arbitrary structure.
 * Returns { value, hits } where `hits` lists the fingerprints only.
 */
export function redact(input) {
  const hits = [];

  const scrubString = (s) => {
    let out = s;
    out = out.replace(JWT_PATTERN, (m) => {
      hits.push({ kind: 'jwt', sha256_prefix: fingerprint(m), length: m.length });
      return `[REDACTED:jwt:${fingerprint(m)}]`;
    });
    out = out.replace(BEARER_PATTERN, (m, scheme, val) => {
      hits.push({ kind: 'bearer', sha256_prefix: fingerprint(val), length: val.length });
      return `${scheme} [REDACTED:bearer:${fingerprint(val)}]`;
    });
    out = out.replace(SERVICE_KEY_PATTERN, (m) => {
      hits.push({ kind: 'service_key', sha256_prefix: fingerprint(m), length: m.length });
      return `[REDACTED:key:${fingerprint(m)}]`;
    });
    return out;
  };

  const walk = (v) => {
    if (typeof v === 'string') return scrubString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) o[k] = walk(val);
      return o;
    }
    return v;
  };

  return { value: walk(input), hits };
}

/**
 * Prove the redactor fires BEFORE any real capture is taken.
 *
 * Returns a structured result rather than throwing, so the runner can report
 * an instrument failure as COULD_NOT_MEASURE (exit 2) rather than as a case
 * failure (exit 1). An instrument that cannot be trusted has not produced a
 * negative result; it has produced no result at all.
 */
export function proveRedactorFires() {
  const checks = [];

  // ---- POSITIVE CONTROL: a JWT-shaped string MUST be destroyed. ----------
  // Structurally valid, semantically inert: header {"alg":"HS256"}, payload
  // {"sub":"redactor-positive-control"}, signature is literal filler. It is
  // not a credential for anything and never was.
  const syntheticJwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
    '.eyJzdWIiOiJyZWRhY3Rvci1wb3NpdGl2ZS1jb250cm9sIn0' +
    '.c2lnbmF0dXJlLXBsYWNlaG9sZGVyLW5vdC1hLWtleQ';

  const pos = redact({ nested: { authorization: `Bearer ${syntheticJwt}` }, note: syntheticJwt });
  const posSerialised = JSON.stringify(pos.value);
  const positiveFired = !posSerialised.includes(syntheticJwt) && pos.hits.length > 0;
  checks.push({
    control: 'positive',
    expectation: 'a JWT-shaped string is destroyed and fingerprinted',
    ok: positiveFired,
    detail: positiveFired
      ? `redacted; ${pos.hits.length} hit(s), first sha256=${pos.hits[0].sha256_prefix}`
      : 'REDACTOR DID NOT FIRE — the token survived capture',
  });

  // ---- CONTRAST CONTROL: an ordinary string MUST survive. ----------------
  // Without this half, a redactor that returned "[REDACTED]" for every input
  // would score a perfect positive control while destroying all evidence.
  // The contrast is what proves the instrument DISCRIMINATES rather than
  // merely reacts. A probe that answers the same way for every input is
  // reporting on itself (CLAUDE.md trap 20).
  const benign = 'Partial Increase on Monthly seat price — confirm the effect value (e.g. 20%)';
  const neg = redact({ assistant_text: benign });
  const contrastHeld = neg.value.assistant_text === benign && neg.hits.length === 0;
  checks.push({
    control: 'contrast',
    expectation: 'ordinary assistant prose is untouched and reports zero hits',
    ok: contrastHeld,
    detail: contrastHeld
      ? 'benign text survived verbatim, 0 hits'
      : `REDACTOR OVER-MATCHED — benign text was altered (${neg.hits.length} hit(s))`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}
