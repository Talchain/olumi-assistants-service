/**
 * Edge-Stability phase 2 — live PLoT /v2/run pass → act-vs-status-quo structural flip-rate.
 *
 *   PLOT_AUTH_TOKEN=… npx tsx src/run-plot.ts --req-dir ./v2-requests/es-v0 --label es-v0 [--limit 1]
 *
 * Posts each pinned-seed V2 request to PLoT staging, asserts seed_used echoes the pinned
 * seed (regime + reproducibility check), reads the recommended option (argmax
 * option_comparison.win_probability, lexicographic tie-break — mirrors PLoT
 * deriveRecommendedOption), and computes per-brief flip-rate across the draws.
 *
 * METRIC NAME (mandated): "act-vs-status-quo structural flip-rate under draft churn" — NOT
 * bare "flip-rate"/"outcome stability". Buy≡build ceiling stated in the report: a graph-
 * derived synthesis cannot separate same-direction options, so this measures whether the
 * drafted graph flips WHETHER acting beats the status quo, not WHICH action wins.
 *
 * Never prints the auth token. Token + base URL from env (PLOT_AUTH_TOKEN, PLOT_BASE_URL).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.PLOT_BASE_URL || "https://plot-lite-service-staging.onrender.com").replace(/\/$/, "");
const TOKEN = process.env.PLOT_AUTH_TOKEN;

interface CallResult {
  brief: string; seed: number; http: number; analysis_status?: string; seed_used?: string;
  recommended?: string; recLabel?: string; recNorm?: string; recIsSQ?: boolean; regime_ok: boolean; error?: string;
}

const norm = (s: string): string => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).join(" ");
// Status-Quo classification for the mandated act-vs-status-quo metric (semantic, ID-churn-proof).
const isStatusQuo = (label: string): boolean => /(status quo|do nothing|no change|stay|keep|continue as)/.test(norm(label));

function recommended(resp: any): string | undefined {
  const oc = resp?.option_comparison;
  if (!Array.isArray(oc) || oc.length === 0) return undefined;
  const valid = oc.filter((o: any) => Number.isFinite(o?.win_probability));
  if (valid.length === 0) return undefined;
  const max = Math.max(...valid.map((o: any) => o.win_probability));
  const top = valid.filter((o: any) => Math.abs(o.win_probability - max) < 1e-9)
    .sort((a: any, b: any) => String(a.option_id).localeCompare(String(b.option_id)));
  return top[0]?.option_id;
}

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

async function callPlotOnce(reqBody: unknown, pinnedSeed: string): Promise<Partial<CallResult>> {
  try {
    const r = await fetch(`${BASE}/v2/run`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(reqBody),
    });
    const text = await r.text();
    let resp: any = {};
    try { resp = JSON.parse(text); } catch { /* keep {} */ }
    const seedUsed = resp?.seed_used ?? resp?.meta?.seed_used ?? resp?._meta?.seed_used;
    return {
      http: r.status,
      analysis_status: resp?.analysis_status,
      seed_used: seedUsed !== undefined ? String(seedUsed) : undefined,
      recommended: recommended(resp),
      regime_ok: seedUsed !== undefined ? String(seedUsed) === pinnedSeed : false,
      error: r.ok ? (resp?.analysis_status === "failed" ? (resp?.status_reason || "failed") : undefined) : (resp?.status_reason || text.slice(0, 160)),
    };
  } catch (e) {
    return { http: 0, regime_ok: false, error: (e as Error).message };
  }
}

/** Retry transient staging failures (cold ISL → analysis_status=failed / 5xx). Seed is pinned,
 *  so a computed result is reproducible; only genuine transients are retried. */
async function callPlot(reqBody: unknown, pinnedSeed: string): Promise<Partial<CallResult>> {
  let last: Partial<CallResult> = {};
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await callPlotOnce(reqBody, pinnedSeed);
    if (last.analysis_status === "computed") return last;
    if (attempt < 3) await sleep(2500 * attempt);
  }
  return last;
}

async function main(): Promise<void> {
  if (!TOKEN) throw new Error("PLOT_AUTH_TOKEN not set in env");
  const { values } = parseArgs({ options: {
    "req-dir": { type: "string" }, label: { type: "string" }, limit: { type: "string" }, seed: { type: "string" }, "out-dir": { type: "string" },
  } });
  const reqDir = resolve(process.cwd(), (values["req-dir"] as string) ?? "");
  const label = (values.label as string) ?? "es-run";
  const pinnedSeed = (values.seed as string) ?? "424242";
  const limit = values.limit ? Number(values.limit) : Infinity;
  const outDir = resolve(process.cwd(), (values["out-dir"] as string) ?? join(HERE, "../reports"));
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(reqDir).filter((f) => f.endsWith(".json")).sort();
  const results: CallResult[] = [];
  let n = 0;
  for (const f of files) {
    if (n >= limit) break;
    n++;
    const m = f.match(/^(.*)_s(\d+)\.json$/);
    const brief = m?.[1] ?? f; const seed = m ? Number(m[2]) : 0;
    const body = JSON.parse(readFileSync(join(reqDir, f), "utf-8"));
    const r = await callPlot(body, pinnedSeed);
    // Map recommended option id -> label (from the request) -> semantic identity, so ID churn
    // across draws (opt_x vs option_x) does not inflate the flip-rate.
    const recLabel = r.recommended ? (body.options?.find((o: any) => o.id === r.recommended)?.label ?? r.recommended) : undefined;
    const recNorm = recLabel ? norm(recLabel) : undefined;
    const recIsSQ = recLabel ? isStatusQuo(recLabel) : undefined;
    results.push({ brief, seed, http: r.http ?? 0, regime_ok: r.regime_ok ?? false, ...r, recLabel, recNorm, recIsSQ } as CallResult);
    console.log(`  ${brief} s${seed}: HTTP ${r.http} ${r.analysis_status ?? "-"} echo:${r.regime_ok} rec=${recNorm ?? "-"}${recIsSQ === true ? "[SQ]" : recIsSQ === false ? "[act]" : ""}${r.error ? " ERR:" + r.error : ""}`);
  }

  // Per-brief flip-rate over successful calls
  const byBrief = new Map<string, CallResult[]>();
  for (const r of results) (byBrief.get(r.brief) ?? byBrief.set(r.brief, []).get(r.brief)!).push(r);
  const flipOf = (xs: string[]): number | null => {
    if (xs.length < 2) return null;
    const c = new Map<string, number>();
    for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
    return 1 - Math.max(...c.values()) / xs.length;
  };
  const briefFlip = [...byBrief.entries()].map(([brief, rs]) => {
    const decided = rs.filter((r) => r.recNorm);
    const semantic = decided.map((r) => r.recNorm!);                       // which-option (label-normalised, ID-churn-proof)
    const actSq = decided.map((r) => (r.recIsSQ ? "status-quo" : "act"));  // mandated act-vs-status-quo binary
    const failed = rs.filter((r) => r.analysis_status !== "computed").length;
    const actFlip = flipOf(actSq);
    return {
      brief, draws: rs.length, decided: decided.length, failedOrUndecided: failed,
      distinctOptions: new Set(semantic).size,
      semanticFlipRate: flipOf(semantic), actVsStatusQuoFlipRate: actFlip,
      flagged: (actFlip ?? 0) > 0.2, recs: semantic,
    };
  });

  const artifact = { label, base: BASE, pinnedSeed, metric: "act-vs-status-quo structural flip-rate under draft churn", ceiling: "graph-derived synthesis cannot separate same-direction options (buy==build); measures whether the drafted graph flips WHETHER acting beats status quo, not WHICH action wins", results, briefFlip };
  writeFileSync(join(outDir, `${label}-plot.json`), JSON.stringify(artifact, null, 2));
  const pct = (x: number | null): string => (x === null ? "n/a" : Math.round(x * 100) + "%");
  console.log(`\n=== act-vs-status-quo structural flip-rate under draft churn (${label}) — semantic option identity ===`);
  for (const b of briefFlip) console.log(`  ${b.brief}: ${b.decided}/${b.draws} decided (${b.failedOrUndecided} failed/undecided), ${b.distinctOptions} distinct option(s) | act-vs-SQ flip ${pct(b.actVsStatusQuoFlipRate)}${b.flagged ? " ⚠>20%" : ""} | which-option flip ${pct(b.semanticFlipRate)}`);
  const computed = results.filter((r) => r.analysis_status === "computed");
  const seedEchoComputed = computed.length > 0 && computed.every((r) => r.regime_ok);
  console.log(`seed_used echoes pinned seed on all ${computed.length} COMPUTED calls: ${seedEchoComputed} (${results.length - computed.length} failed/degraded, no seed_used)`);
  console.log(`artifact: ${join(outDir, `${label}-plot.json`)}`);
}

main().catch((err) => { console.error(`run-plot failed: ${(err as Error).message}`); process.exit(1); });
