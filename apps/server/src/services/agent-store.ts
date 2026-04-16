import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import type { Agent, AgentStatus, AgentVisibility } from '@aquarium/shared';

/**
 * Agent store — CRUD + archive/restore for the `agents` table.
 *
 * Responsibilities (Phase 17):
 *   • createAgent(args)      — create a new agent with validated 1..16 MCT + runtime FK check
 *   • updateAgent(id, ws, p) — patch an agent, re-running 1..16 validation if MCT is in the patch
 *   • archiveAgent(...)      — soft-delete: sets archived_at + archived_by (FK preservation per §ST4)
 *   • restoreAgent(...)      — clears archived_at + archived_by
 *   • getAgent(id, ws)       — single row, includes archived (caller filters)
 *   • listAgents(ws, opts)   — workspace-scoped, default excludes archived
 *
 * HARD constraints:
 *   • All reads/writes are workspace-scoped (CE passes 'AQ' from route).
 *   • max_concurrent_tasks validated at the API boundary before INSERT/UPDATE —
 *     the migration-005 trigger (1..16) is the backstop, not the first check.
 *   • Archival is soft-delete: DB rows stay, issues.assignee_id + tasks.agent_id
 *     FKs remain valid, audit trail preserved (§ST4).
 *   • customEnv and customArgs are JSON columns — serialized via adapter.jsonValue()
 *     on write, parsed via adapter.parseJson() on read.
 */

function toAgent(row: Record<string, unknown>): Agent {
  const adapter = getAdapter();
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    runtimeId: (row.runtime_id as string) ?? null,
    name: row.name as string,
    avatarUrl: (row.avatar_url as string) ?? null,
    description: (row.description as string) ?? null,
    instructions: (row.instructions as string) ?? '',
    customEnv: row.custom_env
      ? (adapter.parseJson<Record<string, string>>(row.custom_env) ?? {})
      : {},
    customArgs: row.custom_args
      ? (adapter.parseJson<string[]>(row.custom_args) ?? [])
      : [],
    maxConcurrentTasks: Number(row.max_concurrent_tasks),
    visibility: row.visibility as AgentVisibility,
    status: row.status as AgentStatus,
    ownerUserId: (row.owner_user_id as string) ?? null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    archivedBy: (row.archived_by as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function validateMct(mct: number): void {
  if (!Number.isInteger(mct) || mct < 1 || mct > 16) {
    throw new Error('max_concurrent_tasks must be an integer between 1 and 16');
  }
}

function validateVisibility(v: string): asserts v is AgentVisibility {
  if (v !== 'private' && v !== 'workspace' && v !== 'public') {
    throw new Error("visibility must be 'private', 'workspace', or 'public'");
  }
}

async function assertRuntimeExists(workspaceId: string, runtimeId: string): Promise<void> {
  const row = await db('runtimes')
    .where({ id: runtimeId, workspace_id: workspaceId })
    .first('id');
  if (!row) throw new Error('runtime_id references an unknown runtime');
}

export interface CreateAgentArgs {
  workspaceId: string;
  name: string;
  runtimeId?: string | null;
  avatarUrl?: string | null;
  description?: string | null;
  instructions?: string;
  customEnv?: Record<string, string>;
  customArgs?: string[];
  maxConcurrentTasks?: number;
  visibility?: AgentVisibility;
  ownerUserId?: string | null;
}

export async function createAgent(args: CreateAgentArgs): Promise<Agent> {
  const adapter = getAdapter();
  const mct = args.maxConcurrentTasks ?? 6;
  validateMct(mct);
  if (args.visibility) validateVisibility(args.visibility);
  if (args.runtimeId) await assertRuntimeExists(args.workspaceId, args.runtimeId);

  const id = randomUUID();
  await db('agents').insert({
    id,
    workspace_id: args.workspaceId,
    runtime_id: args.runtimeId ?? null,
    name: args.name,
    avatar_url: args.avatarUrl ?? null,
    description: args.description ?? null,
    instructions: args.instructions ?? '',
    custom_env: adapter.jsonValue(args.customEnv ?? {}),
    custom_args: adapter.jsonValue(args.customArgs ?? []),
    max_concurrent_tasks: mct,
    visibility: args.visibility ?? 'workspace',
    status: 'idle',
    owner_user_id: args.ownerUserId ?? null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const created = await getAgent(id, args.workspaceId);
  if (!created) throw new Error('Agent creation failed — row not readable');
  return created;
}

export interface UpdateAgentPatch {
  name?: string;
  runtimeId?: string | null;
  avatarUrl?: string | null;
  description?: string | null;
  instructions?: string;
  customEnv?: Record<string, string>;
  customArgs?: string[];
  maxConcurrentTasks?: number;
  visibility?: AgentVisibility;
}

export async function updateAgent(
  id: string,
  workspaceId: string,
  patch: UpdateAgentPatch,
): Promise<Agent | null> {
  const adapter = getAdapter();
  if (patch.maxConcurrentTasks !== undefined) validateMct(patch.maxConcurrentTasks);
  if (patch.visibility !== undefined) validateVisibility(patch.visibility);
  if (patch.runtimeId !== undefined && patch.runtimeId !== null) {
    await assertRuntimeExists(workspaceId, patch.runtimeId);
  }

  const update: Record<string, unknown> = { updated_at: db.fn.now() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.runtimeId !== undefined) update.runtime_id = patch.runtimeId;
  if (patch.avatarUrl !== undefined) update.avatar_url = patch.avatarUrl;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.instructions !== undefined) update.instructions = patch.instructions;
  if (patch.customEnv !== undefined) update.custom_env = adapter.jsonValue(patch.customEnv);
  if (patch.customArgs !== undefined) update.custom_args = adapter.jsonValue(patch.customArgs);
  if (patch.maxConcurrentTasks !== undefined) update.max_concurrent_tasks = patch.maxConcurrentTasks;
  if (patch.visibility !== undefined) update.visibility = patch.visibility;

  const affected = await db('agents')
    .where({ id, workspace_id: workspaceId })
    .update(update);
  if (affected === 0) return null;
  return getAgent(id, workspaceId);
}

export async function archiveAgent(
  id: string,
  workspaceId: string,
  archivedByUserId: string | null,
): Promise<Agent | null> {
  const affected = await db('agents')
    .where({ id, workspace_id: workspaceId })
    .whereNull('archived_at')
    .update({
      archived_at: db.fn.now(),
      archived_by: archivedByUserId,
      updated_at: db.fn.now(),
    });
  if (affected === 0) return null;
  return getAgent(id, workspaceId);
}

export async function restoreAgent(
  id: string,
  workspaceId: string,
): Promise<Agent | null> {
  const affected = await db('agents')
    .where({ id, workspace_id: workspaceId })
    .whereNotNull('archived_at')
    .update({
      archived_at: null,
      archived_by: null,
      updated_at: db.fn.now(),
    });
  if (affected === 0) return null;
  return getAgent(id, workspaceId);
}

export async function getAgent(id: string, workspaceId: string): Promise<Agent | null> {
  const row = await db('agents')
    .where({ id, workspace_id: workspaceId })
    .first();
  return row ? toAgent(row as Record<string, unknown>) : null;
}

export interface ListAgentsOpts {
  includeArchived?: boolean;
}

export async function listAgents(
  workspaceId: string,
  opts: ListAgentsOpts = {},
): Promise<Agent[]> {
  let query = db('agents').where({ workspace_id: workspaceId });
  if (!opts.includeArchived) query = query.whereNull('archived_at');
  const rows = await query.orderBy('created_at', 'desc');
  return rows.map((r: Record<string, unknown>) => toAgent(r));
}
