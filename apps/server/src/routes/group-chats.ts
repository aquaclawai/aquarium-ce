import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  createGroupChat,
  listGroupChats,
  getGroupChat,
  updateGroupChat,
  deleteGroupChat,
  addMember,
  removeMember,
  updateMember,
  sendMessage,
  getMessages,
  retryMessage,
} from '../services/group-chat-manager.js';
import type {
  ApiResponse,
  GroupChat,
  GroupChatMember,
  GroupChatMessage,
  GroupChatMessagesResponse,
  GroupChatMessageSentResponse,
  RetryGroupChatMessageResponse,
  CreateGroupChatRequest,
  UpdateGroupChatRequest,
  AddGroupChatMemberRequest,
  UpdateGroupChatMemberRequest,
  SendGroupChatMessageRequest,
  RetryGroupChatMessageRequest,
} from '@aquarium/shared';
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_SIZE, MAX_ATTACHMENTS_PER_MESSAGE } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// GET / — list group chats for current user
router.get('/', async (req, res) => {
  try {
    const chats = await listGroupChats(req.auth!.userId);
    res.json({ ok: true, data: chats } satisfies ApiResponse<GroupChat[]>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST / — create a new group chat
router.post('/', async (req, res) => {
  try {
    const body = req.body as CreateGroupChatRequest;
    if (!body.name || !body.instanceIds || body.instanceIds.length === 0) {
      res.status(400).json({ ok: false, error: 'Missing name or instanceIds' } satisfies ApiResponse);
      return;
    }
    if (!body.displayNames) {
      res.status(400).json({ ok: false, error: 'Missing displayNames' } satisfies ApiResponse);
      return;
    }
    const chat = await createGroupChat(req.auth!.userId, body);
    res.status(201).json({ ok: true, data: chat } satisfies ApiResponse<GroupChat>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// GET /:id — get a specific group chat
router.get('/:id', async (req, res) => {
  try {
    const chat = await getGroupChat(req.params.id, req.auth!.userId);
    if (!chat) {
      res.status(404).json({ ok: false, error: 'Group chat not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: chat } satisfies ApiResponse<GroupChat>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// PUT /:id — update group chat settings
router.put('/:id', async (req, res) => {
  try {
    const body = req.body as UpdateGroupChatRequest;
    const chat = await updateGroupChat(req.params.id, req.auth!.userId, body);
    res.json({ ok: true, data: chat } satisfies ApiResponse<GroupChat>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// DELETE /:id — delete group chat
router.delete('/:id', async (req, res) => {
  try {
    await deleteGroupChat(req.params.id, req.auth!.userId);
    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /:id/members — add a member
router.post('/:id/members', async (req, res) => {
  try {
    const body = req.body as AddGroupChatMemberRequest;
    if (!body.displayName) {
      res.status(400).json({ ok: false, error: 'Missing displayName' } satisfies ApiResponse);
      return;
    }
    if (!body.isHuman && !body.instanceId) {
      res.status(400).json({ ok: false, error: 'Missing instanceId for bot member' } satisfies ApiResponse);
      return;
    }
    if (body.isHuman && !body.userId) {
      res.status(400).json({ ok: false, error: 'Missing userId for human member' } satisfies ApiResponse);
      return;
    }
    const member = await addMember(req.params.id, req.auth!.userId, body);
    res.status(201).json({ ok: true, data: member } satisfies ApiResponse<GroupChatMember>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : message.includes('already') ? 409 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// DELETE /:id/members/:memberId — remove a member
router.delete('/:id/members/:memberId', async (req, res) => {
  try {
    await removeMember(req.params.id, req.auth!.userId, req.params.memberId);
    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.put('/:id/members/:memberId', async (req, res) => {
  try {
    const body = req.body as UpdateGroupChatMemberRequest;
    const member = await updateMember(req.params.id, req.auth!.userId, req.params.memberId, body);
    res.json({ ok: true, data: member } satisfies ApiResponse<GroupChatMember>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// GET /:id/messages — get messages with pagination
router.get('/:id/messages', async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const before = req.query.before as string | undefined;
    const after = req.query.after as string | undefined;
    const result = await getMessages(req.params.id, req.auth!.userId, { limit, before, after });
    res.json({ ok: true, data: result } satisfies ApiResponse<GroupChatMessagesResponse>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /:id/messages — send a message
router.post('/:id/messages', async (req, res) => {
  try {
    const body = req.body as SendGroupChatMessageRequest;
    if (!body.content) {
      res.status(400).json({ ok: false, error: 'Missing content' } satisfies ApiResponse);
      return;
    }

    if (body.attachments?.length) {
      if (body.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        res.status(400).json({ ok: false, error: `Too many attachments (max ${MAX_ATTACHMENTS_PER_MESSAGE})` } satisfies ApiResponse);
        return;
      }
      for (const att of body.attachments) {
        if (!ALLOWED_ATTACHMENT_TYPES.has(att.mimeType)) {
          res.status(400).json({ ok: false, error: `Unsupported attachment type: ${att.mimeType}` } satisfies ApiResponse);
          return;
        }
        const estimatedBytes = Math.ceil(att.content.length * 3 / 4);
        if (estimatedBytes > MAX_ATTACHMENT_SIZE) {
          res.status(400).json({ ok: false, error: 'Attachment too large (max 5MB)' } satisfies ApiResponse);
          return;
        }
      }
    }

    const messageId = await sendMessage(req.params.id, req.auth!.userId, body.content, body.attachments);
    res.status(201).json({ ok: true, data: { messageId } } satisfies ApiResponse<GroupChatMessageSentResponse>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /:id/messages/:messageId/retry — retry failed deliveries
router.post('/:id/messages/:messageId/retry', async (req, res) => {
  try {
    const body = req.body as RetryGroupChatMessageRequest;
    const retriedCount = await retryMessage(req.params.id, req.auth!.userId, req.params.messageId, body.targetInstanceId);
    res.json({ ok: true, data: { retriedCount } } satisfies ApiResponse<RetryGroupChatMessageResponse>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
