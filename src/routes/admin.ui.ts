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
    pre {
      background: #f3f4f6;
      padding: 15px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.85rem;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>
  <div x-data="promptAdmin()">
    <header>
      <h1>Olumi Prompt Admin</h1>
      <p>Manage prompts, versions, and experiments</p>
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
                  <template x-if="version.version === selectedPrompt.activeVersion">
                    <span class="status status-production">Active</span>
                  </template>
                </div>
              </template>
            </div>

            <h3 class="mt-2 mb-2">Content (v<span x-text="selectedVersionNum"></span>)</h3>
            <pre x-text="getVersionContent(selectedVersionNum)"></pre>

            <div class="flex mt-2">
              <button class="btn btn-secondary" @click="showNewVersionModal = true">+ New Version</button>
              <template x-if="selectedVersionNum !== selectedPrompt.activeVersion">
                <button class="btn btn-primary" @click="rollbackToVersion()">
                  Rollback to v<span x-text="selectedVersionNum"></span>
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

        // Prompts
        prompts: [],
        filter: { taskId: '', status: '' },
        selectedPrompt: null,
        selectedVersionNum: 1,
        showCreateModal: false,
        showNewVersionModal: false,
        showExperimentModal: false,

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

        async authenticate() {
          this.error = null;
          try {
            const res = await fetch('/admin/prompts', {
              headers: { 'X-Admin-Key': this.apiKey }
            });
            if (res.ok) {
              this.authenticated = true;
              this.loadPrompts();
            } else {
              const data = await res.json();
              this.error = data.message || 'Authentication failed';
            }
          } catch (e) {
            this.error = 'Failed to connect to server';
          }
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
              this.success = 'Prompt created successfully';
              setTimeout(() => this.success = null, 3000);
              this.loadPrompts();
            } else {
              const data = await res.json();
              this.error = data.message || 'Failed to create prompt';
            }
          } catch (e) {
            this.error = 'Failed to create prompt';
          }
        },

        viewPrompt(prompt) {
          this.selectedPrompt = prompt;
          this.selectedVersionNum = prompt.activeVersion;
        },

        editPrompt(prompt) {
          this.viewPrompt(prompt);
        },

        selectVersion(num) {
          this.selectedVersionNum = num;
        },

        getVersionContent(num) {
          if (!this.selectedPrompt) return '';
          const version = this.selectedPrompt.versions.find(v => v.version === num);
          return version ? version.content : '';
        },

        async updatePromptStatus() {
          this.error = null;
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
              this.success = 'Status updated';
              setTimeout(() => this.success = null, 3000);
              this.loadPrompts();
            } else {
              const data = await res.json();
              this.error = data.message || 'Failed to update status';
            }
          } catch (e) {
            this.error = 'Failed to update status';
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
              this.success = 'Version created';
              setTimeout(() => this.success = null, 3000);
              this.loadPrompts();
            } else {
              const data = await res.json();
              this.error = data.message || 'Failed to create version';
            }
          } catch (e) {
            this.error = 'Failed to create version';
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
              this.success = 'Rolled back to v' + this.selectedVersionNum;
              setTimeout(() => this.success = null, 3000);
              this.loadPrompts();
            } else {
              const data = await res.json();
              this.error = data.message || 'Failed to rollback';
            }
          } catch (e) {
            this.error = 'Failed to rollback';
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
   */
  app.get('/admin', async (_request: FastifyRequest, reply: FastifyReply) => {
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
