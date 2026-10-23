/**
 * Seeded, pure random streams for the simulator. One stream per KEY (an uncertain quantity's id, or a risk's id), derived
 * from (seed, key) alone, so a quantity's draws never depend on which other quantities exist, on their order, or on the
 * option being evaluated: the common random numbers every option shares.
 *
 * xoshiro128** (Blackman & Vigna) seeded through splitmix32 from an FNV-1a hash of the key. 32-bit integer arithmetic only,
 * so the same seed gives the same draws on every platform.
 */

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/** A stream of 32-bit unsigned integers for (seed, key). */
function xoshiro128ss(seed: number, key: string): () => number {
  const init = splitmix32(fnv1a(`${seed}\u0000${key}`));
  let a = init(), b = init(), c = init(), d = init();
  if ((a | b | c | d) === 0) a = 1;
  return () => {
    const r = Math.imul(rotl(Math.imul(b, 5), 7), 9);
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return r >>> 0;
  };
}

const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k));
const TWO_32 = 4294967296;

/** `n` uniforms strictly inside (0, 1) for (seed, key). */
export function uniforms(seed: number, key: string, n: number): Float64Array {
  const next = xoshiro128ss(seed, key);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (next() + 0.5) / TWO_32;
  return out;
}

/** `n` standard normals for (seed, key): Box–Muller, two uniforms per draw, so draw i depends only on (seed, key, i). */
export function standardNormals(seed: number, key: string, n: number): Float64Array {
  const next = xoshiro128ss(seed, key);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u1 = (next() + 0.5) / TWO_32;
    const u2 = (next() + 0.5) / TWO_32;
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return out;
}
