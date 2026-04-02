import { Router } from 'express';
import path from 'node:path';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import { getAgentType } from '../agent-types/registry.js';
import { getRuntimeEngine } from '../runtime/factory.js';
import type { ApiResponse } from '@aquarium/shared';

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const BASE64_CHUNK_SIZE = 65536;

const MIME_BY_EXT: Record<string, string> = {
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.py': 'text/x-python',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
};

const router = Router();
router.use(requireAuth);

router.post('/:id/files/upload', async (req, res) => {
  try {
    const { fileName, content, mimeType } = req.body as {
      fileName?: string;
      content?: string;
      mimeType?: string;
    };

    if (!fileName || !content || !mimeType) {
      res.status(400).json({
        ok: false,
        error: 'Missing required fields: fileName, content, mimeType',
      } satisfies ApiResponse);
      return;
    }

    const estimatedSize = Math.ceil(content.length * 0.75);
    if (estimatedSize > MAX_UPLOAD_SIZE) {
      res.status(413).json({
        ok: false,
        error: `File too large. Maximum size is ${MAX_UPLOAD_SIZE / 1024 / 1024}MB`,
      } satisfies ApiResponse);
      return;
    }

    // Security: sanitize fileName to prevent path traversal
    const sanitized = fileName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, '_');
    if (!sanitized || sanitized.startsWith('.')) {
      res.status(400).json({
        ok: false,
        error: 'Invalid file name',
      } satisfies ApiResponse);
      return;
    }

    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }
    if (instance.status !== 'running') {
      res.status(409).json({ ok: false, error: 'Instance is not running' } satisfies ApiResponse);
      return;
    }
    if (!instance.runtimeId) {
      res.status(409).json({ ok: false, error: 'Instance has no runtime' } satisfies ApiResponse);
      return;
    }

    const agentType = getAgentType(instance.agentType);
    if (!agentType) {
      res.status(500).json({ ok: false, error: 'Unknown agent type' } satisfies ApiResponse);
      return;
    }

    const engine = getRuntimeEngine(instance.deploymentTarget);
    if (!engine.exec) {
      res.status(501).json({
        ok: false,
        error: 'Runtime engine does not support exec',
      } satisfies ApiResponse);
      return;
    }

    const volumeMountPath = agentType.manifest.volumes[0]?.mountPath || '/home/node/.openclaw';
    const uploadsRelative = `uploads/${Date.now()}-${sanitized}`;
    const fullPath = `${volumeMountPath}/workspace/${uploadsRelative}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));

    await engine.exec(instance.runtimeId, ['mkdir', '-p', dir]);

    if (content.length <= BASE64_CHUNK_SIZE) {
      await engine.exec(instance.runtimeId, [
        'sh', '-c', `printf '%s' '${content}' | base64 -d > '${fullPath}'`,
      ]);
    } else {
      // Large files: write base64 to temp file in chunks, then decode
      const tempPath = `${fullPath}.b64`;
      const chunks: string[] = [];
      for (let i = 0; i < content.length; i += BASE64_CHUNK_SIZE) {
        chunks.push(content.slice(i, i + BASE64_CHUNK_SIZE));
      }
      await engine.exec(instance.runtimeId, [
        'sh', '-c', `printf '%s' '${chunks[0]}' > '${tempPath}'`,
      ]);
      for (let i = 1; i < chunks.length; i++) {
        await engine.exec(instance.runtimeId, [
          'sh', '-c', `printf '%s' '${chunks[i]}' >> '${tempPath}'`,
        ]);
      }
      await engine.exec(instance.runtimeId, [
        'sh', '-c', `base64 -d '${tempPath}' > '${fullPath}' && rm -f '${tempPath}'`,
      ]);
    }

    console.log(`[instance-files] Uploaded ${sanitized} (${mimeType}, ~${Math.round(estimatedSize / 1024)}KB) to ${instance.id}:${fullPath}`);

    res.json({
      ok: true,
      data: { path: uploadsRelative },
    } satisfies ApiResponse<{ path: string }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[instance-files] Upload failed:', message);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ── List uploaded files ──────────────────────────────────────────────

interface UploadedFile {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  modified: string;
}

router.get('/:id/files/list', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }
    if (instance.status !== 'running') {
      res.status(409).json({ ok: false, error: 'Instance is not running' } satisfies ApiResponse);
      return;
    }
    if (!instance.runtimeId) {
      res.status(409).json({ ok: false, error: 'Instance has no runtime' } satisfies ApiResponse);
      return;
    }

    const agentType = getAgentType(instance.agentType);
    if (!agentType) {
      res.status(500).json({ ok: false, error: 'Unknown agent type' } satisfies ApiResponse);
      return;
    }

    const engine = getRuntimeEngine(instance.deploymentTarget);
    if (!engine.exec) {
      res.status(501).json({ ok: false, error: 'Runtime engine does not support exec' } satisfies ApiResponse);
      return;
    }

    const volumeMountPath = agentType.manifest.volumes[0]?.mountPath || '/home/node/.openclaw';
    const uploadsDir = `${volumeMountPath}/workspace/uploads`;

    const result = await engine.exec(instance.runtimeId, [
      'sh', '-c',
      `find '${uploadsDir}' -maxdepth 1 -type f -printf '%s\\t%T@\\t%f\\n' 2>/dev/null || true`,
    ]);

    const files: UploadedFile[] = [];
    const stdout = result.stdout?.trim();
    if (stdout) {
      for (const line of stdout.split('\n')) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const [sizeStr, modifiedStr, ...nameParts] = parts;
        const name = nameParts.join('\t');
        const size = parseInt(sizeStr, 10);
        const modifiedEpoch = parseFloat(modifiedStr);
        const ext = path.extname(name).toLowerCase();
        const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';

        files.push({
          name,
          path: `uploads/${name}`,
          size: isNaN(size) ? 0 : size,
          mimeType,
          modified: isNaN(modifiedEpoch)
            ? new Date().toISOString()
            : new Date(modifiedEpoch * 1000).toISOString(),
        });
      }
    }

    files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    res.json({
      ok: true,
      data: { files },
    } satisfies ApiResponse<{ files: UploadedFile[] }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[instance-files] List failed:', message);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// ── Download / read file ─────────────────────────────────────────────

router.get('/:id/files/download', async (req, res) => {
  try {
    const filePath = req.query.path as string | undefined;
    if (!filePath) {
      res.status(400).json({ ok: false, error: 'Missing query param: path' } satisfies ApiResponse);
      return;
    }

    // Security: only allow files under uploads/ and reject path traversal
    const normalized = path.normalize(filePath);
    if (!normalized.startsWith('uploads/') || normalized.includes('..')) {
      res.status(403).json({ ok: false, error: 'Access denied: path must be under uploads/' } satisfies ApiResponse);
      return;
    }

    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }
    if (instance.status !== 'running') {
      res.status(409).json({ ok: false, error: 'Instance is not running' } satisfies ApiResponse);
      return;
    }
    if (!instance.runtimeId) {
      res.status(409).json({ ok: false, error: 'Instance has no runtime' } satisfies ApiResponse);
      return;
    }

    const agentType = getAgentType(instance.agentType);
    if (!agentType) {
      res.status(500).json({ ok: false, error: 'Unknown agent type' } satisfies ApiResponse);
      return;
    }

    const engine = getRuntimeEngine(instance.deploymentTarget);
    if (!engine.exec) {
      res.status(501).json({ ok: false, error: 'Runtime engine does not support exec' } satisfies ApiResponse);
      return;
    }

    const volumeMountPath = agentType.manifest.volumes[0]?.mountPath || '/home/node/.openclaw';
    const fullPath = `${volumeMountPath}/workspace/${normalized}`;

    const result = await engine.exec(instance.runtimeId, [
      'sh', '-c', `base64 '${fullPath}'`,
    ]);

    if (result.exitCode !== 0) {
      res.status(404).json({ ok: false, error: 'File not found or unreadable' } satisfies ApiResponse);
      return;
    }

    const content = result.stdout?.replace(/\s+/g, '') || '';
    const fileName = path.basename(normalized);
    const ext = path.extname(fileName).toLowerCase();
    const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';

    res.json({
      ok: true,
      data: { content, mimeType, encoding: 'base64' as const },
    } satisfies ApiResponse<{ content: string; mimeType: string; encoding: 'base64' }>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[instance-files] Download failed:', message);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
