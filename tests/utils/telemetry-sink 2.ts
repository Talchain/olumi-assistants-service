/**
 * In-memory Telemetry Sink for Testing (v1.11.0)
 *
 * Captures telemetry events emitted during tests for assertion purposes.
 * Validates that runbooks remain trustworthy by verifying event emission.
 *
 * Usage:
 *   const sink = new TelemetrySink();
 *   sink.install(); // Monkey-patch global emit
 *   // ... run test ...
 *   sink.expectEvent('SseResumeAttempt', { request_id: 'test-123' });
 *   sink.uninstall(); // Restore original emit
 */

type TelemetryEvent = {
  name: string;
  data: Record<string, any>;
  timestamp: number;
};

export class TelemetrySink {
  private events: TelemetryEvent[] = [];
  private telemetryModule: any = null;

  /**
   * Install the sink using the telemetry module's test hook
   * Only works in test environment for safety
   */
  async install(): Promise<void> {
    // Safety check: only allow in test environment
    if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
      throw new Error('TelemetrySink.install() can only be used in test environment');
    }

    // Dynamically import to avoid circular dependencies
    this.telemetryModule = await import('../../src/utils/telemetry.js');

    // Register sink callback
    const self = this;
    this.telemetryModule.setTestSink((eventName: string, data: Record<string, any>) => {
      self.capture(eventName, data);
    });
  }

  /**
   * Uninstall the sink
   */
  uninstall(): void {
    if (this.telemetryModule) {
      this.telemetryModule.setTestSink(null);
    }
  }

  /**
   * Capture an event
   */
  capture(name: string, data: Record<string, any>): void {
    this.events.push({
      name,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Get all captured events
   */
  getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  /**
   * Get events by name
   */
  getEventsByName(name: string): TelemetryEvent[] {
    return this.events.filter((e) => e.name === name);
  }

  /**
   * Check if event was emitted
   */
  hasEvent(name: string): boolean {
    return this.events.some((e) => e.name === name);
  }

  /**
   * Check if event was emitted with matching tags
   */
  hasEventWithTags(name: string, tags: Partial<Record<string, any>>): boolean {
    return this.events.some((e) => {
      if (e.name !== name) return false;

      return Object.keys(tags).every((key) => {
        return e.data[key] === tags[key];
      });
    });
  }

  /**
   * Expect event to have been emitted (throws if not found)
   */
  expectEvent(name: string, message?: string): void {
    if (!this.hasEvent(name)) {
      throw new Error(
        message || `Expected telemetry event '${name}' but it was not emitted`
      );
    }
  }

  /**
   * Expect event with tags (throws if not found)
   */
  expectEventWithTags(
    name: string,
    tags: Partial<Record<string, any>>,
    message?: string
  ): void {
    if (!this.hasEventWithTags(name, tags)) {
      const captured = this.getEventsByName(name);
      throw new Error(
        message ||
          `Expected telemetry event '${name}' with tags ${JSON.stringify(tags)} ` +
            `but it was not found. Captured ${captured.length} '${name}' events: ` +
            JSON.stringify(captured.map((e) => e.data), null, 2)
      );
    }
  }

  /**
   * Count events by name
   */
  countEvents(name: string): number {
    return this.getEventsByName(name).length;
  }

  /**
   * Clear all captured events
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Get summary of captured events
   */
  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {};

    for (const event of this.events) {
      summary[event.name] = (summary[event.name] || 0) + 1;
    }

    return summary;
  }

  /**
   * Print summary to console (useful for debugging)
   */
  printSummary(): void {
    const summary = this.getSummary();
    console.log('Telemetry Sink Summary:');
    console.log(JSON.stringify(summary, null, 2));
  }
}

/**
 * Helper to create and manage a sink for a test
 */
export function createTelemetrySink(): {
  sink: TelemetrySink;
  install: () => Promise<void>;
  uninstall: () => void;
} {
  const sink = new TelemetrySink();

  return {
    sink,
    install: () => sink.install(),
    uninstall: () => sink.uninstall(),
  };
}

/**
 * Vitest matcher helpers
 */
export function expectTelemetry(sink: TelemetrySink) {
  return {
    toContain(eventName: string): void {
      sink.expectEvent(eventName);
    },
    toContainWithTags(eventName: string, tags: Partial<Record<string, any>>): void {
      sink.expectEventWithTags(eventName, tags);
    },
    toHaveCount(eventName: string, count: number): void {
      const actual = sink.countEvents(eventName);
      if (actual !== count) {
        throw new Error(
          `Expected ${count} '${eventName}' events but found ${actual}`
        );
      }
    },
  };
}
