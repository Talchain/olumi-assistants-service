/**
 * Admin UI Route
 *
 * Serves a lightweight Alpine.js-based admin interface for
 * prompt management. Security-hardened with CSP headers.
 *
 * Security features:
 * - Content Security Policy (CSP) header
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY
 * - Alpine.js loaded with specific version from CDN
 *
 * Routes:
 * - GET /admin - Admin dashboard UI
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { log, emit, hashIP } from '../utils/telemetry.js';
import { PROMPT_TASKS } from '../constants/prompt-tasks.js';

/**
 * Generate HTML options for task dropdown from canonical PROMPT_TASKS registry.
 * This ensures admin UI stays in sync with all registered prompt tasks.
 */
function generateTaskOptions(): string {
  return PROMPT_TASKS.map(task => `<option value="${task}">${task}</option>`).join('\n                    ');
}

/**
 * Generate HTML options for task filter dropdown (includes "All Tasks" option).
 */
function generateTaskFilterOptions(): string {
  const allTasksOption = '<option value="">All Tasks</option>';
  const taskOptions = PROMPT_TASKS.map(task => `<option value="${task}">${task}</option>`).join('\n                    ');
  return `${allTasksOption}\n                    ${taskOptions}`;
}

/**
 * Telemetry event for blocked IP access
 */
const AdminUIIPBlocked = 'admin.ui.ip.blocked' as const;

/**
 * Parse and cache allowed IPs from config
 */
function getAllowedIPs(): Set<string> | null {
  const allowedIPsConfig = config.prompts?.adminAllowedIPs;
  if (!allowedIPsConfig || allowedIPsConfig.trim() === '') {
    return null; // No restriction
  }

  return new Set(
    allowedIPsConfig
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0)
  );
}

/**
 * Check if request IP is allowed to access admin UI
 * Returns true if allowed, sends error response if blocked
 */
function verifyIPAllowed(request: FastifyRequest, reply: FastifyReply): boolean {
  const allowedIPs = getAllowedIPs();

  // No IP restriction configured
  if (!allowedIPs) {
    return true;
  }

  const requestIP = request.ip;

  // Check if IP is in allowlist (including localhost variants)
  const isAllowed =
    allowedIPs.has(requestIP) ||
    (requestIP === '::1' && allowedIPs.has('127.0.0.1')) ||
    (requestIP === '127.0.0.1' && allowedIPs.has('::1'));

  if (!isAllowed) {
    // Use hashed IP in telemetry/logs to avoid PII leakage
    const ipHash = hashIP(requestIP);
    emit(AdminUIIPBlocked, {
      ip_hash: ipHash,
      path: request.url,
      allowedCount: allowedIPs.size,
    });
    log.warn({ ip_hash: ipHash, path: request.url }, 'Admin UI access blocked by IP allowlist');
    reply.status(403).send('Forbidden: IP not allowed');
    return false;
  }

  return true;
}

/**
 * Alpine.js CDN configuration
 * Using specific version for stability and security
 */
const ALPINE_VERSION = '3.14.1';
const ALPINE_CDN_URL = `https://cdn.jsdelivr.net/npm/alpinejs@${ALPINE_VERSION}/dist/cdn.min.js`;

/**
 * Content Security Policy for admin pages
 * Restricts sources to minimize XSS attack surface
 */
const CSP_HEADER = [
  "default-src 'self'",
  // Allow Alpine.js from jsdelivr CDN only (pinned domain)
  // Note: 'unsafe-inline' required for inline <script> tag with promptAdmin()
  // Note: 'unsafe-eval' required for Alpine.js to evaluate x-data expressions
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net`,
  // Allow inline styles for UI (required for dynamic styling)
  "style-src 'self' 'unsafe-inline'",
  // Prevent loading in frames (clickjacking protection)
  "frame-ancestors 'none'",
  // Restrict form submissions to same origin
  "form-action 'self'",
  // Restrict base URI
  "base-uri 'self'",
  // Block object/embed/applet
  "object-src 'none'",
].join('; ');

/**
 * Generate the admin UI HTML
 */
function generateAdminUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Olumi Prompt Admin</title>
  <!-- Alpine.js - pinned to specific version for security -->
  <script defer src="${ALPINE_CDN_URL}"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header {
      background: #1a1a2e;
      color: white;
      padding: 20px;
      margin-bottom: 20px;
    }
    header h1 { font-size: 1.5rem; }
    header p { color: #aaa; font-size: 0.9rem; }
    .card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 20px;
      margin-bottom: 20px;
    }
    .card h2 { margin-bottom: 15px; color: #1a1a2e; font-size: 1.2rem; }
    .btn {
      display: inline-block;
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.8; }
    .btn-primary { background: #4f46e5; color: white; }
    .btn-secondary { background: #6b7280; color: white; }
    .btn-danger { background: #dc2626; color: white; }
    .btn-sm { padding: 4px 8px; font-size: 0.8rem; }
    input, textarea, select {
      width: 100%;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 0.9rem;
      margin-bottom: 10px;
    }
    textarea { min-height: 200px; font-family: monospace; }
    label {
      display: block;
      margin-bottom: 5px;
      font-weight: 500;
      font-size: 0.9rem;
    }
    .form-group { margin-bottom: 15px; }
    table { width: 100%; border-collapse: collapse; }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th { background: #f9fafb; font-weight: 600; }
    .status {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .status-draft { background: #fef3c7; color: #92400e; }
    .status-staging { background: #dbeafe; color: #1e40af; }
    .status-production { background: #d1fae5; color: #065f46; }
    .status-archived { background: #f3f4f6; color: #6b7280; }
    .tabs {
      display: flex;
      border-bottom: 2px solid #e5e7eb;
      margin-bottom: 20px;
    }
    .tab {
      padding: 10px 20px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      font-weight: 500;
    }
    .tab.active { border-bottom-color: #4f46e5; color: #4f46e5; }
    .alert {
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 15px;
    }
    .alert-error { background: #fee2e2; color: #dc2626; }
    .alert-success { background: #d1fae5; color: #065f46; }
    .modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal-content {
      background: white;
      border-radius: 8px;
      padding: 20px;
      max-width: 800px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    .close { cursor: pointer; font-size: 1.5rem; color: #666; }
    .version-list { max-height: 200px; overflow-y: auto; }
    .version-item {
      padding: 10px;
      border: 1px solid #eee;
      border-radius: 4px;
      margin-bottom: 8px;
      cursor: pointer;
    }
    .version-item:hover { background: #f9fafb; }
    .version-item.active { border-color: #4f46e5; background: #eef2ff; }
    .flex { display: flex; gap: 10px; }
    .flex-1 { flex: 1; }
    .text-muted { color: #6b7280; font-size: 0.85rem; }
    .mt-2 { margin-top: 10px; }
    .mb-2 { margin-bottom: 10px; }
    /* Toast notifications */
    .toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 200;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .toast {
      padding: 12px 20px;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: slideIn 0.3s ease;
      max-width: 350px;
    }
    .toast-success { background: #065f46; color: white; }
    .toast-error { background: #dc2626; color: white; }
    .toast-warning { background: #d97706; color: white; }
    .toast-info { background: #1e40af; color: white; }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .btn-warning { background: #d97706; color: white; }
    pre {
      background: #f3f4f6;
      padding: 15px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.85rem;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    /* Test case styles */
    .test-case-item {
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      margin-bottom: 10px;
      background: #fafafa;
    }
    .test-case-item:hover {
      background: #f5f5f5;
      border-color: #d1d5db;
    }
    .test-result-pass { color: #059669; font-weight: 600; }
    .test-result-fail { color: #dc2626; font-weight: 600; }
    .test-result-pending { color: #6b7280; }
    /* Diff comparison styles */
    .diff-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .diff-panel {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      overflow: hidden;
    }
    .diff-panel-header {
      background: #f9fafb;
      padding: 10px 15px;
      border-bottom: 1px solid #e5e7eb;
      font-weight: 600;
    }
    .diff-panel-content {
      padding: 15px;
      max-height: 400px;
      overflow-y: auto;
      background: white;
    }
    .diff-panel-content pre {
      margin: 0;
      background: transparent;
      padding: 0;
    }
    .diff-stats {
      display: flex;
      gap: 20px;
      margin-bottom: 15px;
      padding: 10px;
      background: #f9fafb;
      border-radius: 6px;
    }
    .diff-stat {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .diff-stat-positive { color: #059669; }
    .diff-stat-negative { color: #dc2626; }
    .diff-stat-neutral { color: #6b7280; }
    @media (max-width: 768px) {
      .diff-container { grid-template-columns: 1fr; }
    }
    /* LLM Test Results Styles */
    .llm-results {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      margin-top: 12px;
      background: white;
    }
    .llm-results-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      border-radius: 8px 8px 0 0;
    }
    .llm-results-body {
      padding: 16px;
    }
    .llm-metric {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: #f3f4f6;
      border-radius: 4px;
      font-size: 0.85rem;
      margin-right: 8px;
      margin-bottom: 6px;
    }
    .llm-metric-label { color: #6b7280; }
    .llm-metric-value { font-weight: 600; color: #1f2937; }
    .llm-metric-good { background: #d1fae5; }
    .llm-metric-good .llm-metric-value { color: #065f46; }
    .llm-metric-warn { background: #fef3c7; }
    .llm-metric-warn .llm-metric-value { color: #92400e; }
    .llm-metric-bad { background: #fee2e2; }
    .llm-metric-bad .llm-metric-value { color: #dc2626; }
    .collapsible-section {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      margin-top: 12px;
      overflow: hidden;
    }
    .collapsible-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: #f9fafb;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.9rem;
    }
    .collapsible-header:hover { background: #f3f4f6; }
    .collapsible-content {
      padding: 12px;
      max-height: 300px;
      overflow-y: auto;
      border-top: 1px solid #e5e7eb;
    }
    .collapsible-content pre {
      margin: 0;
      font-size: 0.75rem;
      background: transparent;
      padding: 0;
      white-space: pre-wrap;
    }
    .repairs-list {
      margin: 0;
      padding-left: 20px;
    }
    .repairs-list li {
      font-size: 0.85rem;
      margin-bottom: 4px;
    }
    .stage-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: #f9fafb;
      border-radius: 4px;
      margin-bottom: 4px;
      font-size: 0.85rem;
    }
    .stage-name { font-weight: 500; }
    .stage-status { font-size: 0.75rem; padding: 2px 6px; border-radius: 3px; }
    .stage-status-success { background: #d1fae5; color: #065f46; }
    .stage-status-success_with_repairs { background: #fef3c7; color: #92400e; }
    .stage-status-failed { background: #fee2e2; color: #dc2626; }
    .stage-status-skipped { background: #f3f4f6; color: #6b7280; }
    /* Validation Issues Styles */
    .validation-issues-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .validation-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .validation-badge-error { background: #fee2e2; color: #dc2626; }
    .validation-badge-warning { background: #fef3c7; color: #d97706; }
    .validation-badge-info { background: #dbeafe; color: #2563eb; }
    .validation-filter {
      font-size: 0.75rem;
      padding: 4px 8px;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      background: white;
      cursor: pointer;
    }
    .validation-issue {
      padding: 10px 12px;
      margin-bottom: 8px;
      border-radius: 6px;
      border-left: 4px solid;
      font-size: 0.85rem;
    }
    .validation-issue.severity-error {
      border-left-color: #dc2626;
      background: #fef2f2;
    }
    .validation-issue.severity-warning {
      border-left-color: #d97706;
      background: #fffbeb;
    }
    .validation-issue.severity-info {
      border-left-color: #2563eb;
      background: #eff6ff;
    }
    .validation-issue-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .validation-issue-icon {
      font-weight: bold;
      font-size: 0.9rem;
    }
    .validation-issue-icon.error { color: #dc2626; }
    .validation-issue-icon.warning { color: #d97706; }
    .validation-issue-icon.info { color: #2563eb; }
    .validation-issue-code {
      font-family: monospace;
      font-size: 0.8rem;
      font-weight: 600;
      color: #374151;
    }
    .validation-issue-copy {
      margin-left: auto;
      padding: 2px 6px;
      font-size: 0.7rem;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 3px;
      cursor: pointer;
    }
    .validation-issue-copy:hover { background: #e5e7eb; }
    .validation-issue-message {
      color: #4b5563;
      margin-bottom: 4px;
    }
    .validation-issue-details {
      font-size: 0.75rem;
      color: #6b7280;
    }
    .validation-issue-suggestion {
      font-size: 0.75rem;
      color: #059669;
      margin-top: 4px;
    }
    .validation-issue-stage {
      font-size: 0.7rem;
      color: #9ca3af;
      margin-top: 4px;
    }
    .validation-regression { color: #dc2626; font-weight: 600; }
    .validation-improvement { color: #059669; font-weight: 600; }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #e5e7eb;
      border-top-color: #4f46e5;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .btn-llm {
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
    }
    .btn-llm:hover { opacity: 0.9; }
    .progress-bar {
      height: 4px;
      background: #e5e7eb;
      border-radius: 2px;
      overflow: hidden;
      margin-top: 8px;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #4f46e5, #8b5cf6);
      transition: width 0.3s ease;
    }
    .batch-summary {
      padding: 16px;
      background: #f9fafb;
      border-radius: 8px;
      margin-top: 12px;
    }
    .batch-summary-stat {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .batch-summary-stat:last-child { border-bottom: none; }
    .history-item {
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      margin-bottom: 8px;
      cursor: pointer;
    }
    .history-item:hover { background: #f9fafb; }
    .version-compare-results {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 16px;
    }
    @media (max-width: 768px) {
      .version-compare-results { grid-template-columns: 1fr; }
    }
    .compare-panel {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .compare-panel-header {
      padding: 10px 14px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      font-weight: 600;
    }
    .compare-panel-body { padding: 12px; }
    .compare-delta {
      font-size: 0.75rem;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 8px;
    }
    .compare-delta-better { background: #d1fae5; color: #065f46; }
    .compare-delta-worse { background: #fee2e2; color: #dc2626; }
    .compare-delta-same { background: #f3f4f6; color: #6b7280; }
  </style>
</head>
<body>
  <div x-data="promptAdmin()" x-init="init()">
    <!-- Toast Notifications -->
    <div class="toast-container">
      <template x-for="toast in toasts" :key="toast.id">
        <div class="toast" :class="'toast-' + toast.type" x-text="toast.message"></div>
      </template>
    </div>

    <header>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h1>Olumi Prompt Admin</h1>
          <p>Manage prompts, versions, and experiments</p>
        </div>
        <template x-if="authenticated">
          <button class="btn btn-secondary" @click="logout()" style="margin-left: auto;">Logout</button>
        </template>
      </div>
    </header>

    <div class="container">
      <!-- Auth -->
      <template x-if="!authenticated">
        <div class="card">
          <h2>Authentication Required</h2>
          <div class="form-group">
            <label>Admin API Key</label>
            <input type="password" x-model="apiKey" placeholder="Enter admin API key" @keyup.enter="authenticate()">
          </div>
          <button class="btn btn-primary" @click="authenticate()">Login</button>
          <template x-if="error">
            <div class="alert alert-error mt-2" x-text="error"></div>
          </template>
        </div>
      </template>

      <template x-if="authenticated">
        <div>
          <!-- Tabs -->
          <div class="tabs">
            <div class="tab" :class="{ active: tab === 'prompts' }" @click="tab = 'prompts'">Prompts</div>
            <div class="tab" :class="{ active: tab === 'testcases' }" @click="tab = 'testcases'; loadPrompts()">Test Cases</div>
            <div class="tab" :class="{ active: tab === 'experiments' }" @click="tab = 'experiments'">Experiments</div>
          </div>

          <!-- Alerts -->
          <template x-if="error">
            <div class="alert alert-error" x-text="error"></div>
          </template>
          <template x-if="success">
            <div class="alert alert-success" x-text="success"></div>
          </template>

          <!-- Prompts Tab -->
          <template x-if="tab === 'prompts'">
            <div>
              <div class="card">
                <div class="flex" style="justify-content: space-between; align-items: center;">
                  <h2>Prompts</h2>
                  <button class="btn btn-primary" @click="showCreateModal = true">+ New Prompt</button>
                </div>

                <div class="flex mt-2 mb-2">
                  <select x-model="filter.taskId" @change="loadPrompts()" style="width: auto;">
                    ${generateTaskFilterOptions()}
                  </select>
                  <select x-model="filter.status" @change="loadPrompts()" style="width: auto;">
                    <option value="">All Statuses</option>
                    <option value="draft">Draft</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <template x-if="loading">
                  <p class="text-muted">Loading...</p>
                </template>

                <template x-if="!loading && prompts.length === 0">
                  <p class="text-muted">No prompts found. Create one to get started.</p>
                </template>

                <template x-if="!loading && prompts.length > 0">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Task</th>
                        <th>Status</th>
                        <th>Active Version</th>
                        <th>Updated</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <template x-for="prompt in prompts" :key="prompt.id">
                        <tr>
                          <td x-text="prompt.id"></td>
                          <td x-text="prompt.taskId"></td>
                          <td>
                            <span class="status" :class="'status-' + prompt.status" x-text="prompt.status"></span>
                          </td>
                          <td x-text="'v' + prompt.activeVersion"></td>
                          <td x-text="formatDate(prompt.updatedAt)"></td>
                          <td>
                            <button class="btn btn-secondary btn-sm" @click="viewPrompt(prompt)">View</button>
                            <button class="btn btn-secondary btn-sm" @click="editPrompt(prompt)">Edit</button>
                          </td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </template>
              </div>
            </div>
          </template>

          <!-- Test Cases Tab -->
          <template x-if="tab === 'testcases'">
            <div>
              <div class="card">
                <div class="flex" style="justify-content: space-between; align-items: center;">
                  <h2>Test Cases</h2>
                </div>
                <p class="text-muted mt-2 mb-2">Manage golden tests for prompt versions. Select a prompt to view and edit its test cases. <em>Note: Test results (pass/fail) are session-local and not persisted.</em></p>

                <div class="form-group">
                  <label>Select Prompt</label>
                  <select x-model="selectedTestPromptId" @change="loadTestCasesForPrompt()">
                    <option value="">-- Select a prompt --</option>
                    <template x-for="prompt in prompts" :key="prompt.id">
                      <option :value="prompt.id" x-text="prompt.name + ' (' + prompt.id + ')'"></option>
                    </template>
                  </select>
                </div>

                <template x-if="selectedTestPromptId && selectedTestPrompt">
                  <div>
                    <div class="flex mb-2" style="justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                      <div>
                        <label>Version</label>
                        <select x-model="selectedTestVersionNum" @change="loadTestCasesForVersion()" style="width: auto; margin-left: 10px;">
                          <template x-for="v in selectedTestPrompt.versions" :key="v.version">
                            <option :value="v.version" x-text="'v' + v.version + (v.version === selectedTestPrompt.activeVersion ? ' (active)' : '')"></option>
                          </template>
                        </select>
                      </div>
                      <div class="flex" style="gap: 8px; flex-wrap: wrap;">
                        <button class="btn btn-primary btn-sm" @click="showTestCaseModal = true; resetTestCaseForm()">+ Add Test Case</button>
                        <template x-if="currentTestCases.length > 0">
                          <button class="btn btn-llm btn-sm" @click="runAllTestCasesWithLLM()" :disabled="llmBatchRunning || llmRateLimitCooldown > 0">
                            <template x-if="llmBatchRunning">
                              <span><span class="spinner"></span> Running...</span>
                            </template>
                            <template x-if="!llmBatchRunning && llmRateLimitCooldown > 0">
                              <span>Wait <span x-text="llmRateLimitCooldown"></span>s</span>
                            </template>
                            <template x-if="!llmBatchRunning && llmRateLimitCooldown === 0">
                              <span>Run All with LLM</span>
                            </template>
                          </button>
                        </template>
                        <button class="btn btn-secondary btn-sm" @click="openLLMCompareModal()">Compare Versions (LLM)</button>
                        <button class="btn btn-secondary btn-sm" @click="showHistoryModal = true; loadTestHistory()">History</button>
                      </div>

                      <!-- LLM Testing Options -->
                      <div class="mt-2" style="padding: 10px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <div class="flex" style="gap: 15px; flex-wrap: wrap; align-items: center;">
                          <div style="display: flex; align-items: center; gap: 6px;">
                            <label style="font-size: 0.85rem; font-weight: 500;">Model:</label>
                            <select x-model="llmModelOverride" style="padding: 4px 8px; font-size: 0.85rem; border-radius: 4px; border: 1px solid #d1d5db;" @focus="loadAvailableModels()">
                              <option value="">Default</option>
                              <template x-for="m in llmAvailableModels" :key="m.id">
                                <option :value="m.id" x-text="m.id + ' (' + m.provider + ')'"></option>
                              </template>
                            </select>
                          </div>
                          <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="checkbox" id="skipRepairs" x-model="llmSkipRepairs" style="width: 16px; height: 16px;">
                            <label for="skipRepairs" style="font-size: 0.85rem;">Skip repairs (raw LLM output)</label>
                          </div>
                          <template x-if="llmRateLimitCooldown > 0">
                            <div style="font-size: 0.85rem; color: #dc2626;">
                              Rate limit: <span x-text="llmRateLimitCooldown"></span>s remaining
                            </div>
                          </template>
                        </div>
                      </div>
                    </div>

                    <!-- Batch Progress -->
                    <template x-if="llmBatchRunning">
                      <div class="mt-2 mb-2">
                        <div class="text-muted" style="font-size: 0.85rem;">
                          Running test <span x-text="llmBatchProgress.current"></span> of <span x-text="llmBatchProgress.total"></span>...
                        </div>
                        <div class="progress-bar">
                          <div class="progress-bar-fill" :style="'width: ' + (llmBatchProgress.total > 0 ? (llmBatchProgress.current / llmBatchProgress.total * 100) : 0) + '%'"></div>
                        </div>
                      </div>
                    </template>

                    <!-- Batch Summary -->
                    <template x-if="llmBatchResults.length > 0 && !llmBatchRunning">
                      <div class="batch-summary">
                        <h4 style="margin-bottom: 10px;">Batch Results Summary</h4>
                        <div class="batch-summary-stat">
                          <span>Total Tests:</span>
                          <span x-text="llmBatchResults.length"></span>
                        </div>
                        <div class="batch-summary-stat">
                          <span>Passed:</span>
                          <span class="test-result-pass" x-text="llmBatchResults.filter(r => r.success).length"></span>
                        </div>
                        <div class="batch-summary-stat">
                          <span>Failed:</span>
                          <span class="test-result-fail" x-text="llmBatchResults.filter(r => !r.success).length"></span>
                        </div>
                        <div class="batch-summary-stat">
                          <span>Validation Issues:</span>
                          <span>
                            <span class="validation-badge validation-badge-error" x-text="'● ' + llmBatchResults.reduce((sum, r) => sum + (r.validationErrors || 0), 0)"></span>
                            <span class="validation-badge validation-badge-warning" x-text="'⚠ ' + llmBatchResults.reduce((sum, r) => sum + (r.validationWarnings || 0), 0)"></span>
                          </span>
                        </div>
                        <div class="batch-summary-stat">
                          <span>Avg Node Count:</span>
                          <span x-text="Math.round(llmBatchResults.filter(r => r.nodeCount).reduce((a, b) => a + b.nodeCount, 0) / llmBatchResults.filter(r => r.nodeCount).length) || 'N/A'"></span>
                        </div>
                        <div class="batch-summary-stat">
                          <span>Avg Latency:</span>
                          <span x-text="Math.round(llmBatchResults.filter(r => r.latencyMs).reduce((a, b) => a + b.latencyMs, 0) / llmBatchResults.filter(r => r.latencyMs).length) + 'ms' || 'N/A'"></span>
                        </div>
                        <div class="batch-summary-stat">
                          <span>Tests Requiring Repairs:</span>
                          <span x-text="llmBatchResults.filter(r => r.repairsApplied > 0).length"></span>
                        </div>
                        <button class="btn btn-secondary btn-sm mt-2" @click="llmBatchResults = []">Clear Summary</button>
                      </div>
                    </template>

                    <template x-if="currentTestCases.length === 0">
                      <p class="text-muted">No test cases for this version. Add one to get started.</p>
                    </template>

                    <template x-for="(tc, idx) in currentTestCases" :key="tc.id">
                      <div class="test-case-item">
                        <div class="flex" style="justify-content: space-between; align-items: flex-start;">
                          <div>
                            <strong x-text="tc.name"></strong>
                            <span class="text-muted" x-text="' (' + tc.id + ')'"></span>
                            <template x-if="tc.lastResult">
                              <span :class="'test-result-' + tc.lastResult" x-text="' [' + tc.lastResult.toUpperCase() + ']'"></span>
                            </template>
                            <template x-if="tc.llmResult">
                              <span :class="tc.llmResult.success ? 'test-result-pass' : 'test-result-fail'" x-text="' [LLM: ' + (tc.llmResult.success ? 'PASS' : 'FAIL') + ']'"></span>
                            </template>
                          </div>
                          <div class="flex" style="gap: 5px; flex-wrap: wrap;">
                            <button class="btn btn-secondary btn-sm" @click="runSingleTestCase(tc)">Run (Dry)</button>
                            <button class="btn btn-llm btn-sm" @click="runSingleTestCaseWithLLM(tc)" :disabled="tc.llmRunning">
                              <template x-if="tc.llmRunning">
                                <span><span class="spinner"></span></span>
                              </template>
                              <template x-if="!tc.llmRunning">
                                <span>Run with LLM</span>
                              </template>
                            </button>
                            <button class="btn btn-secondary btn-sm" @click="editTestCase(tc)">Edit</button>
                            <button class="btn btn-danger btn-sm" @click="deleteTestCase(idx)">Delete</button>
                          </div>
                        </div>
                        <div class="text-muted mt-2" style="font-size: 0.85rem;">
                          <strong>Input:</strong> <span x-text="tc.input.substring(0, 100) + (tc.input.length > 100 ? '...' : '')"></span>
                        </div>
                        <template x-if="tc.expectedOutput">
                          <div class="text-muted" style="font-size: 0.85rem;">
                            <strong>Expected:</strong> <span x-text="tc.expectedOutput.substring(0, 100) + (tc.expectedOutput.length > 100 ? '...' : '')"></span>
                          </div>
                        </template>
                        <!-- Dry-Run Test Output Display -->
                        <template x-if="tc.lastOutput">
                          <div class="mt-2" style="border-top: 1px solid #e5e7eb; padding-top: 8px;">
                            <div class="flex" style="justify-content: space-between; align-items: center;">
                              <strong style="font-size: 0.85rem;">Dry-Run Output:</strong>
                              <span class="text-muted" style="font-size: 0.75rem;" x-text="tc.lastOutput.timestamp"></span>
                            </div>
                            <template x-if="tc.lastOutput.error">
                              <div class="alert alert-error mt-2" style="padding: 8px; font-size: 0.85rem;" x-text="tc.lastOutput.error"></div>
                            </template>
                            <template x-if="tc.lastOutput.compiled">
                              <div class="mt-2">
                                <div class="text-muted" style="font-size: 0.8rem;">
                                  <span x-text="tc.lastOutput.charCount + ' chars'"></span>
                                  <template x-if="tc.lastOutput.validation && tc.lastOutput.validation.issues && tc.lastOutput.validation.issues.length > 0">
                                    <span class="test-result-fail" x-text="' | ' + tc.lastOutput.validation.issues.length + ' issue(s)'"></span>
                                  </template>
                                </div>
                                <pre style="max-height: 150px; overflow-y: auto; font-size: 0.75rem; margin-top: 5px; background: #f9fafb; padding: 8px; border-radius: 4px;" x-text="tc.lastOutput.compiled.substring(0, 500) + (tc.lastOutput.compiled.length > 500 ? '\\n... (truncated)' : '')"></pre>
                              </div>
                            </template>
                          </div>
                        </template>

                        <!-- LLM Test Results Display -->
                        <template x-if="tc.llmResult">
                          <div class="llm-results">
                            <div class="llm-results-header">
                              <div>
                                <strong>LLM Test Result</strong>
                                <span :class="tc.llmResult.success ? 'test-result-pass' : 'test-result-fail'" x-text="' — ' + (tc.llmResult.success ? 'PASSED' : 'FAILED')"></span>
                              </div>
                              <span class="text-muted" style="font-size: 0.75rem;" x-text="tc.llmResult.timestamp"></span>
                            </div>
                            <div class="llm-results-body">
                              <!-- Error Display -->
                              <template x-if="tc.llmResult.error">
                                <div class="alert alert-error" style="padding: 10px; font-size: 0.85rem;" x-text="tc.llmResult.error"></div>
                              </template>

                              <!-- Success Metrics -->
                              <template x-if="!tc.llmResult.error">
                                <div>
                                  <!-- Key Metrics -->
                                  <div style="margin-bottom: 12px;">
                                    <div class="llm-metric" :class="tc.llmResult.nodeCount >= 3 ? 'llm-metric-good' : 'llm-metric-warn'">
                                      <span class="llm-metric-label">Nodes:</span>
                                      <span class="llm-metric-value" x-text="tc.llmResult.nodeCount"></span>
                                    </div>
                                    <div class="llm-metric">
                                      <span class="llm-metric-label">Edges:</span>
                                      <span class="llm-metric-value" x-text="tc.llmResult.edgeCount"></span>
                                    </div>
                                    <div class="llm-metric" :class="tc.llmResult.repairsApplied === 0 ? 'llm-metric-good' : 'llm-metric-warn'">
                                      <span class="llm-metric-label">Repairs:</span>
                                      <span class="llm-metric-value" x-text="tc.llmResult.repairsApplied"></span>
                                    </div>
                                    <div class="llm-metric">
                                      <span class="llm-metric-label">Latency:</span>
                                      <span class="llm-metric-value" x-text="tc.llmResult.latencyMs + 'ms'"></span>
                                    </div>
                                    <template x-if="tc.llmResult.tokenUsage">
                                      <div class="llm-metric">
                                        <span class="llm-metric-label">Tokens:</span>
                                        <span class="llm-metric-value" x-text="tc.llmResult.tokenUsage.total"></span>
                                      </div>
                                    </template>
                                    <template x-if="tc.llmResult.model">
                                      <div class="llm-metric">
                                        <span class="llm-metric-label">Model:</span>
                                        <span class="llm-metric-value" x-text="tc.llmResult.model"></span>
                                      </div>
                                    </template>
                                  </div>

                                  <!-- Pipeline Stages -->
                                  <template x-if="tc.llmResult.stages && tc.llmResult.stages.length > 0">
                                    <div class="collapsible-section">
                                      <div class="collapsible-header" @click="tc.llmResult.showStages = !tc.llmResult.showStages">
                                        <span>Pipeline Stages (<span x-text="tc.llmResult.stages.length"></span>)</span>
                                        <span x-text="tc.llmResult.showStages ? '▼' : '▶'"></span>
                                      </div>
                                      <template x-if="tc.llmResult.showStages">
                                        <div class="collapsible-content">
                                          <template x-for="stage in tc.llmResult.stages" :key="stage.name">
                                            <div class="stage-item">
                                              <span class="stage-name" x-text="stage.name"></span>
                                              <div>
                                                <span class="stage-status" :class="'stage-status-' + stage.status" x-text="stage.status"></span>
                                                <span class="text-muted" style="font-size: 0.75rem; margin-left: 8px;" x-text="stage.duration_ms + 'ms'"></span>
                                              </div>
                                            </div>
                                          </template>
                                        </div>
                                      </template>
                                    </div>
                                  </template>

                                  <!-- Validation Issues -->
                                  <template x-if="tc.llmResult.fullResponse?.result?.validation?.issues?.length > 0">
                                    <div class="collapsible-section">
                                      <div class="collapsible-header" @click="tc.llmResult.showValidation = !tc.llmResult.showValidation" :class="tc.llmResult.fullResponse.result.validation.error_count > 0 ? 'validation-has-errors' : ''">
                                        <div class="validation-issues-header">
                                          <span>Validation Issues</span>
                                          <span class="validation-badge validation-badge-error" x-show="tc.llmResult.fullResponse.result.validation.error_count > 0">
                                            ● <span x-text="tc.llmResult.fullResponse.result.validation.error_count"></span>
                                          </span>
                                          <span class="validation-badge validation-badge-warning" x-show="tc.llmResult.fullResponse.result.validation.warning_count > 0">
                                            ⚠ <span x-text="tc.llmResult.fullResponse.result.validation.warning_count"></span>
                                          </span>
                                          <span class="validation-badge validation-badge-info" x-show="tc.llmResult.fullResponse.result.validation.info_count > 0">
                                            ℹ <span x-text="tc.llmResult.fullResponse.result.validation.info_count"></span>
                                          </span>
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 8px;">
                                          <select class="validation-filter" x-model="tc.llmResult.validationFilter" @click.stop>
                                            <option value="all">All</option>
                                            <option value="error">Errors</option>
                                            <option value="warning">Warnings</option>
                                            <option value="info">Info</option>
                                          </select>
                                          <span x-text="tc.llmResult.showValidation ? '▼' : '▶'"></span>
                                        </div>
                                      </div>
                                      <template x-if="tc.llmResult.showValidation">
                                        <div class="collapsible-content">
                                          <template x-for="issue in tc.llmResult.fullResponse.result.validation.issues.filter(i => (tc.llmResult.validationFilter || 'all') === 'all' || i.severity === tc.llmResult.validationFilter)" :key="issue.code + (issue.affected_node_id || '') + (issue.affected_edge_id || '')">
                                            <div class="validation-issue" :class="'severity-' + issue.severity">
                                              <div class="validation-issue-header">
                                                <span class="validation-issue-icon" :class="issue.severity" x-text="issue.severity === 'error' ? '●' : issue.severity === 'warning' ? '⚠' : 'ℹ'"></span>
                                                <span class="validation-issue-code" x-text="issue.code"></span>
                                                <button class="validation-issue-copy" @click="copyValidationIssue(issue)" title="Copy as JSON">Copy</button>
                                              </div>
                                              <div class="validation-issue-message" x-text="issue.message"></div>
                                              <template x-if="issue.affected_node_id || issue.affected_edge_id">
                                                <div class="validation-issue-details">
                                                  Affected: <span x-text="issue.affected_edge_id || issue.affected_node_id"></span>
                                                </div>
                                              </template>
                                              <template x-if="issue.suggestion">
                                                <div class="validation-issue-suggestion">
                                                  Fix: <span x-text="issue.suggestion"></span>
                                                </div>
                                              </template>
                                              <template x-if="issue.stage">
                                                <div class="validation-issue-stage">
                                                  Stage: <span x-text="issue.stage"></span>
                                                </div>
                                              </template>
                                            </div>
                                          </template>
                                        </div>
                                      </template>
                                    </div>
                                  </template>

                                  <!-- Raw Output -->
                                  <template x-if="tc.llmResult.rawOutputPreview || tc.llmResult.rawOutputFull">
                                    <div class="collapsible-section">
                                      <div class="collapsible-header" @click="tc.llmResult.showRaw = !tc.llmResult.showRaw">
                                        <span>Raw LLM Output</span>
                                        <span x-text="tc.llmResult.showRaw ? '▼' : '▶'"></span>
                                      </div>
                                      <template x-if="tc.llmResult.showRaw">
                                        <div class="collapsible-content">
                                          <div style="margin-bottom: 8px; display: flex; gap: 8px; align-items: center;">
                                            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                                              <input type="checkbox" x-model="tc.llmResult.showFullOutput" style="cursor: pointer;">
                                              <span>Show Full Output</span>
                                            </label>
                                            <template x-if="tc.llmResult.rawOutputFull">
                                              <span style="color: #6b7280; font-size: 0.85rem;" x-text="'(' + tc.llmResult.rawOutputFull.length + ' chars)'"></span>
                                            </template>
                                            <button class="btn btn-secondary btn-sm" @click="navigator.clipboard.writeText(tc.llmResult.rawOutputFull || tc.llmResult.rawOutputPreview); $dispatch('toast', {message: 'Copied to clipboard', type: 'success'})" style="margin-left: auto;">Copy</button>
                                          </div>
                                          <pre style="max-height: 500px; overflow: auto;" x-text="tc.llmResult.showFullOutput ? tc.llmResult.rawOutputFull : tc.llmResult.rawOutputPreview"></pre>
                                        </div>
                                      </template>
                                    </div>
                                  </template>

                                  <!-- Full Trace -->
                                  <template x-if="tc.llmResult.fullTrace">
                                    <div class="collapsible-section">
                                      <div class="collapsible-header" @click="tc.llmResult.showTrace = !tc.llmResult.showTrace">
                                        <span>Full Trace</span>
                                        <span x-text="tc.llmResult.showTrace ? '▼' : '▶'"></span>
                                      </div>
                                      <template x-if="tc.llmResult.showTrace">
                                        <div class="collapsible-content">
                                          <pre x-text="JSON.stringify(tc.llmResult.fullTrace, null, 2)"></pre>
                                        </div>
                                      </template>
                                    </div>
                                  </template>

                                  <!-- Graph Summary -->
                                  <template x-if="tc.llmResult.graphSummary">
                                    <div class="collapsible-section">
                                      <div class="collapsible-header" @click="tc.llmResult.showGraph = !tc.llmResult.showGraph">
                                        <span>Validated Graph</span>
                                        <span x-text="tc.llmResult.showGraph ? '▼' : '▶'"></span>
                                      </div>
                                      <template x-if="tc.llmResult.showGraph">
                                        <div class="collapsible-content">
                                          <pre x-text="JSON.stringify(tc.llmResult.graphSummary, null, 2)"></pre>
                                        </div>
                                      </template>
                                    </div>
                                  </template>
                                </div>
                              </template>
                            </div>
                          </div>
                        </template>
                      </div>
                    </template>
                  </div>
                </template>
              </div>
            </div>
          </template>

          <!-- Experiments Tab -->
          <template x-if="tab === 'experiments'">
            <div class="card">
              <div class="flex" style="justify-content: space-between; align-items: center;">
                <h2>A/B Experiments</h2>
                <button class="btn btn-primary" @click="showExperimentModal = true">+ New Experiment</button>
              </div>
              <p class="text-muted mt-2">Experiments are tracked locally and optionally in Braintrust.</p>
            </div>
          </template>
        </div>
      </template>

      <!-- Create Prompt Modal -->
      <template x-if="showCreateModal">
        <div class="modal" @click.self="showCreateModal = false">
          <div class="modal-content">
            <div class="modal-header">
              <h2>Create New Prompt</h2>
              <span class="close" @click="showCreateModal = false">&times;</span>
            </div>

            <div class="form-group">
              <label>ID (e.g., draft_graph_system_v1)</label>
              <input type="text" x-model="newPrompt.id" placeholder="lowercase-with-dashes">
            </div>

            <div class="form-group">
              <label>Name</label>
              <input type="text" x-model="newPrompt.name" placeholder="Human-readable name">
            </div>

            <div class="form-group">
              <label>Task</label>
              <select x-model="newPrompt.taskId">
                ${generateTaskOptions()}
              </select>
            </div>

            <div class="form-group">
              <label>Content</label>
              <textarea x-model="newPrompt.content" placeholder="Prompt content with {{variables}}"></textarea>
            </div>

            <div class="form-group">
              <label>Change Note (optional)</label>
              <input type="text" x-model="newPrompt.changeNote" placeholder="Initial version">
            </div>

            <div class="flex">
              <button class="btn btn-secondary" @click="showCreateModal = false">Cancel</button>
              <button class="btn btn-primary" @click="createPrompt()">Create Prompt</button>
            </div>
          </div>
        </div>
      </template>

      <!-- View/Edit Prompt Modal -->
      <template x-if="selectedPrompt">
        <div class="modal" @click.self="selectedPrompt = null">
          <div class="modal-content">
            <div class="modal-header">
              <h2 x-text="selectedPrompt.name"></h2>
              <span class="close" @click="selectedPrompt = null">&times;</span>
            </div>

            <div class="flex">
              <div class="flex-1">
                <p class="text-muted">ID: <span x-text="selectedPrompt.id"></span></p>
                <p class="text-muted">Task: <span x-text="selectedPrompt.taskId"></span></p>
                <p class="text-muted">Status:
                  <span class="status" :class="'status-' + selectedPrompt.status" x-text="selectedPrompt.status"></span>
                </p>
              </div>
              <div>
                <select x-model="selectedPrompt.status" @change="updatePromptStatus()">
                  <option value="draft">Draft</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            <h3 class="mt-2 mb-2">Versions</h3>
            <div class="version-list">
              <template x-for="version in selectedPrompt.versions.slice().reverse()" :key="version.version">
                <div class="version-item" :class="{ active: version.version === selectedVersionNum }"
                     @click="selectVersion(version.version)">
                  <div class="flex" style="justify-content: space-between;">
                    <strong x-text="'v' + version.version"></strong>
                    <span class="text-muted" x-text="formatDate(version.createdAt)"></span>
                  </div>
                  <div class="text-muted" x-text="version.changeNote || 'No change note'"></div>
                  <div class="text-muted" x-text="'by ' + version.createdBy"></div>
                  <div class="flex" style="gap: 5px; margin-top: 5px; flex-wrap: wrap;">
                    <template x-if="version.version === selectedPrompt.activeVersion">
                      <span class="status status-production">Active</span>
                    </template>
                    <template x-if="version.requiresApproval && version.approvedBy">
                      <span class="status status-production" x-text="'Approved by ' + version.approvedBy"></span>
                    </template>
                    <template x-if="version.requiresApproval && !version.approvedBy">
                      <span class="status status-draft">Needs Approval</span>
                    </template>
                  </div>
                </div>
              </template>
            </div>

            <h3 class="mt-2 mb-2">Content (v<span x-text="selectedVersionNum"></span>)</h3>
            <pre x-text="getVersionContent(selectedVersionNum)"></pre>

            <div class="flex mt-2" style="flex-wrap: wrap;">
              <button class="btn btn-secondary" @click="openNewVersionWithContent()">+ New Version</button>
              <template x-if="selectedPrompt.versions.length >= 2">
                <button class="btn btn-secondary" @click="openCompareModal()">Compare Versions</button>
              </template>
              <template x-if="selectedVersionNum !== selectedPrompt.activeVersion">
                <button class="btn btn-warning" @click="rollbackToVersion()">
                  Rollback to v<span x-text="selectedVersionNum"></span>
                </button>
              </template>
              <template x-if="getSelectedVersion()?.requiresApproval && !getSelectedVersion()?.approvedBy">
                <button class="btn btn-primary" @click="approveSelectedVersion()">
                  Approve v<span x-text="selectedVersionNum"></span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </template>

      <!-- New Version Modal -->
      <template x-if="showNewVersionModal">
        <div class="modal" @click.self="showNewVersionModal = false">
          <div class="modal-content">
            <div class="modal-header">
              <h2>Create New Version</h2>
              <span class="close" @click="showNewVersionModal = false">&times;</span>
            </div>

            <div class="form-group">
              <label>Content</label>
              <textarea x-model="newVersion.content"></textarea>
            </div>

            <div class="form-group">
              <label>Change Note</label>
              <input type="text" x-model="newVersion.changeNote" placeholder="What changed?">
            </div>

            <div class="flex">
              <button class="btn btn-secondary" @click="showNewVersionModal = false">Cancel</button>
              <button class="btn btn-primary" @click="createVersion()">Create Version</button>
            </div>
          </div>
        </div>
      </template>

      <!-- Approval Modal -->
      <template x-if="showApprovalModal && pendingApproval">
        <div class="modal" @click.self="showApprovalModal = false; pendingApproval = null;">
          <div class="modal-content">
            <div class="modal-header">
              <h2>Approval Required</h2>
              <span class="close" @click="showApprovalModal = false; pendingApproval = null;">&times;</span>
            </div>

            <div class="alert alert-warning" style="background: #fef3c7; color: #92400e; margin-bottom: 15px;">
              <strong>This version requires approval before promotion to production.</strong>
              <p class="mt-2">Version <span x-text="pendingApproval.version"></span> of prompt "<span x-text="pendingApproval.promptId"></span>" is flagged as requiring approval.</p>
            </div>

            <p class="text-muted mb-2">By approving, you confirm that this prompt version has been reviewed and is safe for production use.</p>

            <div class="flex">
              <button class="btn btn-secondary" @click="showApprovalModal = false; pendingApproval = null;">Cancel</button>
              <button class="btn btn-primary" @click="approveVersion()">Approve for Production</button>
            </div>
          </div>
        </div>
      </template>

      <!-- Test Case Modal -->
      <template x-if="showTestCaseModal">
        <div class="modal" @click.self="showTestCaseModal = false">
          <div class="modal-content">
            <div class="modal-header">
              <h2 x-text="editingTestCase ? 'Edit Test Case' : 'Add Test Case'"></h2>
              <span class="close" @click="showTestCaseModal = false">&times;</span>
            </div>

            <div class="form-group">
              <label>Test ID</label>
              <input type="text" x-model="testCaseForm.id" placeholder="unique-test-id" :disabled="editingTestCase">
            </div>

            <div class="form-group">
              <label>Name</label>
              <input type="text" x-model="testCaseForm.name" placeholder="Human-readable test name">
            </div>

            <div class="form-group">
              <label>Input (Brief)</label>
              <textarea x-model="testCaseForm.input" placeholder="Test input/brief content" style="min-height: 100px;"></textarea>
            </div>

            <div class="form-group">
              <label>Expected Output (optional)</label>
              <textarea x-model="testCaseForm.expectedOutput" placeholder="Expected patterns or keywords in output" style="min-height: 80px;"></textarea>
            </div>

            <div class="form-group">
              <label>Variables (JSON, optional)</label>
              <input type="text" x-model="testCaseForm.variablesJson" placeholder='{"maxNodes": 50, "maxEdges": 200}'>
            </div>

            <div class="flex">
              <button class="btn btn-secondary" @click="showTestCaseModal = false">Cancel</button>
              <button class="btn btn-primary" @click="saveTestCase()" x-text="editingTestCase ? 'Update Test Case' : 'Add Test Case'"></button>
            </div>
          </div>
        </div>
      </template>

      <!-- Compare Modal -->
      <template x-if="showCompareModal && selectedPrompt">
        <div class="modal" @click.self="showCompareModal = false">
          <div class="modal-content" style="max-width: 1000px;">
            <div class="modal-header">
              <h2>Compare Versions</h2>
              <span class="close" @click="showCompareModal = false">&times;</span>
            </div>

            <div class="flex mb-2" style="gap: 20px;">
              <div class="form-group flex-1">
                <label>Version A</label>
                <select x-model="compareVersionA" @change="loadComparison()">
                  <template x-for="v in selectedPrompt.versions" :key="v.version">
                    <option :value="v.version" x-text="'v' + v.version + (v.version === selectedPrompt.activeVersion ? ' (active)' : '')"></option>
                  </template>
                </select>
              </div>
              <div class="form-group flex-1">
                <label>Version B</label>
                <select x-model="compareVersionB" @change="loadComparison()">
                  <template x-for="v in selectedPrompt.versions" :key="v.version">
                    <option :value="v.version" x-text="'v' + v.version + (v.version === selectedPrompt.activeVersion ? ' (active)' : '')"></option>
                  </template>
                </select>
              </div>
            </div>

            <template x-if="comparisonData">
              <div>
                <div class="diff-stats">
                  <div class="diff-stat">
                    <span>Lines:</span>
                    <span :class="comparisonData.changes.linesDelta > 0 ? 'diff-stat-positive' : (comparisonData.changes.linesDelta < 0 ? 'diff-stat-negative' : 'diff-stat-neutral')"
                          x-text="(comparisonData.changes.linesDelta > 0 ? '+' : '') + comparisonData.changes.linesDelta"></span>
                  </div>
                  <div class="diff-stat">
                    <span>Characters:</span>
                    <span :class="comparisonData.changes.charsDelta > 0 ? 'diff-stat-positive' : (comparisonData.changes.charsDelta < 0 ? 'diff-stat-negative' : 'diff-stat-neutral')"
                          x-text="(comparisonData.changes.charsDelta > 0 ? '+' : '') + comparisonData.changes.charsDelta"></span>
                  </div>
                </div>

                <div class="diff-container">
                  <div class="diff-panel">
                    <div class="diff-panel-header">
                      Version <span x-text="comparisonData.versionA.version"></span>
                      <span class="text-muted" x-text="' (' + comparisonData.versionA.lineCount + ' lines)'"></span>
                    </div>
                    <div class="diff-panel-content">
                      <pre x-text="comparisonData.contentA"></pre>
                    </div>
                  </div>
                  <div class="diff-panel">
                    <div class="diff-panel-header">
                      Version <span x-text="comparisonData.versionB.version"></span>
                      <span class="text-muted" x-text="' (' + comparisonData.versionB.lineCount + ' lines)'"></span>
                    </div>
                    <div class="diff-panel-content">
                      <pre x-text="comparisonData.contentB"></pre>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <div class="flex mt-2">
              <button class="btn btn-secondary" @click="showCompareModal = false">Close</button>
            </div>
          </div>
        </div>
      </template>

      <!-- LLM Compare Modal -->
      <template x-if="showLLMCompareModal && selectedTestPrompt">
        <div class="modal" @click.self="showLLMCompareModal = false">
          <div class="modal-content" style="max-width: 1200px;">
            <div class="modal-header">
              <h2>Compare Prompt Versions with LLM</h2>
              <span class="close" @click="showLLMCompareModal = false">&times;</span>
            </div>

            <!-- Rate limit indicator -->
            <template x-if="llmRateLimitCooldown > 0">
              <div class="alert alert-warning" style="margin-bottom: 16px; padding: 12px;">
                <strong>Rate limit active:</strong> Please wait <span x-text="llmRateLimitCooldown"></span> seconds before running more tests.
              </div>
            </template>

            <div class="flex mb-2" style="gap: 20px; flex-wrap: wrap;">
              <div class="form-group flex-1">
                <label>Version A</label>
                <select x-model="llmCompareVersionA">
                  <template x-for="v in selectedTestPrompt.versions" :key="v.version">
                    <option :value="v.version" x-text="'v' + v.version + (v.version === selectedTestPrompt.activeVersion ? ' (active)' : '')"></option>
                  </template>
                </select>
              </div>
              <div class="form-group flex-1">
                <label>Version B</label>
                <select x-model="llmCompareVersionB">
                  <template x-for="v in selectedTestPrompt.versions" :key="v.version">
                    <option :value="v.version" x-text="'v' + v.version + (v.version === selectedTestPrompt.activeVersion ? ' (active)' : '')"></option>
                  </template>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Test Brief</label>
              <textarea x-model="llmCompareBrief" placeholder="Enter a test brief to run against both versions" style="min-height: 100px;"></textarea>
            </div>

            <div class="flex mb-2" style="gap: 10px;">
              <button class="btn btn-llm" @click="runLLMComparison()" :disabled="llmCompareRunning || !llmCompareBrief || llmCompareVersionA === llmCompareVersionB || llmRateLimitCooldown > 0">
                <template x-if="llmCompareRunning">
                  <span><span class="spinner"></span> Running comparison...</span>
                </template>
                <template x-if="!llmCompareRunning && llmRateLimitCooldown > 0">
                  <span>Wait <span x-text="llmRateLimitCooldown"></span>s</span>
                </template>
                <template x-if="!llmCompareRunning && llmRateLimitCooldown === 0">
                  <span>Run Comparison</span>
                </template>
              </button>
            </div>

            <template x-if="llmCompareResults">
              <div>
                <!-- Prompt Hash Comparison -->
                <div class="mb-2" style="padding: 10px; background: #f0fdf4; border: 1px solid #22c55e; border-radius: 6px;">
                  <template x-if="llmCompareResults.promptsAreDifferent">
                    <div style="color: #166534;">
                      <strong>&#10003; Different prompt versions confirmed</strong> - Content hashes are different.
                    </div>
                  </template>
                  <template x-if="!llmCompareResults.promptsAreDifferent">
                    <div style="color: #dc2626;">
                      <strong>&#10007; Warning:</strong> Same prompt hash for both versions - versions may have identical content.
                    </div>
                  </template>
                </div>

                <div class="version-compare-results">
                  <!-- Version A Results -->
                  <div class="compare-panel">
                    <div class="compare-panel-header">
                      Version <span x-text="llmCompareResults.versionA.versionNum || llmCompareVersionA"></span>
                      <template x-if="llmCompareResults.versionA.success">
                        <span class="test-result-pass"> (Success)</span>
                      </template>
                      <template x-if="!llmCompareResults.versionA.success">
                        <span class="test-result-fail"> (Failed)</span>
                      </template>
                    </div>
                    <div class="compare-panel-body">
                      <template x-if="llmCompareResults.versionA.error">
                        <div class="alert alert-error" x-text="llmCompareResults.versionA.error"></div>
                      </template>
                      <template x-if="!llmCompareResults.versionA.error">
                        <div>
                          <div class="llm-metric" style="margin-bottom: 8px;">
                            <span class="llm-metric-label">Prompt Hash:</span>
                            <span class="llm-metric-value" style="font-family: monospace; font-size: 0.75rem;" x-text="(llmCompareResults.versionA.promptHash || '').substring(0, 12) + '...'"></span>
                          </div>
                          <template x-if="llmCompareResults.versionA.model">
                            <div class="llm-metric">
                              <span class="llm-metric-label">Model:</span>
                              <span class="llm-metric-value" x-text="llmCompareResults.versionA.model"></span>
                            </div>
                          </template>
                          <div class="llm-metric">
                            <span class="llm-metric-label">Nodes:</span>
                            <span class="llm-metric-value" x-text="llmCompareResults.versionA.nodeCount"></span>
                          </div>
                          <div class="llm-metric">
                            <span class="llm-metric-label">Edges:</span>
                            <span class="llm-metric-value" x-text="llmCompareResults.versionA.edgeCount"></span>
                          </div>
                          <div class="llm-metric">
                            <span class="llm-metric-label">Repairs:</span>
                            <span class="llm-metric-value" x-text="llmCompareResults.versionA.repairsApplied"></span>
                          </div>
                          <div class="llm-metric">
                            <span class="llm-metric-label">Latency:</span>
                            <span class="llm-metric-value" x-text="llmCompareResults.versionA.latencyMs + 'ms'"></span>
                          </div>
                          <template x-if="llmCompareResults.versionA.tokenUsage">
                            <div class="llm-metric">
                              <span class="llm-metric-label">Tokens:</span>
                              <span class="llm-metric-value" x-text="llmCompareResults.versionA.tokenUsage.total"></span>
                            </div>
                          </template>
                          <div class="llm-metric">
                            <span class="llm-metric-label">Validation:</span>
                            <span>
                              <span class="validation-badge validation-badge-error" x-text="'● ' + (llmCompareResults.versionA.validationErrors || 0)"></span>
                              <span class="validation-badge validation-badge-warning" x-text="'⚠ ' + (llmCompareResults.versionA.validationWarnings || 0)"></span>
                            </span>
                          </div>
                          <!-- Expandable validation issues -->
                          <template x-if="llmCompareResults.versionA.validationIssues?.length > 0">
                            <div class="collapsible-section" style="margin-top: 8px;">
                              <div class="collapsible-header" @click="llmCompareResults.versionA.showValidation = !llmCompareResults.versionA.showValidation" style="cursor: pointer; padding: 4px 8px; background: #f3f4f6; border-radius: 4px;">
                                <span x-text="llmCompareResults.versionA.showValidation ? '▼' : '▶'"></span>
                                <span style="margin-left: 4px;">Show Issues</span>
                              </div>
                              <template x-if="llmCompareResults.versionA.showValidation">
                                <div style="margin-top: 8px; font-size: 0.85rem;">
                                  <template x-for="issue in llmCompareResults.versionA.validationIssues" :key="issue.code + (issue.affected_node_id || '')">
                                    <div class="validation-issue" :class="'severity-' + issue.severity" style="padding: 6px; margin-bottom: 4px; border-left: 3px solid; border-radius: 2px;">
                                      <div style="font-weight: 600;"><span x-text="issue.severity === 'error' ? '●' : '⚠'"></span> <span x-text="issue.code"></span></div>
                                      <div x-text="issue.message" style="margin-top: 2px;"></div>
                                      <template x-if="issue.suggestion">
                                        <div style="color: #059669; margin-top: 2px;">Fix: <span x-text="issue.suggestion"></span></div>
                                      </template>
                                    </div>
                                  </template>
                                </div>
                              </template>
                            </div>
                          </template>
                        </div>
                      </template>
                    </div>
                  </div>

                  <!-- Version B Results -->
                  <div class="compare-panel">
                    <div class="compare-panel-header">
                      Version <span x-text="llmCompareResults.versionB.versionNum || llmCompareVersionB"></span>
                      <template x-if="llmCompareResults.versionB.success">
                        <span class="test-result-pass"> (Success)</span>
                      </template>
                      <template x-if="!llmCompareResults.versionB.success">
                        <span class="test-result-fail"> (Failed)</span>
                      </template>
                    </div>
                    <div class="compare-panel-body">
                      <template x-if="llmCompareResults.versionB.error">
                        <div class="alert alert-error" x-text="llmCompareResults.versionB.error"></div>
                      </template>
                      <template x-if="!llmCompareResults.versionB.error">
                        <div>
                          <div class="llm-metric" style="margin-bottom: 8px;">
                            <span class="llm-metric-label">Prompt Hash:</span>
                            <span class="llm-metric-value" style="font-family: monospace; font-size: 0.75rem;" x-text="(llmCompareResults.versionB.promptHash || '').substring(0, 12) + '...'"></span>
                          </div>
                          <template x-if="llmCompareResults.versionB.model">
                            <div class="llm-metric">
                              <span class="llm-metric-label">Model:</span>
                              <span class="llm-metric-value" x-text="llmCompareResults.versionB.model"></span>
                            </div>
                          </template>
                          <div class="llm-metric">
                            <span class="llm-metric-label">Nodes:</span>
                            <span class="llm-metric-value" x-text="llmCompareResults.versionB.nodeCount"></span>
                            <template x-if="llmCompareResults.deltas.nodeCount !== 0">
                              <span class="compare-delta" :class="llmCompareResults.deltas.nodeCount > 0 ? 'compare-delta-better' : 'compare-delta-worse'" x-text="(llmCompareResults.deltas.nodeCount > 0 ? '+' : '') + llmCompareResults.deltas.nodeCount"></span>
                            </template>
                          </div>
                          <div class="llm-metric">
                            <span class="llm-metric-label">Edges:</span>
                            <span class="llm-metric-value" x-text="llmCompareResults.versionB.edgeCount"></span>
                            <template x-if="llmCompareResults.deltas.edgeCount !== 0">
                              <span class="compare-delta" :class="llmCompareResults.deltas.edgeCount > 0 ? 'compare-delta-better' : 'compare-delta-worse'" x-text="(llmCompareResults.deltas.edgeCount > 0 ? '+' : '') + llmCompareResults.deltas.edgeCount"></span>
                            </template>
                          </div>
                          <div class="llm-metric">
                            <span class="llm-metric-label">Repairs:</span>
                            <span class="llm-metric-value" x-text="llmCompareResults.versionB.repairsApplied"></span>
                            <template x-if="llmCompareResults.deltas.repairs !== 0">
                              <span class="compare-delta" :class="llmCompareResults.deltas.repairs < 0 ? 'compare-delta-better' : 'compare-delta-worse'" x-text="(llmCompareResults.deltas.repairs > 0 ? '+' : '') + llmCompareResults.deltas.repairs"></span>
                            </template>
                          </div>
                          <div class="llm-metric">
                            <span class="llm-metric-label">Latency:</span>
                            <span class="llm-metric-value" x-text="llmCompareResults.versionB.latencyMs + 'ms'"></span>
                            <template x-if="llmCompareResults.deltas.latency !== 0">
                              <span class="compare-delta" :class="llmCompareResults.deltas.latency < 0 ? 'compare-delta-better' : 'compare-delta-worse'" x-text="(llmCompareResults.deltas.latency > 0 ? '+' : '') + llmCompareResults.deltas.latency + 'ms'"></span>
                            </template>
                          </div>
                          <template x-if="llmCompareResults.versionB.tokenUsage">
                            <div class="llm-metric">
                              <span class="llm-metric-label">Tokens:</span>
                              <span class="llm-metric-value" x-text="llmCompareResults.versionB.tokenUsage.total"></span>
                              <template x-if="llmCompareResults.deltas.tokens !== 0">
                                <span class="compare-delta" :class="llmCompareResults.deltas.tokens < 0 ? 'compare-delta-better' : 'compare-delta-worse'" x-text="(llmCompareResults.deltas.tokens > 0 ? '+' : '') + llmCompareResults.deltas.tokens"></span>
                              </template>
                            </div>
                          </template>
                          <div class="llm-metric">
                            <span class="llm-metric-label">Validation:</span>
                            <span>
                              <span class="validation-badge validation-badge-error" x-text="'● ' + (llmCompareResults.versionB.validationErrors || 0)"></span>
                              <span class="validation-badge validation-badge-warning" x-text="'⚠ ' + (llmCompareResults.versionB.validationWarnings || 0)"></span>
                              <template x-if="llmCompareResults.deltas?.validationErrors !== 0">
                                <span :class="llmCompareResults.deltas?.validationErrors > 0 ? 'validation-regression' : 'validation-improvement'"
                                  x-text="(llmCompareResults.deltas?.validationErrors > 0 ? '▲ ' : '▼ ') + Math.abs(llmCompareResults.deltas?.validationErrors || 0) + ' errors'">
                                </span>
                              </template>
                            </span>
                          </div>
                          <!-- Expandable validation issues -->
                          <template x-if="llmCompareResults.versionB.validationIssues?.length > 0">
                            <div class="collapsible-section" style="margin-top: 8px;">
                              <div class="collapsible-header" @click="llmCompareResults.versionB.showValidation = !llmCompareResults.versionB.showValidation" style="cursor: pointer; padding: 4px 8px; background: #f3f4f6; border-radius: 4px;">
                                <span x-text="llmCompareResults.versionB.showValidation ? '▼' : '▶'"></span>
                                <span style="margin-left: 4px;">Show Issues</span>
                              </div>
                              <template x-if="llmCompareResults.versionB.showValidation">
                                <div style="margin-top: 8px; font-size: 0.85rem;">
                                  <template x-for="issue in llmCompareResults.versionB.validationIssues" :key="issue.code + (issue.affected_node_id || '')">
                                    <div class="validation-issue" :class="'severity-' + issue.severity" style="padding: 6px; margin-bottom: 4px; border-left: 3px solid; border-radius: 2px;">
                                      <div style="font-weight: 600;"><span x-text="issue.severity === 'error' ? '●' : '⚠'"></span> <span x-text="issue.code"></span></div>
                                      <div x-text="issue.message" style="margin-top: 2px;"></div>
                                      <template x-if="issue.suggestion">
                                        <div style="color: #059669; margin-top: 2px;">Fix: <span x-text="issue.suggestion"></span></div>
                                      </template>
                                    </div>
                                  </template>
                                </div>
                              </template>
                            </div>
                          </template>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <div class="flex mt-2">
              <button class="btn btn-secondary" @click="showLLMCompareModal = false">Close</button>
            </div>
          </div>
        </div>
      </template>

      <!-- History Modal -->
      <template x-if="showHistoryModal">
        <div class="modal" @click.self="showHistoryModal = false">
          <div class="modal-content" style="max-width: 800px;">
            <div class="modal-header">
              <h2>Test History</h2>
              <span class="close" @click="showHistoryModal = false">&times;</span>
            </div>

            <template x-if="testHistory.length === 0">
              <p class="text-muted">No test history available. Run some LLM tests to see history.</p>
            </template>

            <template x-if="testHistory.length > 0">
              <div>
                <div class="batch-summary mb-2">
                  <div class="batch-summary-stat">
                    <span>Total Tests:</span>
                    <span x-text="testHistory.length"></span>
                  </div>
                  <div class="batch-summary-stat">
                    <span>Pass Rate:</span>
                    <span x-text="Math.round(testHistory.filter(h => h.success).length / testHistory.length * 100) + '%'"></span>
                  </div>
                  <div class="batch-summary-stat">
                    <span>Avg Latency:</span>
                    <span x-text="Math.round(testHistory.filter(h => h.latencyMs).reduce((a, b) => a + b.latencyMs, 0) / testHistory.filter(h => h.latencyMs).length) + 'ms' || 'N/A'"></span>
                  </div>
                </div>

                <div style="max-height: 400px; overflow-y: auto;">
                  <template x-for="(item, idx) in testHistory.slice().reverse()" :key="idx">
                    <div class="history-item">
                      <div class="flex" style="justify-content: space-between; align-items: center;">
                        <div>
                          <strong x-text="item.testName"></strong>
                          <span :class="item.success ? 'test-result-pass' : 'test-result-fail'" x-text="' [' + (item.success ? 'PASS' : 'FAIL') + ']'"></span>
                        </div>
                        <span class="text-muted" style="font-size: 0.75rem;" x-text="item.timestamp"></span>
                      </div>
                      <div class="text-muted" style="font-size: 0.85rem; margin-top: 4px;">
                        <span x-text="'v' + item.version"></span> |
                        <span x-text="item.nodeCount + ' nodes'"></span> |
                        <span x-text="item.latencyMs + 'ms'"></span>
                        <template x-if="item.repairsApplied > 0">
                          <span x-text="' | ' + item.repairsApplied + ' repairs'"></span>
                        </template>
                      </div>
                    </div>
                  </template>
                </div>

                <div class="flex mt-2">
                  <button class="btn btn-secondary btn-sm" @click="clearTestHistory()">Clear History</button>
                </div>
              </div>
            </template>

            <div class="flex mt-2">
              <button class="btn btn-secondary" @click="showHistoryModal = false">Close</button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <script>
    function promptAdmin() {
      return {
        // Auth
        authenticated: false,
        apiKey: '',

        // UI state
        tab: 'prompts',
        loading: false,
        error: null,
        success: null,
        toasts: [],
        toastId: 0,

        // Prompts
        prompts: [],
        filter: { taskId: '', status: '' },
        selectedPrompt: null,
        selectedVersionNum: 1,
        showCreateModal: false,
        showNewVersionModal: false,
        showExperimentModal: false,
        showApprovalModal: false,
        pendingApproval: null,

        // Test case management
        showTestCaseModal: false,
        selectedTestPromptId: '',
        selectedTestPrompt: null,
        selectedTestVersionNum: 1,
        currentTestCases: [],
        editingTestCase: null,
        testCaseForm: {
          id: '',
          name: '',
          input: '',
          expectedOutput: '',
          variablesJson: '{}',
        },

        // Compare versions
        showCompareModal: false,
        compareVersionA: 1,
        compareVersionB: 1,
        comparisonData: null,

        // LLM Testing
        llmTestRunning: false,
        llmBatchRunning: false,
        llmBatchProgress: { current: 0, total: 0 },
        llmBatchResults: [],
        showLLMCompareModal: false,
        llmCompareVersionA: 1,
        llmCompareVersionB: 1,
        llmCompareBrief: '',
        llmCompareRunning: false,
        llmCompareResults: null,
        testHistory: [],
        showHistoryModal: false,
        // LLM Testing options
        llmModelOverride: '',
        llmSkipRepairs: false,
        llmAvailableModels: [],
        // Rate limit handling
        llmRateLimitCooldown: 0,
        llmRateLimitTimer: null,
        // Abort controllers for cancellation
        llmAbortController: null,

        // Form data
        newPrompt: {
          id: '',
          name: '',
          taskId: 'draft_graph',
          content: '',
          changeNote: '',
          createdBy: 'admin-ui'
        },
        newVersion: {
          content: '',
          changeNote: '',
          createdBy: 'admin-ui'
        },

        // Toast notification system
        showToast(message, type = 'info', duration = 4000) {
          const id = ++this.toastId;
          this.toasts.push({ id, message, type });
          setTimeout(() => {
            this.toasts = this.toasts.filter(t => t.id !== id);
          }, duration);
        },

        // Copy validation issue as JSON
        copyValidationIssue(issue) {
          const json = JSON.stringify(issue, null, 2);
          navigator.clipboard.writeText(json).then(() => {
            this.showToast('Copied issue to clipboard', 'success', 2000);
          }).catch(() => {
            this.showToast('Failed to copy', 'error');
          });
        },

        // Initialize - check for saved session
        init() {
          const savedKey = sessionStorage.getItem('adminApiKey');
          if (savedKey) {
            this.apiKey = savedKey;
            this.authenticate();
          }
        },

        async authenticate() {
          this.error = null;
          try {
            const res = await fetch('/admin/prompts', {
              headers: { 'X-Admin-Key': this.apiKey }
            });
            if (res.ok) {
              this.authenticated = true;
              sessionStorage.setItem('adminApiKey', this.apiKey);
              this.showToast('Logged in successfully', 'success');
              this.loadPrompts();
            } else {
              sessionStorage.removeItem('adminApiKey');
              const data = await res.json();
              this.error = data.message || 'Authentication failed';
            }
          } catch (e) {
            this.error = 'Failed to connect to server';
          }
        },

        logout() {
          sessionStorage.removeItem('adminApiKey');
          this.authenticated = false;
          this.apiKey = '';
          this.prompts = [];
          this.selectedPrompt = null;
          this.tab = 'prompts';
          this.showToast('Logged out', 'info');
        },

        async loadPrompts() {
          this.loading = true;
          this.error = null;
          try {
            let url = '/admin/prompts?';
            if (this.filter.taskId) url += 'taskId=' + this.filter.taskId + '&';
            if (this.filter.status) url += 'status=' + this.filter.status + '&';

            const res = await fetch(url, {
              headers: { 'X-Admin-Key': this.apiKey }
            });
            if (res.ok) {
              const data = await res.json();
              this.prompts = data.prompts;
            } else {
              const data = await res.json();
              this.error = data.message || 'Failed to load prompts';
            }
          } catch (e) {
            this.error = 'Failed to load prompts';
          }
          this.loading = false;
        },

        async createPrompt() {
          this.error = null;
          try {
            const res = await fetch('/admin/prompts', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': this.apiKey
              },
              body: JSON.stringify(this.newPrompt)
            });
            if (res.ok) {
              this.showCreateModal = false;
              this.newPrompt = { id: '', name: '', taskId: 'draft_graph', content: '', changeNote: '', createdBy: 'admin-ui' };
              this.showToast('Prompt created successfully', 'success');
              this.loadPrompts();
            } else {
              const data = await res.json();
              this.showToast(data.message || 'Failed to create prompt', 'error');
            }
          } catch (e) {
            this.showToast('Failed to create prompt', 'error');
          }
        },

        viewPrompt(prompt) {
          // Clone the prompt and store previous status for potential revert
          this.selectedPrompt = { ...prompt, _previousStatus: prompt.status };
          this.selectedVersionNum = prompt.activeVersion;
        },

        editPrompt(prompt) {
          // Open view modal AND pre-fill new version with current content for editing
          this.selectedPrompt = { ...prompt, _previousStatus: prompt.status };
          this.selectedVersionNum = prompt.activeVersion;
          // Pre-fill the new version form with current content
          const currentContent = this.getVersionContent(prompt.activeVersion);
          this.newVersion = {
            content: currentContent,
            changeNote: '',
            createdBy: 'admin-ui'
          };
          // Open the new version modal directly for editing
          this.showNewVersionModal = true;
        },

        selectVersion(num) {
          this.selectedVersionNum = num;
        },

        getSelectedVersion() {
          if (!this.selectedPrompt) return null;
          return this.selectedPrompt.versions.find(v => v.version === this.selectedVersionNum);
        },

        getVersionContent(num) {
          if (!this.selectedPrompt) return '';
          const version = this.selectedPrompt.versions.find(v => v.version === num);
          return version ? version.content : '';
        },

        openNewVersionWithContent() {
          // Pre-fill the new version form with currently selected version's content
          const currentContent = this.getVersionContent(this.selectedVersionNum);
          this.newVersion = {
            content: currentContent,
            changeNote: '',
            createdBy: 'admin-ui'
          };
          this.showNewVersionModal = true;
        },

        async approveSelectedVersion() {
          if (!this.selectedPrompt) return;
          this.error = null;
          try {
            const res = await fetch('/admin/prompts/' + this.selectedPrompt.id + '/approve', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': this.apiKey
              },
              body: JSON.stringify({
                version: this.selectedVersionNum,
                approvedBy: 'admin-ui',
                notes: 'Approved via admin UI'
              })
            });
            if (res.ok) {
              this.showToast('Version ' + this.selectedVersionNum + ' approved', 'success');
              // Reload the prompt to get updated approval status
              const promptRes = await fetch('/admin/prompts/' + this.selectedPrompt.id, {
                headers: { 'X-Admin-Key': this.apiKey }
              });
              if (promptRes.ok) {
                const updated = await promptRes.json();
                this.selectedPrompt = { ...updated, _previousStatus: updated.status };
              }
              this.loadPrompts();
            } else {
              const data = await res.json();
              this.showToast(data.message || 'Failed to approve version', 'error');
            }
          } catch (e) {
            this.showToast('Failed to approve version', 'error');
          }
        },

        async updatePromptStatus() {
          this.error = null;
          const previousStatus = this.selectedPrompt._previousStatus || this.selectedPrompt.status;
          try {
            const res = await fetch('/admin/prompts/' + this.selectedPrompt.id, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': this.apiKey
              },
              body: JSON.stringify({ status: this.selectedPrompt.status })
            });
            if (res.ok) {
              this.showToast('Status updated to ' + this.selectedPrompt.status, 'success');
              this.loadPrompts();
            } else {
              const data = await res.json();
              // Handle approval required error
              if (data.error === 'approval_required') {
                this.pendingApproval = {
                  promptId: this.selectedPrompt.id,
                  version: this.selectedPrompt.activeVersion,
                  targetStatus: 'production'
                };
                this.showApprovalModal = true;
                this.showToast('This version requires approval before promotion', 'warning', 6000);
                // Revert the status in UI
                this.selectedPrompt.status = previousStatus;
              } else {
                this.showToast(data.message || 'Failed to update status', 'error');
              }
            }
          } catch (e) {
            this.showToast('Failed to update status', 'error');
          }
        },

        async approveVersion() {
          if (!this.pendingApproval) return;
          this.error = null;
          try {
            const res = await fetch('/admin/prompts/' + this.pendingApproval.promptId + '/approve', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': this.apiKey
              },
              body: JSON.stringify({
                version: this.pendingApproval.version,
                approvedBy: 'admin-ui',
                notes: 'Approved via admin UI'
              })
            });
            if (res.ok) {
              this.showApprovalModal = false;
              this.showToast('Version ' + this.pendingApproval.version + ' approved! You can now promote to production.', 'success', 5000);
              // Reload the prompt to get updated approval status
              const promptRes = await fetch('/admin/prompts/' + this.pendingApproval.promptId, {
                headers: { 'X-Admin-Key': this.apiKey }
              });
              if (promptRes.ok) {
                this.selectedPrompt = await promptRes.json();
              }
              this.pendingApproval = null;
              this.loadPrompts();
            } else {
              const data = await res.json();
              this.showToast(data.message || 'Failed to approve version', 'error');
            }
          } catch (e) {
            this.showToast('Failed to approve version', 'error');
          }
        },

        async createVersion() {
          this.error = null;

          // Prevent creating duplicate version with unchanged content
          const currentContent = this.getVersionContent(this.selectedPrompt.activeVersion);
          if (this.newVersion.content.trim() === currentContent.trim()) {
            this.showToast('No changes detected. Content is identical to the current version.', 'warning');
            return;
          }

          try {
            const res = await fetch('/admin/prompts/' + this.selectedPrompt.id + '/versions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': this.apiKey
              },
              body: JSON.stringify(this.newVersion)
            });
            if (res.ok) {
              const updated = await res.json();
              this.selectedPrompt = updated;
              this.selectedVersionNum = updated.versions[updated.versions.length - 1].version;
              this.showNewVersionModal = false;
              this.newVersion = { content: '', changeNote: '', createdBy: 'admin-ui' };
              this.showToast('Version ' + this.selectedVersionNum + ' created', 'success');
              this.loadPrompts();
            } else {
              const data = await res.json();
              this.showToast(data.message || 'Failed to create version', 'error');
            }
          } catch (e) {
            this.showToast('Failed to create version', 'error');
          }
        },

        async rollbackToVersion() {
          if (!confirm('Rollback to version ' + this.selectedVersionNum + '?')) return;

          this.error = null;
          try {
            const res = await fetch('/admin/prompts/' + this.selectedPrompt.id + '/rollback', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': this.apiKey
              },
              body: JSON.stringify({
                targetVersion: this.selectedVersionNum,
                rolledBackBy: 'admin-ui',
                reason: 'Rollback via admin UI'
              })
            });
            if (res.ok) {
              const updated = await res.json();
              this.selectedPrompt = updated;
              this.showToast('Rolled back to v' + this.selectedVersionNum, 'success');
              this.loadPrompts();
            } else {
              const data = await res.json();
              this.showToast(data.message || 'Failed to rollback', 'error');
            }
          } catch (e) {
            this.showToast('Failed to rollback', 'error');
          }
        },

        // ========== Test Case Management ==========
        async loadTestCasesForPrompt() {
          if (!this.selectedTestPromptId) {
            this.selectedTestPrompt = null;
            this.currentTestCases = [];
            return;
          }
          try {
            const res = await fetch('/admin/prompts/' + this.selectedTestPromptId, {
              headers: { 'X-Admin-Key': this.apiKey }
            });
            if (res.ok) {
              this.selectedTestPrompt = await res.json();
              // Use $nextTick to wait for Alpine to render the dropdown options
              // before setting the selected version, avoiding race conditions
              this.$nextTick(() => {
                this.selectedTestVersionNum = this.selectedTestPrompt.activeVersion;
                this.loadTestCasesForVersion();
              });
            } else {
              this.showToast('Failed to load prompt', 'error');
            }
          } catch (e) {
            this.showToast('Failed to load prompt', 'error');
          }
        },

        loadTestCasesForVersion() {
          if (!this.selectedTestPrompt) return;
          const version = this.selectedTestPrompt.versions.find(v => v.version === this.selectedTestVersionNum);
          this.currentTestCases = version?.testCases || [];
        },

        resetTestCaseForm() {
          this.editingTestCase = null;
          this.testCaseForm = {
            id: '',
            name: '',
            input: '',
            expectedOutput: '',
            variablesJson: '{}',
          };
        },

        editTestCase(tc) {
          this.editingTestCase = tc;
          this.testCaseForm = {
            id: tc.id,
            name: tc.name,
            input: tc.input,
            expectedOutput: tc.expectedOutput || '',
            variablesJson: JSON.stringify(tc.variables || {}),
          };
          this.showTestCaseModal = true;
        },

        async saveTestCase() {
          if (!this.testCaseForm.id || !this.testCaseForm.name || !this.testCaseForm.input) {
            this.showToast('ID, Name, and Input are required', 'error');
            return;
          }

          let variables = {};
          try {
            variables = JSON.parse(this.testCaseForm.variablesJson || '{}');
          } catch (e) {
            this.showToast('Invalid JSON for variables', 'error');
            return;
          }

          const newTestCase = {
            id: this.testCaseForm.id,
            name: this.testCaseForm.name,
            input: this.testCaseForm.input,
            expectedOutput: this.testCaseForm.expectedOutput || undefined,
            variables,
            enabled: true,
          };

          // Update the test cases array
          let updatedTestCases;
          if (this.editingTestCase) {
            updatedTestCases = this.currentTestCases.map(tc =>
              tc.id === this.editingTestCase.id ? newTestCase : tc
            );
          } else {
            // Check for duplicate ID
            if (this.currentTestCases.some(tc => tc.id === newTestCase.id)) {
              this.showToast('Test case ID already exists', 'error');
              return;
            }
            updatedTestCases = [...this.currentTestCases, newTestCase];
          }

          // Save to backend
          try {
            const res = await fetch('/admin/prompts/' + this.selectedTestPromptId + '/test-cases', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': this.apiKey
              },
              body: JSON.stringify({
                version: this.selectedTestVersionNum,
                testCases: updatedTestCases,
              })
            });
            if (res.ok) {
              this.currentTestCases = updatedTestCases;
              this.showTestCaseModal = false;
              this.showToast(this.editingTestCase ? 'Test case updated' : 'Test case added', 'success');
              // Reload the prompt to get updated data
              await this.loadTestCasesForPrompt();
            } else {
              const data = await res.json();
              this.showToast(data.message || 'Failed to save test case', 'error');
            }
          } catch (e) {
            this.showToast('Failed to save test case', 'error');
          }
        },

        async deleteTestCase(idx) {
          if (!confirm('Delete this test case?')) return;

          const updatedTestCases = this.currentTestCases.filter((_, i) => i !== idx);

          try {
            const res = await fetch('/admin/prompts/' + this.selectedTestPromptId + '/test-cases', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': this.apiKey
              },
              body: JSON.stringify({
                version: this.selectedTestVersionNum,
                testCases: updatedTestCases,
              })
            });
            if (res.ok) {
              this.currentTestCases = updatedTestCases;
              this.showToast('Test case deleted', 'success');
            } else {
              const data = await res.json();
              this.showToast(data.message || 'Failed to delete test case', 'error');
            }
          } catch (e) {
            this.showToast('Failed to delete test case', 'error');
          }
        },

        async runSingleTestCase(tc) {
          // Guard: Require prompt selection before running test
          if (!this.selectedTestPromptId || !this.selectedTestPrompt) {
            this.showToast('Please select a prompt before running tests', 'warning');
            return;
          }

          this.showToast('Running test...', 'info');
          try {
            const res = await fetch('/admin/prompts/' + this.selectedTestPromptId + '/test', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': this.apiKey
              },
              body: JSON.stringify({
                version: this.selectedTestVersionNum,
                input: { brief: tc.input },
                variables: tc.variables || {},
                dry_run: true,
              })
            });
            if (res.ok) {
              const data = await res.json();
              // Store test output for display
              tc.lastOutput = {
                compiled: data.compiled_content ?? data.compiled_prompt ?? null,
                charCount: data.char_count ?? 0,
                validation: data.validation ?? {},
                timestamp: new Date().toISOString(),
              };
              if (data.validation.valid) {
                tc.lastResult = 'pass';
                this.showToast('Test passed - ' + data.char_count + ' chars compiled', 'success');
              } else {
                tc.lastResult = 'fail';
                this.showToast('Test failed: ' + (data.validation.issues || []).join(', '), 'error');
              }
            } else {
              tc.lastResult = 'fail';
              const data = await res.json();
              tc.lastOutput = { error: data.message || 'Unknown error', timestamp: new Date().toISOString() };
              this.showToast(data.message || 'Test failed', 'error');
            }
          } catch (e) {
            tc.lastResult = 'fail';
            tc.lastOutput = { error: 'Network or server error', timestamp: new Date().toISOString() };
            this.showToast('Test execution failed', 'error');
          }
        },

        // ========== LLM Testing ==========

        // Load available models from the new endpoint
        async loadAvailableModels() {
          try {
            const res = await fetch('/admin/v1/test-prompt-llm/models', {
              headers: { 'X-Admin-Key': this.apiKey },
            });
            if (res.ok) {
              const data = await res.json();
              this.llmAvailableModels = data.models || [];
            }
          } catch (e) {
            console.warn('Failed to load available models:', e);
          }
        },

        // Cancel current LLM test
        cancelLLMTest() {
          if (this.llmAbortController) {
            this.llmAbortController.abort();
            this.llmAbortController = null;
            this.showToast('Test cancelled', 'info');
          }
        },

        // Handle rate limit with countdown
        startRateLimitCooldown(retryAfterSeconds) {
          this.llmRateLimitCooldown = retryAfterSeconds;
          if (this.llmRateLimitTimer) clearInterval(this.llmRateLimitTimer);
          this.llmRateLimitTimer = setInterval(() => {
            this.llmRateLimitCooldown--;
            if (this.llmRateLimitCooldown <= 0) {
              clearInterval(this.llmRateLimitTimer);
              this.llmRateLimitTimer = null;
            }
          }, 1000);
        },

        async runSingleTestCaseWithLLM(tc) {
          if (!this.selectedTestPromptId || !this.selectedTestPrompt) {
            this.showToast('Please select a prompt before running tests', 'warning');
            return;
          }

          // Check rate limit cooldown
          if (this.llmRateLimitCooldown > 0) {
            this.showToast('Rate limit cooldown active. Wait ' + this.llmRateLimitCooldown + 's before retrying.', 'warning');
            return;
          }

          tc.llmRunning = true;
          this.showToast('Running LLM test (this may take up to 2 minutes)...', 'info');

          // Create AbortController for cancellation
          const controller = new AbortController();
          this.llmAbortController = controller;
          const timeoutId = setTimeout(() => controller.abort(), 120000);

          try {
            // Build request for new admin endpoint
            const requestBody = {
              prompt_id: this.selectedTestPromptId,
              version: this.selectedTestVersionNum,
              brief: tc.input,
              options: {},
            };

            // Add model override if set
            if (this.llmModelOverride) {
              requestBody.options.model = this.llmModelOverride;
            }

            // Add skip repairs option
            if (this.llmSkipRepairs) {
              requestBody.options.skip_repairs = true;
            }

            const res = await fetch('/admin/v1/test-prompt-llm', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': this.apiKey,
              },
              body: JSON.stringify(requestBody),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);
            this.llmAbortController = null;

            const requestId = res.headers.get('X-Request-ID');

            // Handle 429 rate limit with Retry-After
            if (res.status === 429) {
              const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
              this.startRateLimitCooldown(retryAfter);

              tc.llmResult = {
                success: false,
                timestamp: new Date().toISOString(),
                requestId,
                error: 'Rate limit exceeded. Please wait ' + retryAfter + ' seconds before running more tests.',
                isRateLimited: true,
              };
              this.showToast('Rate limit exceeded. Cooldown: ' + retryAfter + 's', 'error');
              return;
            }

            const data = await res.json();

            if (res.ok && data.success) {
              const pipeline = data.pipeline || {};
              const stages = pipeline.stages || [];
              const llmData = data.llm || {};
              const result = data.result || {};
              const promptData = data.prompt || {};

              // Count repairs from stages
              const repairsApplied = (pipeline.repairs_applied || []).length;

              tc.llmResult = {
                success: true,
                timestamp: new Date().toISOString(),
                requestId: data.request_id,
                nodeCount: result.graph?.nodes?.length ?? 0,
                edgeCount: result.graph?.edges?.length ?? 0,
                repairsApplied,
                latencyMs: pipeline.total_duration_ms ?? llmData.duration_ms ?? 0,
                tokenUsage: llmData.token_usage,
                model: llmData.model,
                provider: llmData.provider,
                stages,
                rawOutputPreview: (llmData.raw_output || '').substring(0, 2000),
                rawOutputFull: llmData.raw_output,
                promptHash: promptData.content_hash,
                promptPreview: promptData.content_preview,
                fullResponse: data,
                graphSummary: {
                  node_count: result.graph?.nodes?.length,
                  edge_count: result.graph?.edges?.length,
                  node_kinds: [...new Set((result.graph?.nodes || []).map(n => n.kind))],
                  node_counts: pipeline.node_counts,
                },
                showStages: false,
                showRaw: false,
                showFullOutput: false,
                showTrace: false,
                showGraph: false,
                showValidation: result.validation?.error_count > 0, // Auto-expand if errors
                validationFilter: 'all',
              };

              this.showToast('LLM test passed - ' + tc.llmResult.nodeCount + ' nodes, ' + tc.llmResult.latencyMs + 'ms', 'success');

              // Save to history
              this.saveTestToHistory({
                testId: tc.id,
                testName: tc.name,
                promptId: this.selectedTestPromptId,
                version: this.selectedTestVersionNum,
                promptHash: promptData.content_hash,
                model: llmData.model,
                success: true,
                nodeCount: tc.llmResult.nodeCount,
                edgeCount: tc.llmResult.edgeCount,
                repairsApplied,
                latencyMs: tc.llmResult.latencyMs,
                timestamp: tc.llmResult.timestamp,
              });
            } else {
              tc.llmResult = {
                success: false,
                timestamp: new Date().toISOString(),
                requestId: data.request_id || requestId,
                error: data.error || data.message || 'Unknown error',
                fullResponse: data,
              };
              this.showToast('LLM test failed: ' + tc.llmResult.error, 'error');

              // Save failure to history
              this.saveTestToHistory({
                testId: tc.id,
                testName: tc.name,
                promptId: this.selectedTestPromptId,
                version: this.selectedTestVersionNum,
                success: false,
                error: tc.llmResult.error,
                timestamp: tc.llmResult.timestamp,
              });
            }
          } catch (e) {
            clearTimeout(timeoutId);
            const isTimeout = e.name === 'AbortError';
            tc.llmResult = {
              success: false,
              timestamp: new Date().toISOString(),
              error: isTimeout
                ? 'Request timed out after 2 minutes. The LLM may be under heavy load.'
                : 'Network error: ' + (e.message || 'Unknown error'),
              isTimeout,
            };
            this.showToast('LLM test failed: ' + tc.llmResult.error, 'error');
          } finally {
            tc.llmRunning = false;
          }
        },

        async runAllTestCasesWithLLM() {
          if (!this.selectedTestPromptId || this.currentTestCases.length === 0) {
            this.showToast('No test cases to run', 'warning');
            return;
          }

          this.llmBatchRunning = true;
          this.llmBatchProgress = { current: 0, total: this.currentTestCases.length };
          this.llmBatchResults = [];

          for (let i = 0; i < this.currentTestCases.length; i++) {
            this.llmBatchProgress.current = i + 1;
            const tc = this.currentTestCases[i];
            await this.runSingleTestCaseWithLLM(tc);

            this.llmBatchResults.push({
              testId: tc.id,
              testName: tc.name,
              success: tc.llmResult?.success ?? false,
              nodeCount: tc.llmResult?.nodeCount ?? 0,
              edgeCount: tc.llmResult?.edgeCount ?? 0,
              repairsApplied: tc.llmResult?.repairsApplied ?? 0,
              latencyMs: tc.llmResult?.latencyMs ?? 0,
              error: tc.llmResult?.error,
              validationErrors: tc.llmResult?.fullResponse?.result?.validation?.error_count ?? 0,
              validationWarnings: tc.llmResult?.fullResponse?.result?.validation?.warning_count ?? 0,
            });

            // Small delay between tests to avoid overwhelming the server
            if (i < this.currentTestCases.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }

          this.llmBatchRunning = false;
          const passCount = this.llmBatchResults.filter(r => r.success).length;
          const failCount = this.llmBatchResults.filter(r => !r.success).length;
          this.showToast('Batch complete: ' + passCount + ' passed, ' + failCount + ' failed', passCount === this.llmBatchResults.length ? 'success' : 'warning');
        },

        openLLMCompareModal() {
          if (!this.selectedTestPrompt || this.selectedTestPrompt.versions.length < 2) {
            this.showToast('Need at least 2 versions to compare', 'warning');
            return;
          }
          this.llmCompareVersionA = this.selectedTestPrompt.versions[0].version;
          this.llmCompareVersionB = this.selectedTestPrompt.activeVersion;
          this.llmCompareBrief = '';
          this.llmCompareResults = null;
          this.showLLMCompareModal = true;
        },

        async runLLMComparison() {
          if (!this.llmCompareBrief || this.llmCompareVersionA === this.llmCompareVersionB) {
            this.showToast('Please enter a brief and select different versions', 'warning');
            return;
          }

          // Check rate limit cooldown
          if (this.llmRateLimitCooldown > 0) {
            this.showToast('Rate limit cooldown active. Wait ' + this.llmRateLimitCooldown + 's before retrying.', 'warning');
            return;
          }

          this.llmCompareRunning = true;
          this.llmCompareResults = null;

          const runForVersion = async (version) => {
            // Create AbortController with 2-minute timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);

            try {
              // Use new admin endpoint with actual version specification
              const requestBody = {
                prompt_id: this.selectedTestPromptId,
                version: version,
                brief: this.llmCompareBrief,
                options: {},
              };

              // Add model override if set
              if (this.llmModelOverride) {
                requestBody.options.model = this.llmModelOverride;
              }

              const res = await fetch('/admin/v1/test-prompt-llm', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Admin-Key': this.apiKey,
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
              });

              clearTimeout(timeoutId);

              // Handle 429 rate limit with Retry-After
              if (res.status === 429) {
                const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
                this.startRateLimitCooldown(retryAfter);
                return {
                  success: false,
                  error: 'Rate limit exceeded. Wait ' + retryAfter + 's.',
                  isRateLimited: true,
                };
              }

              const data = await res.json();

              if (res.ok && data.success) {
                const pipeline = data.pipeline || {};
                const llmData = data.llm || {};
                const result = data.result || {};
                const promptData = data.prompt || {};

                return {
                  success: true,
                  version: version,
                  promptHash: promptData.content_hash,
                  promptPreview: promptData.content_preview,
                  nodeCount: result.graph?.nodes?.length ?? 0,
                  edgeCount: result.graph?.edges?.length ?? 0,
                  repairsApplied: (pipeline.repairs_applied || []).length,
                  latencyMs: pipeline.total_duration_ms ?? llmData.duration_ms ?? 0,
                  tokenUsage: llmData.token_usage,
                  model: llmData.model,
                  provider: llmData.provider,
                  nodeCounts: pipeline.node_counts,
                  validationErrors: result.validation?.error_count ?? 0,
                  validationWarnings: result.validation?.warning_count ?? 0,
                  validationIssues: result.validation?.issues || [],
                  showValidation: false,
                };
              } else {
                return {
                  success: false,
                  version: version,
                  error: data.error || data.message || 'Unknown error',
                };
              }
            } catch (e) {
              clearTimeout(timeoutId);
              const isTimeout = e.name === 'AbortError';
              return {
                success: false,
                version: version,
                error: isTimeout
                  ? 'Request timed out after 2 minutes.'
                  : 'Network error: ' + (e.message || 'Unknown'),
                isTimeout,
              };
            }
          };

          this.showToast('Running comparison (this may take 2-4 minutes)...', 'info');

          // Run both versions sequentially to respect rate limits
          const resultA = await runForVersion(this.llmCompareVersionA);

          // Small delay between runs
          await new Promise(resolve => setTimeout(resolve, 1000));

          const resultB = await runForVersion(this.llmCompareVersionB);

          // Check if prompts are actually different
          const promptsAreDifferent = resultA.promptHash !== resultB.promptHash;

          // Use version from result objects (captured at call time) to avoid any async timing issues
          this.llmCompareResults = {
            versionA: { ...resultA, versionNum: resultA.version },
            versionB: { ...resultB, versionNum: resultB.version },
            promptsAreDifferent,
            deltas: {
              nodeCount: (resultB.nodeCount ?? 0) - (resultA.nodeCount ?? 0),
              edgeCount: (resultB.edgeCount ?? 0) - (resultA.edgeCount ?? 0),
              repairs: (resultB.repairsApplied ?? 0) - (resultA.repairsApplied ?? 0),
              latency: (resultB.latencyMs ?? 0) - (resultA.latencyMs ?? 0),
              tokens: ((resultB.tokenUsage?.total ?? 0) - (resultA.tokenUsage?.total ?? 0)),
              validationErrors: (resultB.validationErrors ?? 0) - (resultA.validationErrors ?? 0),
              validationWarnings: (resultB.validationWarnings ?? 0) - (resultA.validationWarnings ?? 0),
            },
          };

          this.llmCompareRunning = false;

          if (promptsAreDifferent) {
            this.showToast('Comparison complete - different prompt versions confirmed', 'success');
          } else {
            this.showToast('Warning: Same prompt hash for both versions', 'warning');
          }
        },

        loadTestHistory() {
          try {
            const stored = localStorage.getItem('cee_test_history_' + this.selectedTestPromptId);
            this.testHistory = stored ? JSON.parse(stored) : [];
          } catch (e) {
            this.testHistory = [];
          }
        },

        saveTestToHistory(item) {
          try {
            const key = 'cee_test_history_' + this.selectedTestPromptId;
            let history = [];
            try {
              history = JSON.parse(localStorage.getItem(key) || '[]');
            } catch (e) {}

            history.push(item);

            // Keep only last 100 entries
            if (history.length > 100) {
              history = history.slice(-100);
            }

            localStorage.setItem(key, JSON.stringify(history));
            this.testHistory = history;
          } catch (e) {
            console.warn('Failed to save test history:', e);
          }
        },

        clearTestHistory() {
          if (!confirm('Clear all test history for this prompt?')) return;
          localStorage.removeItem('cee_test_history_' + this.selectedTestPromptId);
          this.testHistory = [];
          this.showToast('History cleared', 'success');
        },

        // ========== Version Comparison ==========
        openCompareModal() {
          if (!this.selectedPrompt || this.selectedPrompt.versions.length < 2) {
            this.showToast('Need at least 2 versions to compare', 'warning');
            return;
          }
          this.compareVersionA = this.selectedPrompt.versions[0].version;
          this.compareVersionB = this.selectedPrompt.activeVersion;
          this.comparisonData = null;
          this.showCompareModal = true;
          this.loadComparison();
        },

        async loadComparison() {
          if (!this.selectedPrompt || this.compareVersionA === this.compareVersionB) {
            this.comparisonData = null;
            return;
          }
          try {
            const res = await fetch(
              '/admin/prompts/' + this.selectedPrompt.id + '/diff?versionA=' + this.compareVersionA + '&versionB=' + this.compareVersionB,
              { headers: { 'X-Admin-Key': this.apiKey } }
            );
            if (res.ok) {
              this.comparisonData = await res.json();
            } else {
              this.showToast('Failed to load comparison', 'error');
              this.comparisonData = null;
            }
          } catch (e) {
            this.showToast('Failed to load comparison', 'error');
            this.comparisonData = null;
          }
        },

        formatDate(iso) {
          if (!iso) return '';
          const d = new Date(iso);
          return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      };
    }
  </script>
</body>
</html>`;
}

/**
 * Admin UI routes
 */
export async function adminUIRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin - Admin dashboard
   *
   * Security headers:
   * - CSP: Restricts script/style sources
   * - X-Content-Type-Options: Prevents MIME sniffing
   * - X-Frame-Options: Prevents clickjacking
   * - Referrer-Policy: Limits referrer information
   *
   * Security: IP allowlist check (same as admin API routes)
   */
  app.get('/admin', async (request: FastifyRequest, reply: FastifyReply) => {
    // Verify IP is allowed before serving admin UI
    if (!verifyIPAllowed(request, reply)) return;

    return reply
      .type('text/html')
      .header('Content-Security-Policy', CSP_HEADER)
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'strict-origin-when-cross-origin')
      .header('X-XSS-Protection', '1; mode=block')
      .send(generateAdminUI());
  });
}
