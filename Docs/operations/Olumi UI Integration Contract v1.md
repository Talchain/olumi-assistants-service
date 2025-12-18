# **Olumi UI Integration Contract v1.1**

**Last Updated:** 2025-12-04  
 **Source:** PLoT Engine `/v1/run` response (verified against codebase)  
 **Status:** Production-ready  
 **Changes from v1.0:** Fixed `/v1/diff` response structure, added optional field details

---

## **Core Response Structure**

### **Always Present Fields**

These fields are **guaranteed** on every successful `/v1/run` response:

interface RunResponseCore {  
  schema: 'run.v1';  
    
  // Decision outcomes  
  results: {  
    conservative: { outcome: number };  
    most\_likely: { outcome: number };  
    optimistic: { outcome: number };  
  };  
    
  // Confidence assessment  
  confidence: {  
    level: 'LOW' | 'MEDIUM' | 'HIGH';  // Only 3 levels  
    reason: string;  
    score: number;  // 0-1  
    factors: {  
      identifiability: number;  
      linearity\_distance: number;  
      k\_coverage: number;  
      calibration: number;  
    };  
  };  
    
  // Issues and warnings  
  critique: Array\<{  
    severity: 'BLOCKER' | 'IMPROVEMENT' | 'OBSERVATION';  
    semantic\_severity: 'ERROR' | 'WARNING' | 'INFO';  // Use for UI styling  
    message: string;  
    suggested\_action?: string;  
    auto\_fixable?: boolean;  
    code?: string;  // e.g., 'STALE\_EVIDENCE'  
  }\>;  
    
  // Quality assessment  
  graph\_quality: {  
    score: number;  // 0-1  
    completeness: number;  
    evidence\_coverage: number;  
    balance: number;  
    issues\_count: number;  
    recommendation?: string;  
  };  
    
  // What changed analysis  
  explain\_delta: {  
    summary: string;  
    top\_drivers: Array\<{  
      node\_id: string;  
      node\_label: string;  
      contribution: number;  // 0-100  
      sign: '+' | '-';  
      explanation: string;  
    }\>;  
    top\_edge\_drivers: Array\<{  
      edge\_id: string;  
      from: string;  
      to: string;  
      score: number;  
      rank: number;  
      // Optional additional fields:  
      label?: string;  
      weight?: number;  
      belief?: number;  
      provenance?: string;  
    }\>;  
  };  
    
  // Reproducibility  
  result: {  
    response\_hash: string;  // SHA-256 of canonical input  
    summary: {  
      p10: number;  
      p50: number;  
      p90: number;  
    };  
  };  
    
  // Graph structure  
  graph: {  
    nodes: Array\<GraphNode\>;  
    edges: Array\<GraphEdge\>;  
  };  
    
  // Model metadata  
  model\_card: {  
    seed: number;  
    assumptions\_summary: string\[\];  
    compute\_budget: {  
      k\_samples?: number;  
      downgraded?: boolean;  
      downgrade\_reason?: string;  
    };  
    flags\_on: string\[\];  
    determinism\_note: string;  
    detail\_level: string;  
    parameters: {  
      K: number;  
      K\_requested?: number;  
      K\_converged?: boolean;  
    };  
    response\_hash: string;  // Normalized response hash  
  };  
    
  // Other always-present fields  
  identifiability: string;  
  insights: {  
    summary: string;  
    risks: string\[\];  
    next\_steps: string\[\];  
  };  
  linearity\_warning: {  
    outside\_range: boolean;  
    distance\_from\_center: number;  
    recommendation: string;  
  };  
  meta: {  
    seed: number;  
    commit: string;  
    version: string;  
    inference\_mode: string;  
  };  
}

---

## **Optional Fields (Flag-Gated)**

### **Evidence Coverage (Provenance)**

**Requirements:**

* Environment: `PROVENANCE_ENABLE=1`

**Fields:**

interface ProvenanceFields {  
  model\_card: {  
    provenance\_summary: {  
      sources: string\[\];              // e.g., \["RCT\_2021\_Q3", "MarketSurvey"\]  
      source\_count: number;  
      edges\_with\_provenance: number;  // How many edges have evidence  
      edges\_total: number;            // Total edges in graph  
      coverage\_ratio: number;         // 0-1 (edges\_with\_provenance / edges\_total)  
      confidence\_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';  
      confidence\_score: number;       // 0-1  
      collected\_at: string;           // ISO timestamp  
    };  
  };  
}

**UI Implementation:**

if (response.model\_card?.provenance\_summary) {  
  const { edges\_with\_provenance, edges\_total, coverage\_ratio } \=   
    response.model\_card.provenance\_summary;  
    
  // Display: "7 of 12 edges backed by evidence (58%)"  
  // Warn if coverage\_ratio \< 0.3  
}

---

### **AI Enhancement (CEE)**

**Requirements (ALL must be true):**

* Environment: `CEE_ORCHESTRATOR_ENABLE=1` (or `CEE_ORCHESTRATOR_ENABLED`)  
* Config: `CEE_BASE_URL` and `CEE_API_KEY` set  
* Header: `Idempotency-Key` present  
* Request: `detail_level` ≠ `'quick'`  
* Runtime: Circuit breaker allows call

**Fields:**

interface CEEFields {  
  // Full decision review payload (opaque to Engine)  
  ceeReview?: {  
    schema: 'cee.decision-review.v1';  
    response\_hash: string;  
    seed: number | string;  
    inference\_mode: string;  
    graph\_summary: { nodes: number; edges: number };  
    scenario\_kind?: string;  
    // ... additional CEE-defined fields:  
    // \- graph, archetype, quality, guidance  
    // \- bias\_findings, mitigation\_patches  
    // \- trace.verification (on graph endpoints only, NOT decision reviews)  
  };  
    
  // Trace metadata  
  ceeTrace?: {  
    requestId: string;  
    degraded: boolean;      // True if CEE unavailable/timed out  
    timestamp: string;      // ISO format  
    // Note: provider/model NOT guaranteed  
  };  
    
  // Error info (only if CEE failed)  
  ceeError?: {  
    code?: string;  
    retryable?: boolean;  
    suggestedAction: 'retry' | 'fix\_input' | 'fail';  
    traceId?: string;  
  };  
}

**UI Implementation:**

// Check if CEE active  
const hasCEE \= Boolean(response.ceeReview || response.ceeTrace);

// Handle degradation  
if (response.ceeTrace?.degraded) {  
  showBanner("AI review unavailable \- showing basic results");  
}

// Verification badge (only on CEE graph responses, NOT decision reviews)  
if (response.ceeReview?.trace?.verification) {  
  const score \= response.ceeReview.trace.verification.numerical\_grounding\_score;  
    
  if (score \>= 0.95) {  
    showBadge("✓ Verified", "green");  
  } else if (score \>= 0.80) {  
    showBadge("⚠ Review Recommended", "amber");  
  } else {  
    showBadge("✗ Verification Issues", "red");  
  }  
}

---

### **Causal Validation (ISL)**

**Requirements for `isl_validation`:**

* Environment: `ISL_ENABLE=1`  
* Config: `ISL_BASE_URL` and `ISL_API_KEY` set  
* Request: `detail_level` ≠ `'quick'`

**Requirements for `isl_sensitivity`:**

* All above, PLUS: `detail_level` \= `'deep'`

**Fields:**

interface ISLFields {  
  // Available when ISL enabled \+ detail ≠ quick  
  isl\_validation?: {  
    status: 'identifiable' | 'uncertain' | 'cannot\_identify';  
    confidence: 'high' | 'medium' | 'low';  
    adjustment\_sets?: string\[\]\[\];  
    minimal\_set?: string\[\];  
    backdoor\_paths?: string\[\];  
    issues?: Array\<{  
      type: string;  
      description: string;  
      affected\_nodes: string\[\];  
      suggested\_action: string;  
    }\>;  
    explanation?: {  
      summary: string;  
      reasoning: string;  
    };  
    source: 'isl' | 'engine\_fallback';  
  };  
    
  // Available ONLY when detail \= 'deep'  
  isl\_sensitivity?: {  
    overall\_robustness: 'robust' | 'moderate' | 'fragile';  
    sensitive\_parameters: Array\<{  
      parameter: string;        // e.g., "edge:Marketing-\>Revenue"  
      sensitivity: number;      // 0-1  
      impact\_direction: 'positive' | 'negative';  
    }\>;  
    recommendations: string\[\];  
    source: 'isl' | 'engine\_fallback';  
  };  
}

**UI Implementation:**

// Validation status  
if (response.isl\_validation) {  
  const { status, confidence } \= response.isl\_validation;  
    
  if (status \=== 'cannot\_identify') {  
    showError("Causal effect cannot be reliably estimated");  
  } else if (status \=== 'uncertain') {  
    showWarning("Causal estimates have high uncertainty");  
  }  
}

// Sensitivity rankings (deep mode only)  
if (response.isl\_sensitivity) {  
  const { sensitive\_parameters, overall\_robustness } \= response.isl\_sensitivity;  
    
  // Display bar chart of top sensitive parameters  
  sensitive\_parameters.forEach(param \=\> {  
    addBar(param.parameter, param.sensitivity);  
  });  
    
  // Show robustness indicator  
  if (overall\_robustness \=== 'fragile') {  
    showWarning("Results sensitive to assumptions");  
  }  
}

---

## **Quick Reference Tables**

### **Confidence Levels (3 Options)**

| Level | Meaning | UI Treatment |
| ----- | ----- | ----- |
| `LOW` | Weak evidence, high uncertainty | Red/amber badge, show warnings |
| `MEDIUM` | Acceptable confidence | Neutral badge |
| `HIGH` | Strong evidence, low uncertainty | Green badge |

**❌ NOT VALID:** `VERY_LOW`, `VERY_HIGH` (these don't exist)

---

### **Critique Severity Styling**

| semantic\_severity | Icon | Background | Order | Default State |
| ----- | ----- | ----- | ----- | ----- |
| `ERROR` | ❌ AlertCircle | red-50 | 1 | Expanded |
| `WARNING` | ⚠️ AlertTriangle | amber-50 | 2 | Collapsed |
| `INFO` | ℹ️ Info | blue-50 | 3 | Collapsed |

**Sort order:** ERROR → WARNING → INFO  
 **Display:** Group by severity, expand ERRORs by default

---

### **Feature Availability Matrix**

| Feature | Flag/Config | Request Requirement | Latency | Priority |
| ----- | ----- | ----- | ----- | ----- |
| Results display | None | None | \<500ms | P0 |
| Critique styling | None | None | \<10ms | P0 |
| Health status | None | None | Included | P0 |
| Evidence coverage | `PROVENANCE_ENABLE=1` | None | \<10ms | P1 |
| CEE review | CEE config \+ Idempotency-Key | detail ≠ 'quick' | \<2s | P1 |
| ISL validation | ISL config | detail ≠ 'quick' | \<1s | P2 |
| ISL sensitivity | ISL config | detail \= 'deep' | \<1s | P2 |

---

## **Service Limits**

interface ServiceLimits {  
  max\_nodes: 50;        // Strict limit  
  max\_edges: 200;       // Strict limit  
  max\_body\_kb: 96;      // \~96 KiB request body  
    
  sweet\_spot\_nodes: 15; // Guidance: optimal complexity  
  sweet\_spot\_edges: 30; // Guidance: optimal connections  
    
  warning\_nodes: 30;    // Start showing complexity warnings  
  warning\_edges: 100;   // Start showing complexity warnings  
}

**Available via:** `GET /v1/limits`

---

## **Endpoints Reference**

### **POST /v1/run**

**Primary analysis endpoint**

**Request:**

{  
  graph: { nodes, edges };  
  treatment?: string;  
  outcome?: string;  
  detail\_level?: 'quick' | 'standard' | 'deep';  // Default: 'standard'  
  seed?: number;  
  // ... other options  
}

**Headers:**

// Required for CEE integration  
'Idempotency-Key': string;

// Optional: tracing  
'X-Request-Id': string;  
'X-Trace-Id': string;

**Response:** See `RunResponseCore` \+ optional fields above

---

### **POST /v1/diff**

**Compare two graph versions**

**Request:**

{  
  before: { nodes: \[\], edges: \[\] };  
  after: { nodes: \[\], edges: \[\] };  
}

**Response:**

{  
  schema: 'diff.v1';  
  graphs: {  
    before: { nodes: number; edges: number };  
    after: { nodes: number; edges: number };  
  };  
  diff: {  
    nodes\_added: GraphNode\[\];  
    nodes\_removed: GraphNode\[\];  
    nodes\_modified: Array\<{  
      node: GraphNode;  
      changes: Array\<{  
        field: string;  
        old\_value: unknown;  
        new\_value: unknown;  
      }\>;  
    }\>;  
    edges\_added: GraphEdge\[\];  
    edges\_removed: GraphEdge\[\];  
    edges\_modified: Array\<{  
      edge: GraphEdge;  
      changes: Array\<{  
        field: string;  
        old\_value: unknown;  
        new\_value: unknown;  
      }\>;  
    }\>;  
    summary: {  
      total\_changes: number;  
      significant\_changes: number;  
    };  
  };  
}

**UI Implementation:**

// Display added/removed nodes  
response.diff.nodes\_added.forEach(node \=\> {  
  highlightNode(node.id, 'added');  
});

response.diff.nodes\_removed.forEach(node \=\> {  
  highlightNode(node.id, 'removed');  
});

// Display modified nodes with change details  
response.diff.nodes\_modified.forEach(({ node, changes }) \=\> {  
  highlightNode(node.id, 'modified');  
    
  // Show what changed  
  changes.forEach(({ field, old\_value, new\_value }) \=\> {  
    showChangeTooltip(node.id, \`${field}: ${old\_value} → ${new\_value}\`);  
  });  
});

// Display modified edges with change details  
response.diff.edges\_modified.forEach(({ edge, changes }) \=\> {  
  highlightEdge(edge.from, edge.to, 'modified');  
    
  // Show what changed  
  changes.forEach(({ field, old\_value, new\_value }) \=\> {  
    showChangeTooltip(edge.id, \`${field}: ${old\_value} → ${new\_value}\`);  
  });  
});

// Summary  
const { total\_changes, significant\_changes } \= response.diff.summary;  
console.log(\`${total\_changes} total changes, ${significant\_changes} significant\`);

---

### **GET /v1/health**

**Service health status**

**Response:**

{  
  status: 'ok';  
  api\_version: 'v1';  
  version: string;  
  uptime\_s: number;  
    
  // Performance metrics  
  p95\_ms: number;  
  engine\_p95\_ms\_rolling: number;  
    
  // Health indicators  
  degraded: boolean;  
  health\_status: 'ok' | 'degraded';  
  degraded\_reasons?: string\[\];  // e.g., \['engine\_p95\_ms\_rolling\_exceeded'\]  
    
  // Cache stats  
  idem\_cache\_size: number;  
  fixtures\_cache\_size: number;  
  // ... additional metrics  
}

---

### **GET /v1/limits**

**Current service limits**

**Response:**

{  
  schema: 'limits.v1';  
  max\_nodes: 50;  
  max\_edges: 200;  
  max\_body\_kb: 96;  
  sweet\_spot\_nodes: 15;  
  sweet\_spot\_edges: 30;  
  warning\_nodes: 30;  
  warning\_edges: 100;  
  // ... rate limits, flags  
}

---

## **Example Responses**

### **Minimal Response (No Optional Features)**

{  
  "schema": "run.v1",  
  "confidence": {  
    "level": "MEDIUM",  
    "reason": "Acceptable confidence with moderate evidence",  
    "score": 0.73,  
    "factors": {  
      "identifiability": 0.7,  
      "linearity\_distance": 0.8,  
      "k\_coverage": 0.7,  
      "calibration": 0.5  
    }  
  },  
  "critique": \[  
    {  
      "severity": "IMPROVEMENT",  
      "semantic\_severity": "WARNING",  
      "message": "Sparse graph: 4 nodes. Consider adding intermediate variables.",  
      "suggested\_action": "Add mediating factors for richer analysis"  
    }  
  \],  
  "results": {  
    "conservative": { "outcome": 95 },  
    "most\_likely": { "outcome": 112 },  
    "optimistic": { "outcome": 130 }  
  },  
  "graph\_quality": {  
    "score": 0.78,  
    "completeness": 0.8,  
    "evidence\_coverage": 0.4,  
    "balance": 0.9,  
    "issues\_count": 1  
  },  
  "result": {  
    "response\_hash": "7f3b8a8f3a6c4e09...",  
    "summary": { "p10": 95, "p50": 112, "p90": 130 }  
  },  
  "meta": {  
    "seed": 4242,  
    "commit": "abc1234",  
    "version": "1.0.0"  
  }  
}

### **With Provenance**

Adds to above:

{  
  "model\_card": {  
    "provenance\_summary": {  
      "sources": \["RCT\_2021\_Q3", "MarketSurvey\_2024"\],  
      "source\_count": 2,  
      "edges\_with\_provenance": 7,  
      "edges\_total": 12,  
      "coverage\_ratio": 0.58,  
      "confidence\_level": "MEDIUM",  
      "confidence\_score": 0.65,  
      "collected\_at": "2025-01-15T10:30:00Z"  
    }  
  }  
}

### **With CEE**

Adds:

{  
  "ceeReview": {  
    "schema": "cee.decision-review.v1",  
    "response\_hash": "...",  
    "seed": 4242,  
    "graph\_summary": { "nodes": 5, "edges": 8 }  
  },  
  "ceeTrace": {  
    "requestId": "req-abc123",  
    "degraded": false,  
    "timestamp": "2025-01-15T10:30:00Z"  
  }  
}

### **With ISL (Deep Mode)**

Adds:

{  
  "isl\_validation": {  
    "status": "identifiable",  
    "confidence": "high",  
    "adjustment\_sets": \[\["Price", "Seasonality"\]\],  
    "source": "isl"  
  },  
  "isl\_sensitivity": {  
    "overall\_robustness": "moderate",  
    "sensitive\_parameters": \[  
      {  
        "parameter": "edge:Marketing-\>Revenue",  
        "sensitivity": 0.8,  
        "impact\_direction": "positive"  
      }  
    \],  
    "source": "isl"  
  }  
}

---

## **Error Handling**

### **Standard Error Shape**

interface ErrorResponse {  
  schema: 'error.v1';  
  code: string;  
  message: string;  
  retryable: boolean;  
  reason?: string;  
  recovery?: {  
    suggestion: string;  
    hints: string\[\];  
    example?: string;  
  };  
  request\_id: string;  
  degraded?: boolean;  
  source?: string;          // Additional field (engine sets to 'plot')  
  error?: {                 // Additional nested error details  
    type: string;  
    message: string;  
    hint?: string;  
    fields?: string\[\];  
    field?: string;  
  };  
}

### **Graceful Degradation**

// CEE unavailable  
if (response.ceeTrace?.degraded) {  
  showBanner("AI review temporarily unavailable");  
  // Still show basic results  
}

// ISL timeout  
if (\!response.isl\_validation && config.ISL\_ENABLE) {  
  // Continue without ISL enrichment  
  // No error shown to user  
}

---

## **Implementation Checklist**

### **Phase 1: Core Features (No Flags)**

* \[ \] Display results (conservative/likely/optimistic)  
* \[ \] Render critique with severity styling  
* \[ \] Show confidence badge (3 levels only)  
* \[ \] Display quality score  
* \[ \] Handle basic errors

### **Phase 2: Trust Signals**

* \[ \] Evidence coverage display (when provenance enabled)  
* \[ \] CEE verification badge (when CEE active)  
* \[ \] Degradation warnings  
* \[ \] ISL sensitivity rankings (deep mode)

### **Phase 3: Advanced**

* \[ \] Graph diff comparison (use corrected structure)  
* \[ \] Bias mitigation workflow  
* \[ \] Full ISL integration

---

## **Key Changes from v1.0**

1. **Fixed `/v1/diff` response structure** \- `nodes_modified` and `edges_modified` now correctly show `{ node/edge, changes[] }` structure  
2. **Added optional fields** \- Documented additional fields in `explain_delta.top_edge_drivers` and error envelope  
3. **Clarified CEE verification scope** \- Explicitly noted that `trace.verification` exists on graph endpoints only, NOT decision reviews

---

**Version:** 1.1  
 **Last Verified:** 2025-12-04 against PLoT Engine codebase  
 **Verified By:** PLoT Engine team  
 **Status:** Production-ready, all known issues resolved  
 **Contact:** Platform team for questions or updates

