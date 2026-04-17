/**
 * Task-message store — Phase 24-00.
 *
 * Central module for UX6 truncation + ST2 replay surfaces:
 *   • `truncateForStorage` — byte-bounded truncation that preserves the
 *     original payload via overflow storage. Called on the task_messages
 *     INSERT path (batcher).
 *   • `listMessagesAfterSeq` — ASC paginated replay (REST
 *     /api/tasks/:id/messages?afterSeq=N).
 *   • `listRecentMessagesAfterSeq` — most-recent N via DESC LIMIT + reverse
 *     (WS subscribe_task replay, capped at 500 by default).
 *   • `listTaskMessagesOfKind` — completion-path helper (Wave 5: hosted +
 *     daemon completion routes concatenate text rows into the agent comment).
 *   • `getFullMessage` — overflow-first uncapped fetch for the UI's
 *     "Show full" affordance.
 *
 * Row-shape contract: the public helpers all return `TaskMessage` per
 * packages/shared/src/v14-types.ts — JSON columns are parsed via
 * `getAdapter().parseJson` so SQLite TEXT and Postgres JSONB round-trip
 * identically.
 */

import type { Knex } from 'knex';
import type { TaskMessage, TaskMessageType } from '@aquarium/shared';
import { getAdapter } from '../db/adapter.js';

/** UX6: per-field byte limit stored in task_messages (applies to content,
 *  serialized input JSON, and output). */
export const TASK_MESSAGE_CONTENT_LIMIT_BYTES = 16_384;

/** ST2: maximum rows returned by a single replay request (both REST and WS
 *  paths share this cap). */
export const REPLAY_ROW_CAP = 500;

/** Absolute ceiling on GET /api/tasks/:id/messages/:seq/full response body.
 *  Defends against adversarial agent output piling into the overflow table. */
export const FULL_MESSAGE_ABSOLUTE_CAP_BYTES = 1_048_576; // 1 MB

export interface TruncationResult {
  /** Truncated content (<= LIMIT bytes) or the original string when no
   *  truncation was required. `null` when no content field was supplied. */
  truncatedContent: string | null;
  /** Truncated `input` value — either the original object (no truncation
   *  needed) or the serialized-and-truncated JSON string. May be `null`
   *  when the caller supplied no input. */
  truncatedInput: unknown;
  /** Truncated tool_result output (<= LIMIT bytes) or the original. */
  truncatedOutput: string | null;
  /** Pre-truncation byte length of whichever field actually exceeded the
   *  limit (0 if nothing did). */
  originalBytes: number;
  /** True iff any field was actually truncated. */
  didTruncate: boolean;
  /** Per-field overflow blobs. `null` when no truncation happened; each
   *  individual field is `null` if that field did not exceed the limit. */
  overflow: {
    content: string | null;
    input_json: string | null;
    output: string | null;
  } | null;
}

/**
 * Truncate a `string` to at most `limit` bytes while preserving valid UTF-8.
 * Buffer.from(s).subarray(0, limit).toString('utf8') will drop a trailing
 * partial multi-byte sequence as a REPLACEMENT CHARACTER; we strip that
 * so consumers always get a clean prefix.
 */
function truncateUtf8ToBytes(s: string, limit: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.byteLength <= limit) return s;
  // Walk back to the largest safe prefix: a UTF-8 continuation byte has the
  // form 10xxxxxx (0x80-0xBF). If buf[limit-1] is a continuation or the
  // leading byte of a multi-byte sequence whose rest would be truncated, we
  // scan backwards to the last start-of-codepoint byte.
  let end = limit;
  while (end > 0 && (buf[end - 1]! & 0b1100_0000) === 0b1000_0000) {
    // Currently on a continuation byte; keep walking back.
    end -= 1;
  }
  if (end > 0) {
    const leading = buf[end - 1]!;
    // If the byte at end-1 starts a multi-byte code point, determine how many
    // bytes the code point needs and drop it entirely if truncated mid-way.
    let needed = 0;
    if ((leading & 0b1110_0000) === 0b1100_0000) needed = 2;
    else if ((leading & 0b1111_0000) === 0b1110_0000) needed = 3;
    else if ((leading & 0b1111_1000) === 0b1111_0000) needed = 4;
    if (needed > 0 && limit - (end - 1) < needed) {
      end -= 1;
    }
  }
  return buf.subarray(0, end).toString('utf8');
}

/**
 * Compute the truncation result for a pending task-message payload.
 * Each field (content, input, output) is evaluated independently so callers
 * can write partial-overflow rows (e.g. content truncated but output not).
 */
export function truncateForStorage(args: {
  content: string | null | undefined;
  input: unknown;
  output: unknown;
}): TruncationResult {
  const contentIn = args.content ?? null;
  const outputRaw = args.output;
  const outputStr = typeof outputRaw === 'string' ? outputRaw : null;

  // Serialize input to JSON up-front — mirror the render-side contract.
  // Strings are stored as-is so we don't double-encode.
  const inputIn = args.input;
  const inputSerialized =
    inputIn === undefined || inputIn === null
      ? null
      : typeof inputIn === 'string'
        ? inputIn
        : JSON.stringify(inputIn);

  const contentBytes = contentIn === null ? 0 : Buffer.byteLength(contentIn, 'utf8');
  const inputBytes =
    inputSerialized === null ? 0 : Buffer.byteLength(inputSerialized, 'utf8');
  const outputBytes = outputStr === null ? 0 : Buffer.byteLength(outputStr, 'utf8');

  const limit = TASK_MESSAGE_CONTENT_LIMIT_BYTES;
  const contentOver = contentIn !== null && contentBytes > limit;
  const inputOver = inputSerialized !== null && inputBytes > limit;
  const outputOver = outputStr !== null && outputBytes > limit;
  const didTruncate = contentOver || inputOver || outputOver;

  if (!didTruncate) {
    return {
      truncatedContent: contentIn,
      truncatedInput: inputIn ?? null,
      truncatedOutput: outputStr,
      originalBytes: 0,
      didTruncate: false,
      overflow: null,
    };
  }

  // `originalBytes` is reported as the single largest offending field so the
  // UI can render `{shown} of {total} bytes` against the principal payload.
  const originalBytes = Math.max(
    contentOver ? contentBytes : 0,
    inputOver ? inputBytes : 0,
    outputOver ? outputBytes : 0,
  );

  const truncatedContent = contentOver
    ? truncateUtf8ToBytes(contentIn!, limit)
    : contentIn;

  let truncatedInputValue: unknown;
  if (inputOver) {
    // Serialized-and-truncated JSON STRING (not re-parsed) — the wire/render
    // path treats tool_use input as JSON text in a <pre> block.
    truncatedInputValue = truncateUtf8ToBytes(inputSerialized!, limit);
  } else {
    truncatedInputValue = inputIn ?? null;
  }

  const truncatedOutput = outputOver
    ? truncateUtf8ToBytes(outputStr!, limit)
    : outputStr;

  return {
    truncatedContent,
    truncatedInput: truncatedInputValue,
    truncatedOutput,
    originalBytes,
    didTruncate: true,
    overflow: {
      content: contentOver ? contentIn : null,
      input_json: inputOver ? inputSerialized : null,
      output: outputOver ? outputStr : null,
    },
  };
}

/** Coerce a raw DB row into the shared TaskMessage shape. */
function toTaskMessage(row: Record<string, unknown>): TaskMessage {
  const adapter = getAdapter();
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    seq: Number(row.seq),
    type: row.type as TaskMessageType,
    tool: (row.tool as string | null) ?? null,
    content: (row.content as string | null) ?? null,
    input: row.input === null || row.input === undefined
      ? null
      : typeof row.input === 'string'
        ? adapter.parseJson<unknown>(row.input)
        : row.input,
    output: row.output === null || row.output === undefined
      ? null
      : typeof row.output === 'string'
        ? adapter.parseJson<unknown>(row.output)
        : row.output,
    metadata: row.metadata === null || row.metadata === undefined
      ? {}
      : typeof row.metadata === 'string'
        ? (adapter.parseJson<Record<string, unknown>>(row.metadata) ?? {})
        : (row.metadata as Record<string, unknown>),
    createdAt: String(row.created_at),
  };
}

/**
 * ASC paginated replay for the REST endpoint
 * GET /api/tasks/:id/messages?afterSeq=N. Returns at most REPLAY_ROW_CAP
 * rows per call with a `hasMore` signal so the client can paginate.
 */
export async function listMessagesAfterSeq(
  db: Knex,
  taskId: string,
  afterSeq: number,
): Promise<{ messages: TaskMessage[]; hasMore: boolean }> {
  const rows = (await db('task_messages')
    .where({ task_id: taskId })
    .andWhere('seq', '>', afterSeq)
    .orderBy('seq', 'asc')
    .limit(REPLAY_ROW_CAP + 1)) as Array<Record<string, unknown>>;
  const hasMore = rows.length > REPLAY_ROW_CAP;
  const trimmed = hasMore ? rows.slice(0, REPLAY_ROW_CAP) : rows;
  return { messages: trimmed.map(toTaskMessage), hasMore };
}

/**
 * WS subscribe_task replay helper — returns the MOST-RECENT `limit` rows
 * with seq > afterSeq. Implementation: ORDER BY seq DESC LIMIT limit, then
 * reverse in memory so callers see ASC order.
 *
 * Used by the WS handler to bound replay at 500 rows even when the client
 * reconnects with an ancient lastSeq. `olderOmittedCount > 0` signals the
 * handler to emit a `replay_truncated` sentinel event before the rows.
 */
export async function listRecentMessagesAfterSeq(
  db: Knex,
  taskId: string,
  afterSeq: number,
  limit: number,
): Promise<{ messages: TaskMessage[]; olderOmittedCount: number }> {
  const rows = (await db('task_messages')
    .where({ task_id: taskId })
    .andWhere('seq', '>', afterSeq)
    .orderBy('seq', 'desc')
    .limit(limit)) as Array<Record<string, unknown>>;

  const countRow = (await db('task_messages')
    .where({ task_id: taskId })
    .andWhere('seq', '>', afterSeq)
    .count<{ c: number | string }[]>('* as c')
    .first()) as { c: number | string } | undefined;
  const total = countRow ? Number(countRow.c) : rows.length;
  const olderOmittedCount = Math.max(0, total - rows.length);

  const asc = [...rows].reverse().map(toTaskMessage);
  return { messages: asc, olderOmittedCount };
}

/**
 * Completion-path helper. Returns every task_message of the given kind for
 * a task in seq ASC order. Used by Wave 5 (hosted + daemon completion) to
 * reconstruct the agent's final text from DB without reaching into the
 * in-memory batcher.
 */
export async function listTaskMessagesOfKind(
  db: Knex,
  taskId: string,
  kind: TaskMessageType,
): Promise<TaskMessage[]> {
  const rows = (await db('task_messages')
    .where({ task_id: taskId, type: kind })
    .orderBy('seq', 'asc')) as Array<Record<string, unknown>>;
  return rows.map(toTaskMessage);
}

/**
 * Overflow-first uncapped lookup. Fetches the truncated row from
 * task_messages and merges in the uncapped fields from task_message_overflow
 * when present. Returns `null` if the row does not exist. Caps the returned
 * payload at FULL_MESSAGE_ABSOLUTE_CAP_BYTES (byte cap on content — oversize
 * fields are cropped and flagged via metadata.clippedForRender).
 */
export async function getFullMessage(
  db: Knex,
  taskId: string,
  seq: number,
): Promise<TaskMessage | null> {
  const row = (await db('task_messages')
    .where({ task_id: taskId, seq })
    .first()) as Record<string, unknown> | undefined;
  if (!row) return null;

  const overflow = (await db('task_message_overflow')
    .where({ task_id: taskId, seq })
    .first()) as Record<string, unknown> | undefined;

  const adapter = getAdapter();
  const base = toTaskMessage(row);

  if (!overflow) return base;

  let content = base.content;
  let input: unknown = base.input;
  let output: unknown = base.output;
  let clipped = false;

  if (typeof overflow.content === 'string') {
    if (Buffer.byteLength(overflow.content, 'utf8') > FULL_MESSAGE_ABSOLUTE_CAP_BYTES) {
      content = truncateUtf8ToBytes(overflow.content, FULL_MESSAGE_ABSOLUTE_CAP_BYTES);
      clipped = true;
    } else {
      content = overflow.content;
    }
  }
  if (typeof overflow.input_json === 'string') {
    if (Buffer.byteLength(overflow.input_json, 'utf8') > FULL_MESSAGE_ABSOLUTE_CAP_BYTES) {
      input = truncateUtf8ToBytes(overflow.input_json, FULL_MESSAGE_ABSOLUTE_CAP_BYTES);
      clipped = true;
    } else {
      // Prefer to return the input as its original shape (parsed) when valid;
      // fall back to the raw JSON string if parsing fails.
      try {
        input = adapter.parseJson<unknown>(overflow.input_json);
      } catch {
        input = overflow.input_json;
      }
    }
  }
  if (typeof overflow.output === 'string') {
    if (Buffer.byteLength(overflow.output, 'utf8') > FULL_MESSAGE_ABSOLUTE_CAP_BYTES) {
      output = truncateUtf8ToBytes(overflow.output, FULL_MESSAGE_ABSOLUTE_CAP_BYTES);
      clipped = true;
    } else {
      output = overflow.output;
    }
  }

  const mergedMetadata = { ...base.metadata };
  if (clipped) {
    (mergedMetadata as Record<string, unknown>).clippedForRender = true;
  }
  // Preserve truncation provenance from task_messages row so the client can
  // still render {original_bytes} from the overflow table.
  if (typeof overflow.original_bytes === 'number' && !('originalBytes' in mergedMetadata)) {
    (mergedMetadata as Record<string, unknown>).originalBytes = overflow.original_bytes;
  }

  return {
    ...base,
    content,
    input,
    output,
    metadata: mergedMetadata,
  };
}
