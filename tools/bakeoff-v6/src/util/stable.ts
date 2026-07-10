import { createHash } from "node:crypto";

/**
 * Deterministic JSON serialization: object keys sorted at every depth.
 * Arrays keep their order (order is semantic for proposals, seeds, etc.).
 */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeysDeep(value), null, indent);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    // Object.create(null): a parsed candidate with an own "__proto__" key would, on a plain {},
    // hit the prototype setter (dropping the key + mutating the prototype) and silently corrupt the
    // canonical hash. A null-prototype accumulator makes "__proto__" a normal own key.
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * mulberry32 — small deterministic PRNG. Used for blind-ID shuffles and any
 * sampling decision in the harness so the same seed reproduces the same run.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle (returns a new array). */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Deterministic seed sequence derived from a run seed. */
export function seedSequence(runSeed: number, count: number): number[] {
  const rng = mulberry32(runSeed);
  return Array.from({ length: count }, () => Math.floor(rng() * 1_000_000));
}
