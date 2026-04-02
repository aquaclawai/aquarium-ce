import { Router, raw as expressRaw } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import {
  listTemplates,
  getTemplate,
  getTemplateContent,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  forkTemplate,
  instantiateTemplate,
  exportFromInstance,
} from '../services/template-store.js';
import { generateOctemplate, parseOctemplate } from '../services/template-file-format.js';
import { getInstance } from '../services/instance-manager.js';
import type {
  ApiResponse,
  TemplateManifest,
  TemplateContent,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  InstantiateTemplateRequest,
  InstantiateTemplateResponse,
  ExportTemplateResponse,
  PaginatedResponse,
  TemplateCategory,
  TemplateLicense,
} from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

async function getAuthorName(userId: string): Promise<string | null> {
  const user = await db('users').where({ id: userId }).select('display_name').first();
  return (user?.display_name as string) ?? null;
}

function isVisibleTo(template: TemplateManifest, userId: string): boolean {
  if (template.license !== 'private') return true;
  return template.authorId === userId;
}

// GET / — list templates with optional filters
router.get('/', async (req, res) => {
  try {
    const tags = typeof req.query.tags === 'string' ? req.query.tags.split(',') : undefined;
    const result = await listTemplates({
      category: req.query.category as TemplateCategory | undefined,
      tags,
      search: req.query.search as string | undefined,
      license: req.query.license as TemplateLicense | undefined,
      trustLevel: req.query.trustLevel as string | undefined,
      authorId: req.query.authorId as string | undefined,
      featured: req.query.featured === 'true' ? true : req.query.featured === 'false' ? false : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ ok: true, data: result } satisfies ApiResponse<PaginatedResponse<TemplateManifest>>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// GET /:idOrSlug — get template manifest by id or slug
router.get('/:idOrSlug', async (req, res) => {
  try {
    const template = await getTemplate(req.params.idOrSlug);
    if (!template || !isVisibleTo(template, req.auth!.userId)) {
      res.status(404).json({ ok: false, error: 'Template not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: template } satisfies ApiResponse<TemplateManifest>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// GET /:id/content — get full template content
router.get('/:id/content', async (req, res) => {
  try {
    const template = await getTemplate(req.params.id);
    if (!template || !isVisibleTo(template, req.auth!.userId)) {
      res.status(404).json({ ok: false, error: 'Template not found' } satisfies ApiResponse);
      return;
    }
    const content = await getTemplateContent(req.params.id);
    if (!content) {
      res.status(404).json({ ok: false, error: 'Template content not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: content } satisfies ApiResponse<TemplateContent>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST / — create a new template
router.post('/', async (req, res) => {
  try {
    const body = req.body as CreateTemplateRequest;
    if (!body.slug || !body.name || !body.content) {
      res.status(400).json({ ok: false, error: 'Missing slug, name, or content' } satisfies ApiResponse);
      return;
    }

    const authorName = await getAuthorName(req.auth!.userId);
    const template = await createTemplate(req.auth!.userId, authorName, body);
    res.status(201).json({ ok: true, data: template } satisfies ApiResponse<TemplateManifest>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('unique') || message.includes('duplicate') ? 409 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// PUT /:id — update (publish new version)
router.put('/:id', async (req, res) => {
  try {
    const body = req.body as UpdateTemplateRequest;
    const template = await updateTemplate(req.params.id, req.auth!.userId, body);
    res.json({ ok: true, data: template } satisfies ApiResponse<TemplateManifest>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : message.includes('Only the author') ? 403 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// DELETE /:id — delete template
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteTemplate(req.params.id, req.auth!.userId);
    if (!deleted) {
      res.status(404).json({ ok: false, error: 'Template not found' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('Only the author') ? 403 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /:id/fork — fork a template
router.post('/:id/fork', async (req, res) => {
  try {
    const template = await getTemplate(req.params.id);
    if (!template || !isVisibleTo(template, req.auth!.userId)) {
      res.status(404).json({ ok: false, error: 'Template not found' } satisfies ApiResponse);
      return;
    }
    const authorName = await getAuthorName(req.auth!.userId);
    const forked = await forkTemplate(req.params.id, req.auth!.userId, authorName);
    res.status(201).json({ ok: true, data: forked } satisfies ApiResponse<TemplateManifest>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /:id/instantiate — create instance from template
router.post('/:id/instantiate', async (req, res) => {
  try {
    const body = req.body as InstantiateTemplateRequest;
    if (!body.instanceName) {
      res.status(400).json({ ok: false, error: 'Missing instanceName' } satisfies ApiResponse);
      return;
    }

    const template = await getTemplate(req.params.id);
    if (!template || !isVisibleTo(template, req.auth!.userId)) {
      res.status(404).json({ ok: false, error: 'Template not found' } satisfies ApiResponse);
      return;
    }

    const result = await instantiateTemplate(req.params.id, req.auth!.userId, body);
    res.status(201).json({ ok: true, data: result } satisfies ApiResponse<InstantiateTemplateResponse>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404
      : (message.includes('Missing required') || message.includes('security level')) ? 400
      : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /from-instance/:id — export instance as template draft
router.post('/from-instance/:id', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const result = await exportFromInstance(req.params.id, req.auth!.userId);
    res.json({ ok: true, data: result } satisfies ApiResponse<ExportTemplateResponse>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// GET /:id/download — download template as .octemplate archive
router.get('/:id/download', async (req, res) => {
  try {
    const template = await getTemplate(req.params.id);
    if (!template || !isVisibleTo(template, req.auth!.userId)) {
      res.status(404).json({ ok: false, error: 'Template not found' } satisfies ApiResponse);
      return;
    }
    const content = await getTemplateContent(req.params.id);
    if (!content) {
      res.status(404).json({ ok: false, error: 'Template content not found' } satisfies ApiResponse);
      return;
    }

    const buffer = await generateOctemplate(template, content);
    res.setHeader('Content-Type', 'application/x-octemplate');
    res.setHeader('Content-Disposition', `attachment; filename="${template.slug}.octemplate"`);
    res.send(buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

// POST /import — import template from .octemplate archive
router.post('/import', expressRaw({ type: ['application/octet-stream', 'application/x-octemplate', 'application/zip'], limit: '50mb' }), async (req, res) => {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ ok: false, error: 'Request body must be a binary .octemplate file' } satisfies ApiResponse);
      return;
    }

    const parsed = await parseOctemplate(body);
    if (!parsed.manifest.name || !parsed.manifest.slug) {
      res.status(400).json({ ok: false, error: 'Invalid .octemplate: missing name or slug in template.json' } satisfies ApiResponse);
      return;
    }

    const authorName = await getAuthorName(req.auth!.userId);
    const createReq: CreateTemplateRequest = {
      slug: parsed.manifest.slug,
      name: parsed.manifest.name,
      description: parsed.manifest.description,
      category: parsed.manifest.category,
      tags: parsed.manifest.tags,
      locale: parsed.manifest.locale,
      license: parsed.manifest.license,
      minImageTag: parsed.manifest.minImageTag,
      agentType: parsed.manifest.agentType,
      billingMode: parsed.manifest.billingMode,
      requiredCredentials: parsed.manifest.requiredCredentials,
      mcpServers: parsed.manifest.mcpServers,
      skills: parsed.manifest.skills,
      pluginDependencies: parsed.manifest.pluginDependencies,
      suggestedChannels: parsed.manifest.suggestedChannels,
      content: {
        workspaceFiles: parsed.content.workspaceFiles,
        mcpServerConfigs: parsed.content.mcpServerConfigs,
        inlineSkills: parsed.content.inlineSkills,
        openclawConfig: parsed.content.openclawConfig,
        pluginDependencies: parsed.content.pluginDependencies,
        setupCommands: parsed.content.setupCommands,
        security: parsed.content.security,
      },
    };

    const template = await createTemplate(req.auth!.userId, authorName, createReq);
    res.status(201).json({ ok: true, data: template } satisfies ApiResponse<TemplateManifest>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('unique') || message.includes('duplicate') ? 409
      : message.includes('Invalid') ? 400
      : 500;
    res.status(status).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
