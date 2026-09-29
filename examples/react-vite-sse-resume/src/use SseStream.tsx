import { useState, useEffect, useRef, useCallback } from 'react';

export interface SseEvent {
  type: string;
  data: any;
}

export interface UseSseStreamOptions {
  baseUrl?: string;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface UseSseStreamResult {
  events: SseEvent[];
  isConnected: boolean;
  isReconnecting: boolean;
  error: string | null;
  reconnectAttempts: number;
  resumeToken: string | null;
  startStream: (brief: string) => void;
  disconnect: () => void;
  reset: () => void;
}

/**
 * React hook for SSE streaming with automatic resume and reconnection
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Resume token management
 * - Live resume mode
 * - Event accumulation
 * - Connection state tracking
 */
export function useSseStream(options: UseSseStreamOptions = {}): UseSseStreamResult {
  const {
    baseUrl = '',
    maxRetries = 5,
    initialBackoffMs = 1500,
    maxBackoffMs = 30000,
  } = options;

  const [events, setEvents] = useState<SseEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [resumeToken, setResumeToken] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const currentBriefRef = useRef<string | null>(null);

  /**
   * Parse SSE event from raw text
   */
  const parseSseEvent = (eventText: string): SseEvent | null => {
    const lines = eventText.trim().split('\n');
    let eventType = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.substring(7).trim();
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.substring(6));
      } else if (line.startsWith(': ')) {
        eventType = 'heartbeat';
      }
    }

    if (eventType === 'heartbeat') {
      return { type: 'heartbeat', data: null };
    }

    if (dataLines.length === 0) {
      return null;
    }

    try {
      const data = JSON.parse(dataLines.join('\n'));
      return { type: eventType, data };
    } catch {
      return null;
    }
  };

  /**
   * Connect to SSE stream (initial or resume)
   */
  const connectStream = useCallback(async (isResume: boolean = false) => {
    // Cancel any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Create new abort controller
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      setError(null);

      const url = isResume && resumeToken
        ? `${baseUrl}/assist/draft-graph/resume?mode=live`
        : `${baseUrl}/assist/draft-graph/stream`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (isResume && resumeToken) {
        headers['X-Resume-Token'] = resumeToken;
        headers['X-Resume-Mode'] = 'live';
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: isResume ? undefined : JSON.stringify({ brief: currentBriefRef.current }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      setIsConnected(true);
      setIsReconnecting(false);
      setReconnectAttempts(0);

      // Read stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('Stream completed');
          setIsConnected(false);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (part.trim()) {
            const event = parseSseEvent(part);
            if (event) {
              // Update resume token
              if (event.type === 'resume' && event.data?.token) {
                setResumeToken(event.data.token);
              }

              // Add event to list
              setEvents((prev) => [...prev, event]);

              // Check for completion
              if (event.type === 'stage' && event.data?.stage === 'COMPLETE') {
                setIsConnected(false);
                reader.releaseLock();
                return;
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Stream aborted');
        return;
      }

      console.error('Stream error:', err);
      setError(err.message);
      setIsConnected(false);

      // Attempt to reconnect if we have a resume token
      if (resumeToken && reconnectAttempts < maxRetries) {
        const backoff = Math.min(
          initialBackoffMs * Math.pow(2, reconnectAttempts),
          maxBackoffMs
        );

        console.log(`Reconnecting in ${backoff}ms (attempt ${reconnectAttempts + 1}/${maxRetries})`);

        setIsReconnecting(true);
        setReconnectAttempts((prev) => prev + 1);

        reconnectTimeoutRef.current = window.setTimeout(() => {
          connectStream(true);
        }, backoff);
      } else {
        setIsReconnecting(false);
        setError(`Failed after ${reconnectAttempts} reconnect attempts`);
      }
    }
  }, [resumeToken, reconnectAttempts, maxRetries, initialBackoffMs, maxBackoffMs, baseUrl]);

  /**
   * Start a new stream
   */
  const startStream = useCallback((brief: string) => {
    currentBriefRef.current = brief;
    setEvents([]);
    setResumeToken(null);
    setReconnectAttempts(0);
    setError(null);
    connectStream(false);
  }, [connectStream]);

  /**
   * Manually disconnect
   */
  const disconnect = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
    setIsReconnecting(false);
  }, []);

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    disconnect();
    setEvents([]);
    setResumeToken(null);
    setReconnectAttempts(0);
    setError(null);
  }, [disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    events,
    isConnected,
    isReconnecting,
    error,
    reconnectAttempts,
    resumeToken,
    startStream,
    disconnect,
    reset,
  };
}
