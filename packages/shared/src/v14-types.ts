/**
 * v1.4 Task Delegation Platform — shared TypeScript types.
 *
 * These types describe the wire / DTO shapes exchanged between:
 *  - Express route handlers (apps/server/src/routes/*.ts)
 *  - React components (apps/web/src/*.tsx)
 *  - Daemon HTTP client (apps/server/src/daemon/*.ts)
 *
 * Database row shapes (snake_case, JSON-as-string) are NOT exported from
 * here — they live inside apps/server/src/db/ and are converted at the
 * service-layer boundary.
 *
 * Covers SCH-10. Values MUST stay in lock-step with migration triggers
 * (see apps/server/src/db/migrations/004_runtimes.ts onward).
 */

// ── Workspace ───────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  issuePrefix: string;
  issueCounter: number;
  ownerUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ── Runtime ─────────────────────────────────────────────────────────────────

export type RuntimeKind = 'local_daemon' | 'external_cloud_daemon' | 'hosted_instance';
export type RuntimeStatus = 'online' | 'offline' | 'error';
export type RuntimeProvider = 'claude' | 'codex' | 'openclaw' | 'opencode' | 'hermes' | 'hosted';

export interface RuntimeDeviceInfo {
  os?: string;
  hostname?: string;
  arch?: string;
  version?: string;
}

export interface Runtime {
  id: string;
  workspaceId: string;
  name: string;
  kind: RuntimeKind;
  provider: RuntimeProvider;
  status: RuntimeStatus;
  daemonId: string | null;
  deviceInfo: RuntimeDeviceInfo | null;
  lastHeartbeatAt: string | null;
  instanceId: string | null;
  metadata: Record<string, unknown>;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Agent ───────────────────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'error' | 'offline';
export type AgentVisibility = 'private' | 'workspace' | 'public';

export interface Agent {
  id: string;
  workspaceId: string;
  runtimeId: string | null;
  name: string;
  avatarUrl: string | null;
  description: string | null;
  instructions: string;
  customEnv: Record<string, string>;
  customArgs: string[];
  maxConcurrentTasks: number;
  visibility: AgentVisibility;
  status: AgentStatus;
  ownerUserId: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Issue ───────────────────────────────────────────────────────────────────

export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled';
export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export interface Issue {
  id: string;
  workspaceId: string;
  issueNumber: number;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId: string | null;
  creatorUserId: string | null;
  position: number | null;
  dueDate: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ── Comment ─────────────────────────────────────────────────────────────────

export type CommentType = 'comment' | 'status_change' | 'progress_update' | 'system';
export type CommentAuthorType = 'user' | 'agent' | 'system';

export interface Comment {
  id: string;
  issueId: string;
  authorType: CommentAuthorType;
  authorUserId: string | null;
  authorAgentId: string | null;
  content: string;
  type: CommentType;
  parentId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ── Task queue ──────────────────────────────────────────────────────────────

export type TaskStatus = 'queued' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentTask {
  id: string;
  workspaceId: string;
  issueId: string;
  agentId: string;
  runtimeId: string;
  triggerCommentId: string | null;
  status: TaskStatus;
  priority: number;
  sessionId: string | null;
  workDir: string | null;
  error: string | null;
  result: unknown;
  metadata: Record<string, unknown>;
  dispatchedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Task messages ──────────────────────────────────────────────────────────

export type TaskMessageType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';

export interface TaskMessage {
  id: string;
  taskId: string;
  seq: number;
  type: TaskMessageType;
  tool: string | null;
  content: string | null;
  input: unknown;
  output: unknown;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ── Daemon tokens ───────────────────────────────────────────────────────────

/** Public projection of a daemon token row (plaintext is never returned after creation). */
export interface DaemonToken {
  id: string;
  workspaceId: string;
  name: string;
  daemonId: string | null;
  createdByUserId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned by `POST /api/daemon-tokens` exactly once — plaintext exposed here and NOWHERE else. */
export interface DaemonTokenCreatedResponse {
  token: DaemonToken;
  plaintext: string;
}

// ── Daemon REST wire types (Phase 19) ───────────────────────────────────────

export interface DaemonRegisterRequest {
  workspaceId: string;
  daemonId: string;
  deviceName: string;
  cliVersion: string;
  launchedBy: string;
  runtimes: Array<{
    name: string;
    provider: RuntimeProvider;
    version: string;
    status: RuntimeStatus;
  }>;
}

export interface DaemonRegisterResponse {
  runtimes: Runtime[];
}

// ── Daemon CLI agent-backend shared types (Phase 21) ─────────────────────────

/**
 * Unified discriminated union emitted by EVERY agent backend (Phase 21: claude;
 * Phase 22: codex / openclaw / opencode / hermes). The daemon translates each
 * backend's native stream into this shape before batching HTTP messages.
 *
 * `kind` is the discriminator. Every branch uses primitive / JSON-serialisable
 * fields so the union round-trips through `/api/daemon/tasks/:id/messages`.
 */
export type AgentMessage =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; thinking: string }
  | { kind: 'tool_use'; toolUseId: string; toolName: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { kind: 'error'; error: string };

/**
 * On-disk shape of `~/.aquarium/daemon.json`. All fields optional — the
 * daemon overlays env vars + CLI flags + built-in defaults before using.
 * Tokens MUST live here (or env) — NEVER on argv (PM7 leak via `ps aux`).
 */
export interface DaemonConfigFile {
  server?: string;
  token?: string;
  deviceName?: string;
  maxConcurrentTasks?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  cancelPollIntervalMs?: number;
  messageFlushIntervalMs?: number;
  inactivityKillMs?: number;
  gracefulKillMs?: number;
  gracefulShutdownMs?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  backends?: {
    claude?: { allow?: string[] };
  };
}

/** Returned by POST /api/daemon/runtimes/:id/tasks/claim when a task is available. */
export interface ClaimedTask extends AgentTask {
  agent: {
    id: string;
    name: string;
    instructions: string;
    customEnv: Record<string, string>;
    customArgs: string[];
  };
  issue: {
    id: string;
    issueNumber: number;
    title: string;
    description: string | null;
  };
  triggerCommentContent: string | null;
  workspaceId: string;
}

// ── WebSocket events (Phase 18+) ────────────────────────────────────────────

export type TaskEventType =
  | 'task:dispatch'
  | 'task:progress'
  | 'task:message'
  | 'task:completed'
  | 'task:failed'
  | 'task:cancelled';

export interface TaskEventPayload {
  taskId: string;
  issueId: string;
  seq?: number;
  type?: TaskMessageType;
  tool?: string;
  content?: string | null;
  input?: unknown;
  output?: unknown;
}
