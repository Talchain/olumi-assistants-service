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
import { log, emit } from '../utils/telemetry.js';

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
    emit(AdminUIIPBlocked, {
      ip: requestIP,
      path: request.url,
      allowedCount: allowedIPs.size,
    });
    log.warn({ ip: requestIP, path: request.url }, 'Admin UI access blocked by IP allowlist');
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
                    <option value="">All Tasks</option>
                    <option value="draft_graph">draft_graph</option>
                    <option value="suggest_options">suggest_options</option>
                    <option value="repair_graph">repair_graph</option>
                    <option value="clarify_brief">clarify_brief</option>
                    <option value="critique_graph">critique_graph</option>
                    <option value="bias_check">bias_check</option>
                    <option value="evidence_helper">evidence_helper</option>
                    <option value="sensitivity_coach">sensitivity_coach</option>
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
                    <div class="flex mb-2" style="justify-content: space-between; align-items: center;">
                      <div>
                        <label>Version</label>
                        <select x-model="selectedTestVersionNum" @change="loadTestCasesForVersion()" style="width: auto; margin-left: 10px;">
                          <template x-for="v in selectedTestPrompt.versions" :key="v.version">
                            <option :value="v.version" x-text="'v' + v.version + (v.version === selectedTestPrompt.activeVersion ? ' (active)' : '')"></option>
                          </template>
                        </select>
                      </div>
                      <button class="btn btn-primary btn-sm" @click="showTestCaseModal = true; resetTestCaseForm()">+ Add Test Case</button>
                    </div>

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
                          </div>
                          <div class="flex" style="gap: 5px;">
                            <button class="btn btn-secondary btn-sm" @click="runSingleTestCase(tc)">Run</button>
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
                <option value="draft_graph">draft_graph</option>
                <option value="suggest_options">suggest_options</option>
                <option value="repair_graph">repair_graph</option>
                <option value="clarify_brief">clarify_brief</option>
                <option value="critique_graph">critique_graph</option>
                <option value="bias_check">bias_check</option>
                <option value="evidence_helper">evidence_helper</option>
                <option value="sensitivity_coach">sensitivity_coach</option>
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
              <button class="btn btn-secondary" @click="showNewVersionModal = true">+ New Version</button>
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
          this.viewPrompt(prompt);
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
              this.selectedTestVersionNum = this.selectedTestPrompt.activeVersion;
              this.loadTestCasesForVersion();
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
              this.showToast(data.message || 'Test failed', 'error');
            }
          } catch (e) {
            tc.lastResult = 'fail';
            this.showToast('Test execution failed', 'error');
          }
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
