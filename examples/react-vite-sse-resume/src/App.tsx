import { useState, FormEvent } from 'react';
import { useSseStream } from './useSseStream';
import './App.css';

function App() {
  const [brief, setBrief] = useState('');

  const {
    events,
    isConnected,
    isReconnecting,
    error,
    reconnectAttempts,
    resumeToken,
    startStream,
    disconnect,
    reset,
  } = useSseStream({
    baseUrl: '',
    maxRetries: 5,
    initialBackoffMs: 1500,
    maxBackoffMs: 30000,
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (brief.trim()) {
      startStream(brief);
    }
  };

  const getLastStage = () => {
    const stageEvents = events.filter((e) => e.type === 'stage');
    if (stageEvents.length === 0) return null;
    return stageEvents[stageEvents.length - 1];
  };

  const lastStage = getLastStage();

  return (
    <div className="app">
      <h1>SSE Live Resume Example</h1>
      <p className="subtitle">
        React + Vite demonstration of SSE streaming with automatic reconnection
      </p>

      <form onSubmit={handleSubmit} className="input-form">
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Enter your decision brief (e.g., 'Should we expand into EU markets?')"
          rows={3}
          disabled={isConnected}
        />
        <div className="button-group">
          <button type="submit" disabled={isConnected || !brief.trim()}>
            Start Stream
          </button>
          {isConnected && (
            <button type="button" onClick={disconnect} className="danger">
              Disconnect (Test Resume)
            </button>
          )}
          {events.length > 0 && !isConnected && (
            <button type="button" onClick={reset} className="secondary">
              Reset
            </button>
          )}
        </div>
      </form>

      <div className="status-panel">
        <div className="status-row">
          <span className="label">Connection:</span>
          <span className={`badge ${isConnected ? 'success' : 'inactive'}`}>
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </span>
        </div>

        {isReconnecting && (
          <div className="status-row">
            <span className="label">Reconnecting:</span>
            <span className="badge warning">
              ⚠️ Attempt {reconnectAttempts}/5
            </span>
          </div>
        )}

        {resumeToken && (
          <div className="status-row">
            <span className="label">Resume Token:</span>
            <code className="token">
              {resumeToken.substring(0, 20)}...
            </code>
          </div>
        )}

        {error && (
          <div className="status-row">
            <span className="label">Error:</span>
            <span className="badge danger">{error}</span>
          </div>
        )}

        {lastStage && (
          <div className="status-row">
            <span className="label">Current Stage:</span>
            <span className="badge info">{lastStage.data.stage}</span>
          </div>
        )}
      </div>

      <div className="events-panel">
        <div className="panel-header">
          <h2>Events ({events.length})</h2>
        </div>
        <div className="events-list">
          {events.length === 0 ? (
            <p className="empty-state">No events yet. Start a stream to see live updates.</p>
          ) : (
            events.map((event, index) => (
              <div key={index} className={`event event-${event.type}`}>
                <div className="event-header">
                  <span className="event-type">{event.type}</span>
                  <span className="event-index">#{index + 1}</span>
                </div>
                {event.type !== 'heartbeat' && (
                  <pre className="event-data">
                    {JSON.stringify(event.data, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="footer">
        <p>
          💡 <strong>Try it:</strong> Click "Disconnect" mid-stream to test automatic
          resume with exponential backoff.
        </p>
      </div>
    </div>
  );
}

export default App;
