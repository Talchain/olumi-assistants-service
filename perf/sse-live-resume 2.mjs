#!/usr/bin/env node
/**
 * SSE Live Resume Performance Test (v1.11)
 *
 * Simulates realistic SSE streaming with live resume:
 * - Multiple concurrent streams
 * - Random mid-stream disconnects
 * - Live resume continuation
 * - Real-time windowed metrics with fail-fast
 *
 * Usage:
 *   ASSIST_API_KEY=xxx node perf/sse-live-resume.mjs
 *
 * Environment:
 *   - PERF_TARGET_URL: Target URL (default: http://localhost:3101)
 *   - PERF_DURATION_SEC: Test duration in seconds (default: 60)
 *   - PERF_CONCURRENT: Concurrent streams (default: 3)
 *   - ASSIST_API_KEY: API key for authentication
 */

import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

const BASE_URL = process.env.PERF_TARGET_URL || 'http://localhost:3101';
const PERF_MODE = process.env.PERF_MODE === 'dry' ? 'dry' : 'full';
const DURATION_SEC = Number(process.env.PERF_DURATION_SEC) || (PERF_MODE === 'dry' ? 20 : 60);
const CONCURRENT = Number(process.env.PERF_CONCURRENT) || (PERF_MODE === 'dry' ? 2 : 3);
const API_KEY = process.env.ASSIST_API_KEY || '';
const WINDOW_SIZE_SEC = 10; // 10-second windows for real-time metrics

export function percentile(sorted, quantile) {
  if (!Array.isArray(sorted) || sorted.length === 0) return 0;
  if (quantile <= 0) return sorted[0];
  if (quantile >= 1) return sorted[sorted.length - 1];
  const index = Math.floor(sorted.length * quantile);
  const safeIndex = Math.min(index, sorted.length - 1);
  return sorted[safeIndex];
}

if (!API_KEY && process.env.NODE_ENV !== 'test') {
  console.error('ERROR: ASSIST_API_KEY environment variable required');
  process.exit(1);
}

// Aggregate metrics (v1.10 compatible)
const metrics = {
  streams_started: 0,
  streams_completed: 0,
  streams_failed: 0,
  resume_attempts: 0,
  resume_successes: 0,
  resume_failures: 0,
  events_received: 0,
  buffer_trims: 0,
  latencies: [],
  reconnect_latencies: [],
  errors: {},
  error_types: {
    server_5xx: 0,
    client_400: 0,
    client_401: 0,
    rate_limit_429: 0,
    transport: 0,
  },
};

// Windowed metrics (v1.11)
const windows = [];
let currentWindow = {
  start_time: Date.now(),
  end_time: Date.now() + (WINDOW_SIZE_SEC * 1000),
  resume_attempts: 0,
  resume_successes: 0,
  resume_failures: 0,
  buffer_trims: 0,
  resume_latencies: [],
  streams_in_window: 0,
  errors_total: 0,
  error_types: {
    server_5xx: 0,
    client_400: 0,
    client_401: 0,
    rate_limit_429: 0,
    transport: 0,
  },
};

/**
 * Record metric in current window and rotate if needed
 */
function recordWindowMetric(type, value = 1) {
  const now = Date.now();

  // Rotate window if time expired
  if (now >= currentWindow.end_time) {
    windows.push({ ...currentWindow });
    currentWindow = {
      start_time: now,
      end_time: now + (WINDOW_SIZE_SEC * 1000),
      resume_attempts: 0,
      resume_successes: 0,
      resume_failures: 0,
      buffer_trims: 0,
      resume_latencies: [],
      streams_in_window: 0,
      errors_total: 0,
      error_types: {
        server_5xx: 0,
        client_400: 0,
        client_401: 0,
        rate_limit_429: 0,
        transport: 0,
      },
    };
  }

  // Record in current window
  switch (type) {
    case 'resume_attempt':
      currentWindow.resume_attempts++;
      break;
    case 'resume_success':
      currentWindow.resume_successes++;
      break;
    case 'resume_failure':
      currentWindow.resume_failures++;
      break;
    case 'buffer_trim':
      currentWindow.buffer_trims++;
      break;
    case 'resume_latency':
      currentWindow.resume_latencies.push(value);
      break;
    case 'stream_complete':
      currentWindow.streams_in_window++;
      break;
    case 'error':
      currentWindow.errors_total++;
      if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(currentWindow.error_types, value)) {
        currentWindow.error_types[value] += 1;
      }
      break;
  }
}

function recordErrorMetric(category) {
  if (Object.prototype.hasOwnProperty.call(metrics.error_types, category)) {
    metrics.error_types[category] += 1;
  }
  recordWindowMetric('error', category);
}

/**
 * Check if current window violates gates (fail-fast)
 */
export function evaluateWindowGates(window) {
  const resumeSuccessRate = window.resume_attempts > 0
    ? (window.resume_successes / window.resume_attempts * 100)
    : 100;

  const trimRate = window.streams_in_window > 0
    ? (window.buffer_trims / window.streams_in_window * 100)
    : 0;

  const maxResumeLatency = window.resume_latencies.length > 0
    ? Math.max(...window.resume_latencies)
    : 0;

  const errorRate = window.streams_in_window > 0
    ? (window.errors_total / window.streams_in_window * 100)
    : 0;

  // Stricter window thresholds
  const violations = [];

  if (window.resume_attempts >= 3 && resumeSuccessRate < 95) {
    violations.push(`Resume success rate in window: ${resumeSuccessRate.toFixed(1)}% < 95% (${window.resume_successes}/${window.resume_attempts})`);
  }

  if (window.streams_in_window >= 2 && trimRate > 1.0) {
    violations.push(`Buffer trim rate in window: ${trimRate.toFixed(1)}% > 1.0% (${window.buffer_trims}/${window.streams_in_window})`);
  }

  if (maxResumeLatency > 15000) {
    violations.push(`Resume latency in window: ${maxResumeLatency.toFixed(0)}ms > 15000ms`);
  }

  if (window.streams_in_window >= 2 && errorRate > 1.0) {
    violations.push(`Error rate in window: ${errorRate.toFixed(1)}% > 1.0% (${window.errors_total}/${window.streams_in_window})`);
  }

  return {
    violations,
    resumeSuccessRate,
    trimRate,
    maxResumeLatency,
    errorRate,
  };
}

function checkWindowGates() {
  const window = currentWindow;
  const { violations } = evaluateWindowGates(window);

  if (violations.length > 0) {
    console.error('\n❌ FAIL-FAST: Window gate violation detected!');
    console.error(`Window: ${new Date(window.start_time).toISOString()} - ${new Date(window.end_time).toISOString()}`);
    violations.forEach(v => console.error(`  - ${v}`));

    // Flush current window to history
    windows.push({ ...window });

    // Write partial results
    writeResults(true);

    console.error('\nTest aborted due to window gate violation');
    process.exit(1);
  }
}

function classifyHttpError(status) {
  if (status >= 500 && status <= 599) return 'server_5xx';
  if (status === 400) return 'client_400';
  if (status === 401) return 'client_401';
  if (status === 429) return 'rate_limit_429';
  return null;
}

/**
 * Parse SSE event from raw text
 */
function parseSseEvent(eventText) {
  const lines = eventText.trim().split('\n');
  let eventType = null;
  let dataLines = [];

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.substring(7).trim();
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.substring(6));
    } else if (line.startsWith(': ')) {
      eventType = 'heartbeat';
    }
  }

  if (!eventType) return null;

  if (eventType === 'heartbeat' || dataLines.length === 0) {
    return { type: 'heartbeat', data: null };
  }

  try {
    const data = JSON.parse(dataLines.join('\n'));
    return { type: eventType, data };
  } catch {
    return null;
  }
}

/**
 * Start a stream and randomly disconnect/resume
 */
async function runStream(streamId, signal) {
  const startTime = performance.now();
  let resumeToken = null;
  let eventCount = 0;
  let shouldDisconnect = Math.random() > 0.5; // 50% chance of disconnect
  let disconnectAfterEvents = shouldDisconnect ? Math.floor(Math.random() * 5) + 2 : Infinity;

  metrics.streams_started++;

  try {
    // Phase 1: Initial stream
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 90000); // 90s timeout

    const resp = await fetch(`${BASE_URL}/assist/draft-graph/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Olumi-Assist-Key': API_KEY,
      },
      body: JSON.stringify({ brief: 'Choose a data visualization library' }),
      signal: ctrl.signal,
    });

    if (!resp.ok) {
      metrics.streams_failed++;
      metrics.errors[`stream_${resp.status}`] = (metrics.errors[`stream_${resp.status}`] || 0) + 1;
      const category = classifyHttpError(resp.status);
      if (category) {
        recordErrorMetric(category);
      }
      clearTimeout(timeout);
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (part.trim()) {
          const event = parseSseEvent(part);
          if (event) {
            eventCount++;
            metrics.events_received++;

            // Capture resume token
            if (event.type === 'resume') {
              resumeToken = event.data?.token;
            }

            // Check if stream completed and record buffer trim from diagnostics on final COMPLETE
            if (event.type === 'stage' && event.data?.stage === 'COMPLETE') {
              const trims = event.data?.payload?.diagnostics?.trims || 0;
              if (trims > 0) {
                metrics.buffer_trims++;
                recordWindowMetric('buffer_trim');
              }
              clearTimeout(timeout);
              reader.releaseLock();
              const elapsed = performance.now() - startTime;
              metrics.latencies.push(elapsed);
              metrics.streams_completed++;
              recordWindowMetric('stream_complete');
              console.log(`[Stream ${streamId}] Completed in ${elapsed.toFixed(0)}ms (${eventCount} events)`);

              // Check window gates after stream completion
              checkWindowGates();
              return;
            }

            // Simulate disconnect
            if (shouldDisconnect && eventCount >= disconnectAfterEvents && resumeToken) {
              console.log(`[Stream ${streamId}] Simulating disconnect at event ${eventCount}`);
              clearTimeout(timeout);
              reader.releaseLock();
              ctrl.abort();

              // Phase 2: Resume with live mode
              await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay

              metrics.resume_attempts++;
              recordWindowMetric('resume_attempt');
              const resumeStart = performance.now();

              const resumeResp = await fetch(`${BASE_URL}/assist/draft-graph/resume?mode=live`, {
                method: 'POST',
                headers: {
                  'X-Resume-Token': resumeToken,
                  'X-Resume-Mode': 'live',
                  'X-Olumi-Assist-Key': API_KEY,
                },
              });

              const resumeLatency = performance.now() - resumeStart;
              metrics.reconnect_latencies.push(resumeLatency);
              recordWindowMetric('resume_latency', resumeLatency);

              if (!resumeResp.ok) {
                metrics.resume_failures++;
                recordWindowMetric('resume_failure');
                metrics.errors[`resume_${resumeResp.status}`] = (metrics.errors[`resume_${resumeResp.status}`] || 0) + 1;
                const category = classifyHttpError(resumeResp.status);
                if (category) {
                  recordErrorMetric(category);
                }
                console.log(`[Stream ${streamId}] Resume failed: ${resumeResp.status}`);

                // Check window gates on failure
                checkWindowGates();
                return;
              }

              metrics.resume_successes++;
              recordWindowMetric('resume_success');
              console.log(`[Stream ${streamId}] Resume succeeded (${resumeLatency.toFixed(0)}ms)`);

              // Check window gates after resume
              checkWindowGates();

              // Continue reading from resumed stream
              const resumeReader = resumeResp.body.getReader();
              let resumeBuffer = '';

              while (true) {
                const { done, value } = await resumeReader.read();
                if (done) break;

                resumeBuffer += decoder.decode(value, { stream: true });
                const resumeParts = resumeBuffer.split('\n\n');
                resumeBuffer = resumeParts.pop() || '';

                for (const part of resumeParts) {
                  if (part.trim()) {
                    const resumeEvent = parseSseEvent(part);
                    if (resumeEvent) {
                      eventCount++;
                      metrics.events_received++;

                      if (resumeEvent.type === 'stage' && resumeEvent.data?.stage === 'COMPLETE') {
                        const trims = resumeEvent.data?.payload?.diagnostics?.trims || 0;
                        if (trims > 0) {
                          metrics.buffer_trims++;
                          recordWindowMetric('buffer_trim');
                        }
                        resumeReader.releaseLock();
                        const elapsed = performance.now() - startTime;
                        metrics.latencies.push(elapsed);
                        metrics.streams_completed++;
                        recordWindowMetric('stream_complete');
                        console.log(`[Stream ${streamId}] Completed via resume in ${elapsed.toFixed(0)}ms (${eventCount} events)`);

                        // Check window gates
                        checkWindowGates();
                        return;
                      }
                    }
                  }
                }
              }

              resumeReader.releaseLock();
              return;
            }
          }
        }
      }
    }

    clearTimeout(timeout);
    reader.releaseLock();
  } catch (error) {
    metrics.streams_failed++;
    const errorType = error.name || 'unknown';
    metrics.errors[errorType] = (metrics.errors[errorType] || 0) + 1;
     recordErrorMetric('transport');
    console.error(`[Stream ${streamId}] Error:`, error.message);
  }
}

/**
 * Write results to files
 */
function writeResults(isPartial = false) {
  // Flush current window
  if (!isPartial) {
    windows.push({ ...currentWindow });
  }

  // Calculate aggregate metrics
  const totalStreams = metrics.streams_started;
  const successRate = totalStreams > 0 ? (metrics.streams_completed / totalStreams * 100) : 0;
  const resumeSuccessRate = metrics.resume_attempts > 0
    ? (metrics.resume_successes / metrics.resume_attempts * 100)
    : 100;

  const bufferTrimRate = totalStreams > 0 ? (metrics.buffer_trims / totalStreams * 100) : 0;

  const sortedLatencies = metrics.latencies.sort((a, b) => a - b);
  const p50 = percentile(sortedLatencies, 0.5);
  const p95 = percentile(sortedLatencies, 0.95);
  const p99 = percentile(sortedLatencies, 0.99);

  const sortedReconnectLatencies = metrics.reconnect_latencies.slice().sort((a, b) => a - b);
  const reconnectP50 = percentile(sortedReconnectLatencies, 0.5);
  const reconnectP95 = percentile(sortedReconnectLatencies, 0.95);

  const totalErrors = Object.values(metrics.error_types).reduce((sum, value) => sum + value, 0);
  const errorRate = totalStreams > 0 ? (totalErrors / totalStreams * 100) : 0;

  // Aggregate results (v1.10 compatible)
  const results = {
    schema: 'sse_live_resume.v1',
    perf_mode: PERF_MODE,
    summary: {
      streams_started: totalStreams,
      streams_completed: metrics.streams_completed,
      streams_failed: metrics.streams_failed,
      success_rate: successRate.toFixed(2) + '%',
      resume_attempts: metrics.resume_attempts,
      resume_successes: metrics.resume_successes,
      resume_success_rate: resumeSuccessRate.toFixed(2) + '%',
      buffer_trims: metrics.buffer_trims,
      buffer_trim_rate: bufferTrimRate.toFixed(2) + '%',
      events_received: metrics.events_received,
      errors_total: totalErrors,
      error_rate: errorRate.toFixed(2) + '%',
      reconnect_p50_ms: reconnectP50.toFixed(0),
      reconnect_p95_ms: reconnectP95.toFixed(0),
    },
    latencies_ms: {
      p50: p50.toFixed(0),
      p95: p95.toFixed(0),
      p99: p99.toFixed(0),
      min: sortedLatencies.length > 0 ? Math.min(...sortedLatencies).toFixed(0) : '0',
      max: sortedLatencies.length > 0 ? Math.max(...sortedLatencies).toFixed(0) : '0',
    },
    reconnect_latencies_ms: {
      p50: reconnectP50.toFixed(0),
      p95: reconnectP95.toFixed(0),
      count: sortedReconnectLatencies.length,
    },
    errors: metrics.errors,
    error_types: metrics.error_types,
    aggregate_error_rate: errorRate.toFixed(2) + '%',
    gates: {
      resume_success_rate_98: resumeSuccessRate >= 98,
      buffer_trim_rate_0_5: bufferTrimRate <= 0.5,
      p95_under_12s: p95 < 12000,
      reconnect_p95_under_15s: reconnectP95 < 15000,
      error_rate_1: errorRate <= 1.0,
    }
  };

  // Windowed results (v1.11)
  const windowedResults = {
    schema: 'sse_live_resume_windowed.v1',
    perf_mode: PERF_MODE,
    window_size_sec: WINDOW_SIZE_SEC,
    windows: windows.map(w => {
      const wResumeSuccessRate = w.resume_attempts > 0
        ? (w.resume_successes / w.resume_attempts * 100)
        : 100;
      const wTrimRate = w.streams_in_window > 0
        ? (w.buffer_trims / w.streams_in_window * 100)
        : 0;
      const wMaxResumeLatency = w.resume_latencies.length > 0
        ? Math.max(...w.resume_latencies)
        : 0;
      const wErrorRate = w.streams_in_window > 0
        ? (w.errors_total / w.streams_in_window * 100)
        : 0;

      return {
        start: new Date(w.start_time).toISOString(),
        end: new Date(w.end_time).toISOString(),
        resume_attempts: w.resume_attempts,
        resume_successes: w.resume_successes,
        resume_success_rate: wResumeSuccessRate.toFixed(2) + '%',
        buffer_trims: w.buffer_trims,
        streams_in_window: w.streams_in_window,
        buffer_trim_rate: wTrimRate.toFixed(2) + '%',
        max_resume_latency_ms: wMaxResumeLatency.toFixed(0),
        errors_total: w.errors_total,
        error_types: w.error_types,
        error_rate: wErrorRate.toFixed(2) + '%',
        gates: {
          resume_success_95: wResumeSuccessRate >= 95 || w.resume_attempts < 3,
          trim_rate_1: wTrimRate <= 1.0 || w.streams_in_window < 2,
          max_latency_15s: wMaxResumeLatency <= 15000 || w.resume_latencies.length === 0,
          error_rate_1: wErrorRate <= 1.0 || w.streams_in_window < 2,
        }
      };
    }),
    worst_case: (() => {
      if (windows.length === 0) return null;

      let worstResume = windows[0];
      let worstTrim = windows[0];
      let worstLatency = windows[0];
      let worstError = windows[0];

      for (const w of windows) {
        const rate = w.resume_attempts > 0 ? (w.resume_successes / w.resume_attempts * 100) : 100;
        const worstRate = worstResume.resume_attempts > 0
          ? (worstResume.resume_successes / worstResume.resume_attempts * 100)
          : 100;

        if (w.resume_attempts >= 3 && rate < worstRate) {
          worstResume = w;
        }

        const trimRate = w.streams_in_window > 0 ? (w.buffer_trims / w.streams_in_window * 100) : 0;
        const worstTrimRate = worstTrim.streams_in_window > 0
          ? (worstTrim.buffer_trims / worstTrim.streams_in_window * 100)
          : 0;

        if (w.streams_in_window >= 2 && trimRate > worstTrimRate) {
          worstTrim = w;
        }

        const maxLatency = w.resume_latencies.length > 0 ? Math.max(...w.resume_latencies) : 0;
        const worstMaxLatency = worstLatency.resume_latencies.length > 0
          ? Math.max(...worstLatency.resume_latencies)
          : 0;

        if (maxLatency > worstMaxLatency) {
          worstLatency = w;
        }

        const errRate = w.streams_in_window > 0 ? (w.errors_total / w.streams_in_window * 100) : 0;
        const worstErrRate = worstError.streams_in_window > 0
          ? (worstError.errors_total / worstError.streams_in_window * 100)
          : 0;

        if (w.streams_in_window >= 2 && errRate > worstErrRate) {
          worstError = w;
        }
      }

      return {
        worst_resume_window: new Date(worstResume.start_time).toISOString(),
        worst_resume_success_rate: worstResume.resume_attempts > 0
          ? ((worstResume.resume_successes / worstResume.resume_attempts * 100).toFixed(2) + '%')
          : '100%',
        worst_trim_window: new Date(worstTrim.start_time).toISOString(),
        worst_trim_rate: worstTrim.streams_in_window > 0
          ? ((worstTrim.buffer_trims / worstTrim.streams_in_window * 100).toFixed(2) + '%')
          : '0%',
        worst_latency_window: new Date(worstLatency.start_time).toISOString(),
        worst_resume_latency_ms: worstLatency.resume_latencies.length > 0
          ? Math.max(...worstLatency.resume_latencies).toFixed(0)
          : '0',
        worst_error_window: new Date(worstError.start_time).toISOString(),
        worst_error_rate: worstError.streams_in_window > 0
          ? ((worstError.errors_total / worstError.streams_in_window * 100).toFixed(2) + '%')
          : '0%',
      };
    })(),
  };

  console.log('\n=== Performance Test Results ===');
  console.log(JSON.stringify(results, null, 2));

  // Write files
  writeFileSync('perf-sse-live-results.json', JSON.stringify(results, null, 2));
  writeFileSync('perf-sse-live-windowed.json', JSON.stringify(windowedResults, null, 2));

  console.log('\nResults written to:');
  console.log('  - perf-sse-live-results.json (aggregate)');
  console.log('  - perf-sse-live-windowed.json (time-series)');

  return { results, windowedResults };
}

/**
 * Run concurrent streams for the specified duration
 */
async function runTest() {
  console.log(`Starting SSE Live Resume performance test:`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Duration: ${DURATION_SEC}s`);
  console.log(`  Concurrent: ${CONCURRENT}`);
  console.log(`  Window size: ${WINDOW_SIZE_SEC}s`);
  console.log('');

  const startTime = Date.now();
  const endTime = startTime + (DURATION_SEC * 1000);
  let streamId = 0;
  const activeStreams = new Set();

  // Start initial batch
  for (let i = 0; i < CONCURRENT; i++) {
    const id = ++streamId;
    const promise = runStream(id, null).finally(() => activeStreams.delete(promise));
    activeStreams.add(promise);
  }

  // Keep concurrent streams running until time expires
  while (Date.now() < endTime) {
    if (activeStreams.size < CONCURRENT) {
      const id = ++streamId;
      const promise = runStream(id, null).finally(() => activeStreams.delete(promise));
      activeStreams.add(promise);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Wait for remaining streams
  console.log('\nWaiting for remaining streams to complete...');
  await Promise.allSettled(activeStreams);

  // Write results
  const { results } = writeResults(false);

  // Check gates
  const gatesPassed = Object.values(results.gates).every(Boolean);
  if (!gatesPassed) {
    console.error('\n❌ Performance gates FAILED:');
    if (!results.gates.resume_success_rate_98) {
      console.error(`  - Resume success rate: ${results.summary.resume_success_rate} < 98%`);
    }
    if (!results.gates.buffer_trim_rate_0_5) {
      console.error(`  - Buffer trim rate: ${results.summary.buffer_trim_rate} > 0.5%`);
    }
    if (!results.gates.p95_under_12s) {
      console.error(`  - p95 latency: ${results.latencies_ms.p95}ms >= 12000ms`);
    }
    process.exit(1);
  }

  console.log('\n✅ All performance gates PASSED');
  console.log('✅ All window gates PASSED (no fail-fast triggered)');
  return results;
}

// Run test (skip when imported in unit tests)
if (process.env.NODE_ENV !== 'test') {
  runTest().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
