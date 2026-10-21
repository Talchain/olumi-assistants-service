#!/bin/zsh
# Track 2 (21 Oct 2026): re-record the two PLoT responses behind `track2-from-zero-means.test.ts`, and check them against the
# committed fixtures. Offline: no provider or staging calls.
#   CEE  this checkout. Its spec writes each Run's PLoT request (F1_OUT).
#   PLoT a checkout at PLOT_SHA. `plot-record.test.ts.tmpl` is copied in as tests/track2-record.test.ts, never committed.
#   ISL  a checkout at ISL_SHA, with .venv holding ISL's deps, served locally by `run-chain.sh`.
# Usage: TRACK2_ROOT=<dir with isl/> F1_PLOT=<PLoT checkout> scripts/track2/record-from-zero.sh [--write]
#   default: re-record into a temp dir and compare with the fixtures. Run metadata differs on every run: timestamps,
#     elapsed ms, per-run UUIDs, per-run salted `sha8:` redactions, digests, PLoT's redacted echo of the ISL request
#     (`downstream_calls`, keyed by those salted hashes) and the order the UUIDs sort facts into. Both sides are
#     compared in a canonical form with those masked and lists order-normalised; every figure (chances, means,
#     percentiles, warnings and their details) must be equal.
#   --write: rewrite the fixtures, with provenance.
# Exit: 0 = identical (or written); 1 = they differ; 2 = could not measure (never a pass).
# The fixtures were recorded on 21 Oct 2026 through this same chain (run-chain.sh, this spec's RECORD row, and
# plot-record.test.ts.tmpl) at CEE 5c870879, PLoT 679f170c and ISL 073ff5db. Re-check them with:
#   TRACK2_ROOT=<dir whose isl/ is at ISL_SHA> F1_PLOT=<PLoT checkout at PLOT_SHA> scripts/track2/record-from-zero.sh
setopt pipefail
PLOT_SHA=679f170c24397b0aa5bd50b4589d39bd55fce307
ISL_SHA=073ff5dbe113b69c6e4e77b27b52db70a6fe5bb2   # ISL 8d862f5a plus tests only
CEE=${0:A:h:h:h}
PLOT=${F1_PLOT:?F1_PLOT names a PLoT checkout} ISL=${TRACK2_ROOT:?TRACK2_ROOT holds isl/}/isl
SPEC=src/orchestrator-v5/tools/handlers/__tests__/track2-from-zero-means.test.ts
FIX=$CEE/src/orchestrator-v5/tools/handlers/__tests__/fixtures
[[ $(git -C $PLOT rev-parse HEAD) == $PLOT_SHA ]] || { echo "PLoT is not at $PLOT_SHA"; exit 2; }
[[ $(git -C $ISL rev-parse HEAD) == $ISL_SHA ]] || { echo "ISL is not at $ISL_SHA"; exit 2; }
CEE_SHA=$(git -C $CEE rev-parse HEAD)
OUT=$(mktemp -d /private/tmp/track2-record.XXXXXX)
cp $CEE/scripts/track2/plot-record.test.ts.tmpl $PLOT/tests/track2-record.test.ts
trap 'rm -f $PLOT/tests/track2-record.test.ts' EXIT
# The CEE half also runs the spec's own rows against the committed fixtures; the recording needs only its requests.
F1_CEE=$CEE F1_PLOT=$PLOT F1_OUT=$OUT zsh $CEE/scripts/track2/run-chain.sh $SPEC tests/track2-record.test.ts
grep -qE "Tests .*1 passed" $OUT/plot.log || { echo "the PLoT half did not record (see $OUT/plot.log)"; exit 2; }
for n in held today; do [[ -s $OUT/$n.plot-response.json ]] || { echo "no $n response"; exit 2; }; done
node - "$OUT" "$FIX" "$CEE_SHA" "$PLOT_SHA" "$ISL_SHA" "${1:-}" <<'JS'
const fs = require('node:fs');
const [out, fix, cee, plot, isl, mode] = process.argv.slice(2);
let differ = false;
// Run metadata that differs on every run; everything else must be equal.
const VOLATILE = /(timestamp|created_at|_at$|elapsed|duration|_ms$|^id$|_id$|digest|hash|sha256|^downstream_calls$)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (v, key = '') => {
  if (VOLATILE.test(key) && !/option_id|goal_node_id|factor_id|node_id$/.test(key)) return '<volatile>';
  if (Array.isArray(v)) return v.map((x) => norm(x)).map((x) => JSON.stringify(x)).sort().map((x) => JSON.parse(x));
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k], k)]));
  if (typeof v === 'string' && (v.startsWith('sha8:') || UUID.test(v) || /^critique_[0-9a-f]+$/.test(v))) return '<volatile>';
  return v;
};
const canon = (b) => JSON.stringify(norm(b));
for (const [n, today] of [['held', 'null'], ['today', '10000']]) {
  const fresh = JSON.parse(fs.readFileSync(`${out}/${n}.plot-response.json`, 'utf8'));
  const file = `${fix}/track2-from-zero-${n}.plot-response.json`;
  if (mode === '--write') {
    const _provenance = { recorded: new Date().toISOString().slice(0, 10), how: 'scripts/track2/record-from-zero.sh --write: CEE mapper -> run-analysis request (this spec, F1_OUT) -> PLoT POST /v2/run -> local ISL (scripts/track2/run-chain.sh)',
      cee, plot, isl: `${isl} (8d862f5a + tests only)`, model: `pricingAndReferral(${today})` };
    fs.writeFileSync(file, JSON.stringify({ _provenance, ...fresh }, null, 1));
    console.log(`wrote ${file}`);
  } else {
    const { _provenance: _, ...kept } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const same = canon(kept) === canon(fresh);
    const figures = (b) => JSON.stringify((b.option_comparison ?? []).map((o) => [o.option_id, o.probability_of_goal, o.win_probability, o.outcome]));
    console.log(`${n}: ${same ? 'equal to the committed fixture (canonical form)' : 'DIFFERS from the committed fixture'}; option figures ${figures(kept) === figures(fresh) ? 'identical' : 'DIFFER'}`);
    differ ||= !same;
  }
}
process.exit(differ ? 1 : 0);
JS
