// Types for migrate-locked.mjs, for the integration test (allowJs is off).
import type { EventEmitter } from "node:events";

export const LOCK_KEY: string;

export function dbmateArgs(url: string): string[];

export interface LockClient extends EventEmitter {
  query(text: string, params?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

export interface LockedChild extends EventEmitter {
  exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
}

export function runLocked(options: {
  connect: () => Promise<LockClient>;
  start: () => LockedChild;
  heartbeatMs?: number;
  lockTimeoutMs?: number;
  killGraceMs?: number;
  log?: (line: string) => void;
}): Promise<number>;
