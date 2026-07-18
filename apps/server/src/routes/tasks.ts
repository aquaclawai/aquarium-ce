import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import {
  listMessagesAfterSeq,
  getFullMessage,
  FULL_MESSAGE_ABSOLUTE_CAP_BYTES,
} from '../services/task-message-store.js';
import { cancelTask } from '../services/task-queue-store.js';
import type { ApiResponse } from '@aquarium/shared';

/**
 * Phase 24-00 — /api/tasks/* router.
 *
 *   GET /api/tasks/:id/messages?afterSeq=N   — ST2 REST replay (ASC paginated)
 *   GET /api/tasks/:id/messages/:seq/full    — UX6 "Show full" uncapped lookup
 *   POST /api/tasks/:id/cancel               — wave 2/5 CTA backing route
 *
 * Auth: standard `requireAuth` (cookie-JWT). AUTH1 guard inside requireAuth
 * rejects `adt_*` daemon bearers so a compromised daemon cannot hit these.
 */

const router = Router();
router.use(requireAuth);

router.get('/:id/messages', async (req, res) => {
  try {
    const raw = req.query.afterSeq;
    const afterSeq = raw === undefined ? 0 : Number(raw);
    if (!Number.isFinite(afterSeq) || afterSeq < 0 || !Number.isInteger(afterSeq)) {
      res
        .status(400)
        .json({ ok: false, error: 'afterSeq must be a non-negative integer' } satisfies ApiResponse);
      return;
    }
    const result = await listMessagesAfterSeq(db, req.params.id, afterSeq);
    res.json({ ok: true, data: result } satisfies ApiResponse<typeof result>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.get('/:id/messages/:seq/full', async (req, res) => {
  try {
    const seq = Number(req.params.seq);
    if (!Number.isFinite(seq) || seq < 1 || !Number.isInteger(seq)) {
      res
        .status(400)
        .json({ ok: false, error: 'seq must be a positive integer' } satisfies ApiResponse);
      return;
    }
    const full = await getFullMessage(db, req.params.id, seq);
    if (!full) {
      res.status(404).json({ ok: false, error: 'task message not found' } satisfies ApiResponse);
      return;
    }
    // Enforce the absolute byte cap against the assembled response body so
    // an adversarial overflow row can't force a 10 MB payload.
    const contentBytes = full.content
      ? Buffer.byteLength(full.content, 'utf8')
      : 0;
    const outputBytes =
      typeof full.output === 'string' ? Buffer.byteLength(full.output, 'utf8') : 0;
    const inputBytes =
      typeof full.input === 'string'
        ? Buffer.byteLength(full.input, 'utf8')
        : full.input === null || full.input === undefined
          ? 0
          : Buffer.byteLength(JSON.stringify(full.input), 'utf8');
    if (contentBytes + outputBytes + inputBytes > FULL_MESSAGE_ABSOLUTE_CAP_BYTES) {
      res
        .status(413)
        .json({ ok: false, error: 'full message exceeds absolute size cap' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: full } satisfies ApiResponse<typeof full>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const result = await cancelTask(req.params.id);
    res.json({ ok: true, data: result } satisfies ApiResponse<typeof result>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
