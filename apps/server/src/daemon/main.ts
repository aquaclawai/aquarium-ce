/**
 * Daemon orchestrator entry point.
 *
 * Plan 21-02 ships this as a typecheck-only stub so `apps/server/src/cli.ts`'s
 * `await import('./daemon/main.js')` resolves. Plan 21-03 replaces every
 * export below with the real implementation (poll loop, claude backend wiring,
 * PID file, status ping). All exports currently throw `DaemonNotImplementedError`
 * so any accidental production use surfaces immediately rather than silently
 * returning.
 */

import type { DaemonStartOpts } from '../cli.js';

export class DaemonNotImplementedError extends Error {
  constructor(fn: string) {
    super(
      `daemon.${fn} not implemented — Plan 21-02 shipped HTTP/CLI/config only. ` +
        `Plan 21-03 wires the poll loop, claude backend, and orchestrator. ` +
        `Run a build from a branch that includes 21-03.`,
    );
    this.name = 'DaemonNotImplementedError';
  }
}

export async function startDaemon(_opts: DaemonStartOpts): Promise<void> {
  throw new DaemonNotImplementedError('startDaemon');
}

export async function stopDaemon(): Promise<void> {
  throw new DaemonNotImplementedError('stopDaemon');
}

export async function daemonStatus(): Promise<void> {
  throw new DaemonNotImplementedError('daemonStatus');
}

export async function listTokens(): Promise<void> {
  throw new DaemonNotImplementedError('listTokens');
}

export async function revokeToken(_id: string): Promise<void> {
  throw new DaemonNotImplementedError('revokeToken');
}
