import { useState, useRef } from 'react';

const BASE_URL = import.meta.env.VITE_BASE_URL || 'http://localhost:3101';

interface Node {
  id: string;
  label: string;
  kind: string;
}

interface Edge {
  id: string;
  from: string;
  to: string;
  provenance?: { kind: string; quote?: string };
}

interface Graph {
  nodes: Node[];
  edges: Edge[];
}

interface DraftResponse {
  graph: Graph;
  confidence?: number;
  clarifier_status?: string;
}

function App() {
  const [brief, setBrief] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [grounding, setGrounding] = useState(true);
  const [status, setStatus] = useState<'idle' | 'drafting' | 'complete' | 'error'>('idle');
  const [graph, setGraph] = useState<Graph | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [requestId, setRequestId] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleStream = async () => {
    if (!brief.trim()) {
      setError('Please enter a brief');
      return;
    }

    setStatus('drafting');
    setError('');
    setGraph(null);
    abortRef.current = new AbortController();

    try {
      // Prepare attachments
      const attachments = [];
      const payloads: Record<string, string> = {};

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const content = await file.text();
        const base64 = btoa(content);

        attachments.push({
          id: `att_${i}`,
          kind: 'document',
          name: file.name,
        });

        payloads[`att_${i}`] = base64;
      }

      const body = JSON.stringify({
        brief,
        attachments: attachments.length > 0 ? attachments : undefined,
        attachment_payloads: attachments.length > 0 ? payloads : undefined,
        flags: { grounding },
      });

      const response = await fetch(`${BASE_URL}/assist/draft-graph/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body,
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Extract request ID from headers
      const reqId = response.headers.get('X-Request-Id') || '';
      setRequestId(reqId);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: stage')) {
            const dataLine = line.split('\n')[1];
            if (dataLine?.startsWith('data: ')) {
              const json = dataLine.slice(6);
              const event = JSON.parse(json);

              if (event.stage === 'DRAFTING') {
                if (event.payload) {
                  // Fixture shown
                  setGraph(event.payload.graph);
                  setConfidence(event.payload.confidence ?? 0);
                }
              } else if (event.stage === 'COMPLETE') {
                if (event.payload.schema === 'error.v1') {
                  setStatus('error');
                  setError(event.payload.message);
                } else {
                  setStatus('complete');
                  setGraph(event.payload.graph);
                  setConfidence(event.payload.confidence ?? 0);
                }
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setStatus('idle');
      } else {
        setStatus('error');
        setError(err.message);
      }
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setStatus('idle');
  };

  const handleDownloadEvidence = async () => {
    if (!requestId) {
      setError('No request ID available');
      return;
    }

    try {
      const response = await fetch(`${BASE_URL}/assist/draft-graph/${requestId}/evidence`);
      if (!response.ok) {
        throw new Error('Evidence pack not available');
      }

      const evidencePack = await response.json();
      const blob = new Blob([JSON.stringify(evidencePack, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evidence_${requestId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Olumi Assistants - Demo Client</h1>
      <p>SSE streaming with fixture fallback, file upload, and evidence pack download</p>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', marginBottom: 5, fontWeight: 'bold' }}>
          Brief
        </label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Enter your strategic question (e.g., Should we expand into EU markets?)"
          style={{ width: '100%', height: 80, padding: 10, fontSize: 14, fontFamily: 'inherit' }}
          disabled={status === 'drafting'}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', marginBottom: 5, fontWeight: 'bold' }}>
          Attachments (optional)
        </label>
        <input
          type="file"
          multiple
          accept=".txt,.md,.csv,.pdf"
          onChange={handleFileChange}
          disabled={status === 'drafting'}
          style={{ fontSize: 14 }}
        />
        {files.length > 0 && (
          <div style={{ marginTop: 5, fontSize: 12, color: '#666' }}>
            {files.length} file(s) selected: {files.map(f => f.name).join(', ')}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={grounding}
            onChange={(e) => setGrounding(e.target.checked)}
            disabled={status === 'drafting'}
          />
          <span>Enable document grounding</span>
        </label>
      </div>

      <div style={{ marginBottom: 20 }}>
        {status === 'drafting' ? (
          <button onClick={handleCancel} style={{ padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
        ) : (
          <button onClick={handleStream} style={{ padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}>
            Generate Draft (SSE)
          </button>
        )}
      </div>

      {status === 'drafting' && (
        <div style={{ padding: 15, backgroundColor: '#f0f8ff', border: '1px solid #bee3f8', borderRadius: 4, marginBottom: 20 }}>
          <strong>Status:</strong> Drafting...
        </div>
      )}

      {status === 'error' && error && (
        <div style={{ padding: 15, backgroundColor: '#fff5f5', border: '1px solid #feb2b2', borderRadius: 4, marginBottom: 20 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {graph && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2>Draft Graph</h2>
            {requestId && (
              <button onClick={handleDownloadEvidence} style={{ padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
                Download Evidence Pack
              </button>
            )}
          </div>

          <div style={{ padding: 15, backgroundColor: '#f7fafc', border: '1px solid #cbd5e0', borderRadius: 4, marginBottom: 20 }}>
            <div>
              <strong>Confidence:</strong> {(confidence * 100).toFixed(1)}%
            </div>
            <div>
              <strong>Nodes:</strong> {graph.nodes.length} | <strong>Edges:</strong> {graph.edges.length}
            </div>
            {requestId && (
              <div style={{ fontSize: 12, color: '#666', marginTop: 5 }}>
                Request ID: {requestId}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <h3>Nodes</h3>
              {graph.nodes.length === 0 ? (
                <p style={{ color: '#999' }}>No nodes yet</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {graph.nodes.map((node) => (
                    <li
                      key={node.id}
                      style={{
                        padding: '8px 12px',
                        marginBottom: 8,
                        backgroundColor: '#fff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 4,
                      }}
                    >
                      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                        {node.label}
                      </div>
                      <div style={{ fontSize: 12, color: '#666' }}>
                        {node.kind} • {node.id}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3>Edges</h3>
              {graph.edges.length === 0 ? (
                <p style={{ color: '#999' }}>No edges yet</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {graph.edges.map((edge) => (
                    <li
                      key={edge.id}
                      style={{
                        padding: '8px 12px',
                        marginBottom: 8,
                        backgroundColor: '#fff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 4,
                      }}
                    >
                      <div style={{ marginBottom: 4 }}>
                        {edge.from} → {edge.to}
                      </div>
                      {edge.provenance && (
                        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                          {edge.provenance.kind}
                          {edge.provenance.quote && (
                            <div style={{ fontStyle: 'italic', marginTop: 2 }}>
                              "{edge.provenance.quote}"
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
