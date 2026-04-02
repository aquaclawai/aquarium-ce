import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { config as appConfig } from '../config.js';
import { litellmKeyManager } from '../ee/litellm/litellm-key-manager.js';
import { getConfig } from '../services/system-config.js';
import {
  listWizardConfigs,
  getWizardConfigById,
  addWizardConfig,
  updateWizardConfig,
  deleteWizardConfig,
  type WizardConfigType,
  type WizardConfigRow,
} from '../services/wizard-config-store.js';
import type { AdminStats, AdminUser, AdminUserInstance, StorageStats, StorageTableStats, AdminUserWithRole, UserRole } from '@aquarium/shared';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get('/check', (_req: Request, res: Response) => {
  res.json({ ok: true, data: { isAdmin: true } });
});

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [userCount] = await db('users').count('id as count');
    const [instanceCount] = await db('instances').count('id as count');

    const statusRows = await db('instances')
      .select('status')
      .count('id as count')
      .groupBy('status');

    const targetRows = await db('instances')
      .select('deployment_target')
      .count('id as count')
      .groupBy('deployment_target');

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const [recentCount] = await db('users')
      .where('created_at', '>=', sevenDaysAgo)
      .count('id as count');

    const instancesByStatus: Record<string, number> = {};
    for (const row of statusRows) {
      instancesByStatus[row.status as string] = Number(row.count);
    }

    const instancesByTarget: Record<string, number> = {};
    for (const row of targetRows) {
      instancesByTarget[row.deployment_target as string] = Number(row.count);
    }

    const stats: AdminStats = {
      totalUsers: Number(userCount.count),
      totalInstances: Number(instanceCount.count),
      instancesByStatus,
      instancesByTarget,
      recentSignups: Number(recentCount.count),
    };

    res.json({ ok: true, data: stats });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch stats' });
  }
});

router.get('/users', async (_req: Request, res: Response) => {
  try {
    const users = await db('users')
      .select(
        'users.id',
        'users.email',
        'users.display_name',
        'users.created_at',
      )
      .orderBy('users.created_at', 'desc');

    const instanceCounts = await db('instances')
      .select('user_id')
      .count('id as count')
      .groupBy('user_id');

    const runningCounts = await db('instances')
      .select('user_id')
      .where('status', 'running')
      .count('id as count')
      .groupBy('user_id');

    const countMap = new Map<string, number>();
    for (const row of instanceCounts) {
      countMap.set(row.user_id as string, Number(row.count));
    }

    const runningMap = new Map<string, number>();
    for (const row of runningCounts) {
      runningMap.set(row.user_id as string, Number(row.count));
    }

    const adminUsers: AdminUser[] = users.map(u => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      createdAt: u.created_at,
      instanceCount: countMap.get(u.id) ?? 0,
      runningCount: runningMap.get(u.id) ?? 0,
    }));

    res.json({ ok: true, data: adminUsers });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch users' });
  }
});

router.get('/users/:userId/instances', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const instances = await db('instances')
      .select(
        'id',
        'name',
        'agent_type',
        'status',
        'status_message',
        'deployment_target',
        'image_tag',
        'created_at',
        'updated_at',
      )
      .where('user_id', userId)
      .orderBy('created_at', 'desc');

    const result: AdminUserInstance[] = instances.map(i => ({
      id: i.id,
      name: i.name,
      agentType: i.agent_type,
      status: i.status,
      statusMessage: i.status_message,
      deploymentTarget: i.deployment_target,
      imageTag: i.image_tag,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    }));

    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('Admin user instances error:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch user instances' });
  }
});

router.put('/users/:userId/budget', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { usageLimitUsd, usageBalanceUsd } = req.body as { usageLimitUsd?: number | null; usageBalanceUsd?: number | null };

    // Validate numeric fields
    if (usageLimitUsd !== undefined && usageLimitUsd !== null) {
      if (typeof usageLimitUsd !== 'number' || !Number.isFinite(usageLimitUsd) || usageLimitUsd < 0) {
        res.status(400).json({ ok: false, error: 'usageLimitUsd must be a finite number >= 0 or null' });
        return;
      }
    }
    if (usageBalanceUsd !== undefined && usageBalanceUsd !== null) {
      if (typeof usageBalanceUsd !== 'number' || !Number.isFinite(usageBalanceUsd) || usageBalanceUsd < 0) {
        res.status(400).json({ ok: false, error: 'usageBalanceUsd must be a finite number >= 0 or null' });
        return;
      }
    }

    const user = await db('users').where({ id: userId }).first();
    if (!user) {
      res.status(404).json({ ok: false, error: 'User not found' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (usageLimitUsd !== undefined) {
      updates.usage_limit_usd = usageLimitUsd;
    }
    if (usageBalanceUsd !== undefined) {
      updates.usage_balance_usd = usageBalanceUsd;
    }

    await db('users').where({ id: userId }).update(updates);

    // Sync budget to LiteLLM team (BUDGET-01, BUDGET-02)
    if (usageLimitUsd !== undefined) {
      try {
        await litellmKeyManager.syncUserBudgetToTeam(String(userId), usageLimitUsd);
      } catch (syncErr) {
        // Log but don't fail the request — DB update already succeeded.
        // Admin can retry or check LiteLLM dashboard directly.
        console.error(`[admin] LiteLLM budget sync failed for user ${userId}:`, syncErr);
        res.json({
          ok: true,
          data: { litellmSyncError: 'Budget saved but LiteLLM sync failed. Check LiteLLM connectivity.' },
        });
        return;
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Admin set budget error:', err);
    res.status(500).json({ ok: false, error: 'Failed to update budget' });
  }
});

const STORAGE_TABLES = [
  'instance_events',
  'auth_events',
  'credential_audit_log',
  'instances',
  'users',
  'templates',
  'template_contents',
  'instance_credentials',
  'user_credentials',
  'snapshots',
  'notifications',
  'system_settings',
  'group_chats',
  'group_chat_messages',
];

router.get('/storage-stats', async (_req: Request, res: Response) => {
  try {
    const adapter = getAdapter();
    const tables: StorageTableStats[] = [];
    let totalSizeBytes = 0;

    for (const table of STORAGE_TABLES) {
      const countResult = await db(table).count('* as count');
      const rowCount = Number(countResult[0].count);

      if (adapter.dialect === 'pg') {
        const sizeResult = await db.raw(
          `SELECT pg_total_relation_size(?) as size_bytes`,
          [table]
        );
        const sizeBytes = Number(sizeResult.rows[0].size_bytes);
        totalSizeBytes += sizeBytes;
        tables.push({
          table,
          sizeBytes,
          sizeFormatted: formatBytes(sizeBytes),
          rowCount,
        });
      } else {
        // SQLite: pg_total_relation_size has no equivalent. Report 0 per table.
        tables.push({
          table,
          sizeBytes: 0,
          sizeFormatted: 'N/A (SQLite)',
          rowCount,
        });
      }
    }

    tables.sort((a, b) => b.sizeBytes - a.sizeBytes);

    const stats: StorageStats = {
      tables,
      totalSizeBytes,
      totalSizeFormatted: adapter.dialect === 'pg' ? formatBytes(totalSizeBytes) : 'N/A (SQLite)',
    };

    res.json({ ok: true, data: stats });
  } catch (err) {
    console.error('Storage stats error:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch storage stats' });
  }
});

router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const config = await getConfig();
    const eventsDays = config.dataRetentionEventsDays ?? 90;
    const authEventsDays = config.dataRetentionAuthEventsDays ?? 90;
    const auditLogDays = config.dataRetentionAuditLogDays ?? 90;

    const cutoffEvents = new Date();
    cutoffEvents.setDate(cutoffEvents.getDate() - eventsDays);
    const cutoffAuth = new Date();
    cutoffAuth.setDate(cutoffAuth.getDate() - authEventsDays);
    const cutoffAudit = new Date();
    cutoffAudit.setDate(cutoffAudit.getDate() - auditLogDays);

    const deletedEvents = await db('instance_events')
      .where('created_at', '<', cutoffEvents)
      .del();
    const deletedAuth = await db('auth_events')
      .where('created_at', '<', cutoffAuth)
      .del();
    const deletedAudit = await db('credential_audit_log')
      .where('created_at', '<', cutoffAudit)
      .del();

    res.json({
      ok: true,
      data: {
        deletedEvents,
        deletedAuthEvents: deletedAuth,
        deletedAuditLog: deletedAudit,
      },
    });
  } catch (err) {
    console.error('Cleanup error:', err);
    res.status(500).json({ ok: false, error: 'Failed to perform cleanup' });
  }
});

router.get('/export/:type', async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const format = (req.query.format as string) ?? 'json';

    let data: Record<string, unknown>[];
    let filename: string;

    switch (type) {
      case 'users':
        data = await db('users').select('id', 'email', 'display_name', 'role', 'created_at', 'updated_at');
        filename = 'users';
        break;
      case 'instances':
        data = await db('instances').select(
          'id', 'user_id', 'name', 'agent_type', 'status', 'deployment_target', 'image_tag', 'created_at', 'updated_at'
        );
        filename = 'instances';
        break;
      case 'events':
        data = await db('instance_events')
          .select('id', 'instance_id', 'event_type', 'metadata', 'created_at')
          .orderBy('created_at', 'desc')
          .limit(10000);
        filename = 'events';
        break;
      default:
        res.status(400).json({ ok: false, error: `Unsupported export type: ${type}` });
        return;
    }

    if (format === 'csv') {
      if (data.length === 0) {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.send('');
        return;
      }
      const headers = Object.keys(data[0]);
      const csvRows = [
        headers.join(','),
        ...data.map(row =>
          headers.map(h => {
            const val = row[h];
            if (val === null || val === undefined) return '';
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
            return `"${str.replace(/"/g, '""')}"`;
          }).join(',')
        ),
      ];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csvRows.join('\n'));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json({ ok: true, data });
    }
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ ok: false, error: 'Failed to export data' });
  }
});

router.get('/users-with-roles', async (_req: Request, res: Response) => {
  try {
    const users = await db('users')
      .select('users.id', 'users.email', 'users.display_name', 'users.role', 'users.created_at')
      .orderBy('users.created_at', 'desc');

    const instanceCounts = await db('instances')
      .select('user_id')
      .count('id as count')
      .groupBy('user_id');

    const countMap = new Map<string, number>();
    for (const row of instanceCounts) {
      countMap.set(row.user_id as string, Number(row.count));
    }

    const result: AdminUserWithRole[] = users.map(u => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      role: (u.role as UserRole) ?? 'user',
      createdAt: u.created_at,
      instanceCount: countMap.get(u.id) ?? 0,
    }));

    res.json({ ok: true, data: { users: result, adminEmails: appConfig.adminEmails } });
  } catch (err) {
    console.error('Users with roles error:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch users' });
  }
});

router.put('/users/:userId/role', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { role } = req.body as { role: UserRole };

    const validRoles: UserRole[] = ['admin', 'user', 'viewer'];
    if (!role || !validRoles.includes(role)) {
      res.status(400).json({ ok: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      return;
    }

    const user = await db('users').where({ id: userId }).first();
    if (!user) {
      res.status(404).json({ ok: false, error: 'User not found' });
      return;
    }

    await db('users')
      .where({ id: userId })
      .update({ role, updated_at: new Date() });

    res.json({ ok: true });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ ok: false, error: 'Failed to update user role' });
  }
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wizard Config CRUD
// ─────────────────────────────────────────────────────────────────────────────

router.get('/wizard-configs', async (req: Request, res: Response) => {
  try {
    const { agentType, locale } = req.query as { agentType?: string; locale?: string };
    const configs = await listWizardConfigs(agentType, locale);

    const result = configs.map((c: WizardConfigRow) => ({
      id: c.id,
      configType: c.config_type,
      agentType: c.agent_type,
      locale: c.locale,
      items: c.items,
      sortOrder: c.sort_order,
      isActive: c.is_active,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));

    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('List wizard configs error:', err);
    res.status(500).json({ ok: false, error: 'Failed to list wizard configs' });
  }
});

router.get('/wizard-configs/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const config = await getWizardConfigById(id);

    if (!config) {
      res.status(404).json({ ok: false, error: 'Wizard config not found' });
      return;
    }

    res.json({
      ok: true,
      data: {
        id: config.id,
        configType: config.config_type,
        agentType: config.agent_type,
        locale: config.locale,
        items: config.items,
        sortOrder: config.sort_order,
        isActive: config.is_active,
        createdAt: config.created_at,
        updatedAt: config.updated_at,
      },
    });
  } catch (err) {
    console.error('Get wizard config error:', err);
    res.status(500).json({ ok: false, error: 'Failed to get wizard config' });
  }
});

router.post('/wizard-configs', async (req: Request, res: Response) => {
  try {
    const { configType, agentType, locale, items } = req.body as {
      configType: WizardConfigType;
      agentType: string;
      locale: string;
      items: unknown[];
    };

    if (!configType || !agentType || !locale || !Array.isArray(items)) {
      res.status(400).json({ ok: false, error: 'configType, agentType, locale, and items are required' });
      return;
    }

    const validTypes: WizardConfigType[] = ['principles', 'identity_templates', 'temperature_presets', 'context_options', 'chat_suggestions'];
    if (!validTypes.includes(configType)) {
      res.status(400).json({ ok: false, error: `Invalid configType. Must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const id = await addWizardConfig(configType, agentType, locale, items);
    res.json({ ok: true, data: { id } });
  } catch (err) {
    console.error('Create wizard config error:', err);
    res.status(500).json({ ok: false, error: 'Failed to create wizard config' });
  }
});

router.put('/wizard-configs/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { items } = req.body as { items: unknown[] };

    if (!Array.isArray(items)) {
      res.status(400).json({ ok: false, error: 'items must be an array' });
      return;
    }

    const config = await getWizardConfigById(id);
    if (!config) {
      res.status(404).json({ ok: false, error: 'Wizard config not found' });
      return;
    }

    await updateWizardConfig(id, items);

    res.json({ ok: true });
  } catch (err) {
    console.error('Update wizard config error:', err);
    res.status(500).json({ ok: false, error: 'Failed to update wizard config' });
  }
});

router.delete('/wizard-configs/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const deleted = await deleteWizardConfig(id);

    if (!deleted) {
      res.status(404).json({ ok: false, error: 'Wizard config not found' });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete wizard config error:', err);
    res.status(500).json({ ok: false, error: 'Failed to delete wizard config' });
  }
});

export default router;
