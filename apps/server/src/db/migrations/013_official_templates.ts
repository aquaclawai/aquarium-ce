import type { Knex } from 'knex';

const OFFICIAL_TEMPLATES = [
  {
    slug: 'general-ai-assistant',
    name: '通用 AI 助手',
    description: '一个功能全面的通用 AI 助手，支持日常对话、知识问答、写作辅助等多种场景。适合个人使用，开箱即用。',
    category: 'personal',
    tags: JSON.stringify(['通用', '助手', '对话', '写作']),
    locale: 'zh-CN',
    license: 'public',
    trust_level: 'official',
    billing_mode: 'platform',
    agent_type: 'openclaw',
    required_credentials: JSON.stringify([]),
    mcp_servers: JSON.stringify({}),
    skills: JSON.stringify([]),
    suggested_channels: JSON.stringify([]),
    workspaceFiles: {
      'AGENTS.md': `# Agents Configuration

## Default Agent
- Model: Use platform default
- Purpose: General-purpose AI assistant
`,
      'SOUL.md': `# Soul

你是一个友善、专业的 AI 助手。你乐于助人，善于倾听，并且总是以用户需求为导向。

## 核心原则
- 准确回答问题，如果不确定就诚实说明
- 使用清晰简洁的语言
- 尊重用户隐私
- 主动提供有用的建议和补充信息
`,
      'IDENTITY.md': `# Identity

- 名称: AI 助手
- 语言: 中文（同时支持英文）
- 性格: 友善、专业、耐心
`,
    },
  },
  {
    slug: 'customer-service-bot',
    name: '客服 Bot',
    description: '专为客户服务场景设计的 AI 机器人，擅长处理客户咨询、问题解答和工单分类。支持多渠道接入。',
    category: 'customer-service',
    tags: JSON.stringify(['客服', '服务', '工单', '多渠道']),
    locale: 'zh-CN',
    license: 'public',
    trust_level: 'official',
    billing_mode: 'platform',
    agent_type: 'openclaw',
    required_credentials: JSON.stringify([]),
    mcp_servers: JSON.stringify({}),
    skills: JSON.stringify([]),
    suggested_channels: JSON.stringify(['telegram']),
    workspaceFiles: {
      'AGENTS.md': `# Agents Configuration

## Default Agent
- Model: Use platform default
- Purpose: Customer service and support
`,
      'SOUL.md': `# Soul

你是一个专业的客服助手，专注于为客户提供高质量的支持服务。

## 核心原则
- 始终保持礼貌和耐心
- 快速理解客户问题并提供解决方案
- 无法解决的问题及时升级
- 记录重要信息便于后续跟进

## 工作流程
1. 问候客户，确认身份
2. 仔细倾听问题描述
3. 分析问题类型（咨询/投诉/技术支持）
4. 提供解决方案或升级处理
5. 确认客户满意度
`,
      'IDENTITY.md': `# Identity

- 名称: 客服助手
- 语言: 中文
- 性格: 专业、耐心、有同理心
- 角色: 客户服务代表
`,
    },
  },
  {
    slug: 'team-collaboration-assistant',
    name: '团队协作助手',
    description: '帮助团队提高协作效率的 AI 助手，支持会议总结、任务分配、进度跟踪等团队协作场景。',
    category: 'custom',
    tags: JSON.stringify(['团队', '协作', '会议', '任务管理']),
    locale: 'zh-CN',
    license: 'public',
    trust_level: 'official',
    billing_mode: 'platform',
    agent_type: 'openclaw',
    required_credentials: JSON.stringify([]),
    mcp_servers: JSON.stringify({}),
    skills: JSON.stringify([]),
    suggested_channels: JSON.stringify([]),
    workspaceFiles: {
      'AGENTS.md': `# Agents Configuration

## Default Agent
- Model: Use platform default
- Purpose: Team collaboration and productivity
`,
      'SOUL.md': `# Soul

你是一个团队协作助手，专注于帮助团队提升工作效率和协作质量。

## 核心能力
- 会议记录与总结
- 任务拆解与分配建议
- 进度跟踪与提醒
- 团队知识管理

## 工作原则
- 结构化输出，便于团队成员快速获取信息
- 主动提醒重要事项和截止日期
- 客观中立，促进团队沟通
`,
      'IDENTITY.md': `# Identity

- 名称: 协作助手
- 语言: 中文
- 性格: 高效、条理清晰、注重细节
- 角色: 团队协作协调员
`,
    },
  },
];

export async function up(knex: Knex): Promise<void> {
  const firstUser = await knex('users').select('id', 'display_name').orderBy('created_at', 'asc').first();
  if (!firstUser) return;

  for (const tpl of OFFICIAL_TEMPLATES) {
    const existing = await knex('templates').where({ slug: tpl.slug, is_latest: true }).first();
    if (existing) continue;

    const { workspaceFiles, ...manifest } = tpl;

    const [row] = await knex('templates')
      .insert({
        ...manifest,
        author_id: firstUser.id,
        author_name: firstUser.display_name,
      })
      .returning('id');

    await knex('template_contents').insert({
      template_id: row.id,
      workspace_files: JSON.stringify(workspaceFiles),
      mcp_server_configs: JSON.stringify({}),
      inline_skills: JSON.stringify({}),
      openclaw_config: JSON.stringify({}),
      setup_commands: JSON.stringify([]),
      custom_image: null,
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const slugs = OFFICIAL_TEMPLATES.map((t) => t.slug);
  const templates = await knex('templates').whereIn('slug', slugs).select('id');
  const ids = templates.map((t: { id: string }) => t.id);
  if (ids.length > 0) {
    await knex('template_contents').whereIn('template_id', ids).delete();
    await knex('templates').whereIn('id', ids).delete();
  }
}
