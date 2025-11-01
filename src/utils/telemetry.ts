import pino from "pino";

export const log = pino({ level: process.env.LOG_LEVEL || "info" });

export type Event = Record<string, unknown>;

export function emit(event: string, data: Event) {
  log.info({ event, ...data });
}
