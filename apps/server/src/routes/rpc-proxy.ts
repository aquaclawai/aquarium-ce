import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance, addSecurityEvent } from '../services/instance-manager.js';
import { getAgentType } from '../agent-types/registry.js';
import { scanMessage, SEVERITY_ORDER } from '../services/prompt-guard.js';
import { getPromptGuardConfig } from '../agent-types/openclaw/security-profiles.js';
import { broadcast } from '../ws/index.js';
import type { ApiResponse, RpcRequest } from '@aquarium/shared';
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_SIZE, MAX_ATTACHMENTS_PER_MESSAGE } from '@aquarium/shared';

const ALLOWED_RPC_METHODS = new Set([
  'chat.send',
  'chat.abort',
  'chat.history',
  'sessions.list',
  'sessions.patch',
  'sessions.usage',
  'sessions.delete',
  'agents.list',
  'agents.files.list',
  'agents.files.get',
  'agents.files.set',
  'health',
  'exec.approval.resolve',
  'logs.tail',
  'models.list',
]);

const router = Router();
router.use(requireAuth);

router.post('/:id/rpc', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance is not running' } satisfies ApiResponse);
      return;
    }

    const { method, params } = req.body as RpcRequest;
    if (!method) {
      res.status(400).json({ ok: false, error: 'Missing method' } satisfies ApiResponse);
      return;
    }

    if (!ALLOWED_RPC_METHODS.has(method)) {
      res.status(403).json({ ok: false, error: `RPC method '${method}' is not allowed by platform security policy` } satisfies ApiResponse);
      return;
    }

    if (method === 'chat.send') {
      const rawText = (params as Record<string, unknown>)?.text;
      if (rawText && typeof rawText === 'string') {
        const guardConfig = getPromptGuardConfig(instance.securityProfile ?? 'standard');
        if (guardConfig.enabled) {
          const scanResult = scanMessage(rawText, guardConfig.customPatterns);
          if (scanResult.detected && scanResult.maxSeverity && SEVERITY_ORDER[scanResult.maxSeverity] >= SEVERITY_ORDER[guardConfig.minAlertSeverity]) {
            if (guardConfig.logEvents) {
              addSecurityEvent(instance.id, scanResult).catch(() => {});
            }
            if (guardConfig.pushEvents) {
              broadcast(instance.id, {
                type: 'security_event',
                instanceId: instance.id,
                payload: {
                  category: 'security:prompt_injection_detected',
                  severity: scanResult.maxSeverity,
                  matchCount: scanResult.matches.length,
                  categories: [...new Set(scanResult.matches.map(m => m.category))],
                  durationMs: scanResult.durationMs,
                  timestamp: new Date().toISOString(),
                },
              });
            }
          }
        }
      }

      const attachments = (params as Record<string, unknown>)?.attachments;
      if (Array.isArray(attachments)) {
        if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
          res.status(400).json({ ok: false, error: `Too many attachments (max ${MAX_ATTACHMENTS_PER_MESSAGE})` } satisfies ApiResponse);
          return;
        }
        for (const att of attachments) {
          const a = att as Record<string, unknown>;
          if (typeof a.mimeType === 'string' && !ALLOWED_ATTACHMENT_TYPES.has(a.mimeType)) {
            res.status(400).json({ ok: false, error: `Unsupported attachment type: ${a.mimeType}` } satisfies ApiResponse);
            return;
          }
          if (typeof a.content === 'string') {
            const estimatedBytes = Math.ceil(a.content.length * 3 / 4);
            if (estimatedBytes > MAX_ATTACHMENT_SIZE) {
              res.status(400).json({ ok: false, error: 'Attachment too large (max 5MB)' } satisfies ApiResponse);
              return;
            }
          }
        }
      }
    }

    const { adapter } = getAgentType(instance.agentType);
    if (!adapter?.translateRPC) {
      res.status(400).json({ ok: false, error: 'Agent type does not support RPC' } satisfies ApiResponse);
      return;
    }

    const result = await adapter.translateRPC({
      method,
      params: params || {},
      endpoint: instance.controlEndpoint,
      token: instance.authToken,
      instanceId: instance.id,
    });

    res.json({ ok: true, data: result } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
