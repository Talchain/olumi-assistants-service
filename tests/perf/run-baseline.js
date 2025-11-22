#!/usr/bin/env node

/**
 * Artillery Baseline Runner
 *
 * Runs baseline performance test and generates reports:
 * - JSON data file
 * - HTML visual report
 * - Summary appended to docs/baseline-performance-report.md
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const REPORTS_DIR = join(__dirname, '_reports');
const BASELINE_YML = join(__dirname, 'baseline.yml');
const DOCS_REPORT = join(__dirname, '../../docs/baseline-performance-report.md');

// Generate timestamp for report filenames
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const jsonFile = join(REPORTS_DIR, `baseline-${timestamp}.json`);
const htmlFile = join(REPORTS_DIR, `baseline-${timestamp}.html`);
const latestJson = join(REPORTS_DIR, 'latest.json');
const latestHtml = join(REPORTS_DIR, 'latest.html');

// Read environment config
const target = process.env.PERF_TARGET_URL || 'http://localhost:3101';
const duration = process.env.PERF_DURATION_SEC || '300';
const rps = process.env.PERF_RPS || '1';
const apiKey = process.env.ASSIST_API_KEY || '';

console.log('\n📊 Artillery Baseline Performance Test\n');
console.log(`Target:   ${target}`);
console.log(`Duration: ${duration}s`);
console.log(`Rate:     ${rps} req/sec`);
console.log('');

try {
  // Ensure reports directory exists before running Artillery
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  // Run Artillery and capture JSON output
  console.log('🚀 Running Artillery...\n');
  const variablesArg = apiKey ? ` --variables apiKey=${apiKey}` : '';
  execSync(
    `artillery run "${BASELINE_YML}" --output "${jsonFile}" --target "${target}"${variablesArg}`,
    { stdio: 'inherit', env: { ...process.env } }
  );

  console.log('\n✅ Artillery run complete\n');

  // Generate HTML report
  console.log('📈 Generating HTML report...\n');
  execSync(
    `artillery report "${jsonFile}" --output "${htmlFile}"`,
    { stdio: 'inherit' }
  );

  // Create symlinks to latest
  try {
    if (existsSync(latestJson)) unlinkSync(latestJson);
    if (existsSync(latestHtml)) unlinkSync(latestHtml);
    execSync(`ln -s "${jsonFile}" "${latestJson}"`);
    execSync(`ln -s "${htmlFile}" "${latestHtml}"`);
  } catch (err) {
    console.warn('⚠️  Failed to update latest report symlinks:', err.message);
  }

  console.log(`\n✅ Reports generated:`);
  console.log(`   JSON: ${jsonFile}`);
  console.log(`   HTML: ${htmlFile}`);
  console.log(`   Latest: ${latestHtml}\n`);

  // Parse results and append summary to docs
  console.log('📝 Appending summary to docs...\n');
  const results = JSON.parse(readFileSync(jsonFile, 'utf8'));
  appendSummary(results, target, duration, rps);

  console.log('✅ Summary appended to docs/baseline-performance-report.md\n');
  console.log(`🎉 Done! Open report: open ${htmlFile}\n`);

} catch (error) {
  console.error('\n❌ Error running baseline:', error.message);
  process.exit(1);
}

/**
 * Append summary to baseline-performance-report.md
 */
function appendSummary(results, target, duration, rps) {
  const aggregate = results.aggregate || {};

  // Artillery v2 exposes metrics under aggregate.summaries / aggregate.histograms.
  // Prefer the per-endpoint metric for /assist/draft-graph, falling back to the
  // overall HTTP response time histogram.
  const latencySource =
    aggregate.summaries?.['plugins.metrics-by-endpoint.response_time./assist/draft-graph'] ||
    aggregate.histograms?.['plugins.metrics-by-endpoint.response_time./assist/draft-graph'] ||
    aggregate.summaries?.['http.response_time'] ||
    aggregate.histograms?.['http.response_time'];

  if (!latencySource) {
    console.warn('⚠️  No summary found in Artillery results');
    return;
  }

  const p50 =
    typeof latencySource.p50 === 'number'
      ? latencySource.p50
      : typeof latencySource.median === 'number'
      ? latencySource.median
      : 0;
  const p95 = typeof latencySource.p95 === 'number' ? latencySource.p95 : 0;
  const p99 = typeof latencySource.p99 === 'number' ? latencySource.p99 : 0;
  const min = typeof latencySource.min === 'number' ? latencySource.min : 0;
  const max = typeof latencySource.max === 'number' ? latencySource.max : 0;

  const counters = aggregate.counters || {};
  const successCount = counters['http.codes.200'] || 0;
  const totalRequests = counters['http.requests'] || successCount || 0;
  const successRate =
    totalRequests > 0 ? ((successCount / totalRequests) * 100).toFixed(2) : '0.00';
  const errorRate =
    totalRequests > 0 ? (100 - parseFloat(successRate)).toFixed(2) : '0.00';

  const throughput = aggregate.rates?.['http.request_rate'] || 0;

  const scenariosCompleted =
    counters['vusers.created_by_name.Draft graph - baseline performance'] || 0;

  // SLO targets: success ≥99.0%, p95 ≤12s
  const sloSuccessTarget = 99.0;
  const sloLatencyTarget = 12000; // 12s in ms

  const passSuccessSLO = parseFloat(successRate) >= sloSuccessTarget;
  const passLatencySLO = p95 <= sloLatencyTarget;
  const passGate = p95 <= 8000; // Legacy 8s gate (stricter)

  const gateStatus = passGate ? '✅ PASS' : '❌ FAIL';
  const sloStatus = passSuccessSLO && passLatencySLO ? '✅ PASS' : '⚠️ FAIL';

  const summaryText = `
---

## Run: ${new Date().toISOString()}

**Configuration:**
- Target: \`${target}\`
- Duration: ${duration}s
- Rate: ${rps} req/sec
- Scenarios completed: ${scenariosCompleted}

**Latency (ms):**
- p50: **${p50}ms**
- p95: **${p95}ms** ${passGate ? '✅' : passLatencySLO ? '⚠️ >8s (within 12s SLO)' : '❌ >12s SLO'}
- p99: **${p99}ms**
- min/max: ${min}ms / ${max}ms

**Reliability:**
- Success rate: **${successRate}%** ${passSuccessSLO ? '✅' : '❌ <99% SLO'}
- Error rate: **${errorRate}%**
- Throughput: **${throughput.toFixed(2)} req/sec**

**v1.7 SLO Compliance:**
- Draft Graph Success Rate ≥99.0%: ${passSuccessSLO ? '✅ PASS' : '❌ FAIL'} (${successRate}%)
- Draft Graph p95 ≤12s: ${passLatencySLO ? '✅ PASS' : '❌ FAIL'} (${p95}ms)
- **Overall SLO Status:** ${sloStatus}

**Legacy Perf Gate (p95 ≤ 8s):** ${gateStatus}

${!passGate ? `
**Profiling Notes:**
- p95 exceeded threshold by ${(p95 - 8000).toFixed(0)}ms
- Review [profiling section](#profiling-mode) in tests/perf/README.md
- Check telemetry for slow spans (likely LLM call duration)
` : ''}

**Reports:**
- [JSON](../tests/perf/_reports/baseline-${timestamp}.json)
- [HTML](../tests/perf/_reports/baseline-${timestamp}.html)

`;

  // Append to docs (or create if doesn't exist)
  let existingContent = '';
  if (existsSync(DOCS_REPORT)) {
    existingContent = readFileSync(DOCS_REPORT, 'utf8');
  } else {
    existingContent = `# Baseline Performance Report

This document tracks performance baseline runs for the Olumi Assistants Service.

**Acceptance Gate:** p95 ≤ 8s under baseline load (1 req/sec, 5 minutes)

See [tests/perf/README.md](../tests/perf/README.md) for testing instructions.
`;
  }

  writeFileSync(DOCS_REPORT, existingContent + summaryText);
}
