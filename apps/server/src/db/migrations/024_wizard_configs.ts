import type { Knex } from 'knex';
import { addUuidPrimary, addJsonColumn } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  // Wizard configs table — stores all configurable wizard options
  await knex.schema.createTable('wizard_configs', (table) => {
    addUuidPrimary(table, knex, 'id');

    // Config category
    // Values: 'principles' | 'identity_templates' | 'temperature_presets'
    //         | 'context_options' | 'chat_suggestions'
    table.string('config_type', 50).notNullable();

    // Agent type (supports future multi-agent types)
    table.string('agent_type', 50).notNullable().defaultTo('openclaw');

    // Multi-language support
    table.string('locale', 10).notNullable().defaultTo('zh-CN');

    // Config content (JSONB array)
    addJsonColumn(table, 'items').notNullable();

    // Sort order weight
    table.integer('sort_order').notNullable().defaultTo(0);

    // Whether this config is active
    table.boolean('is_active').notNullable().defaultTo(true);

    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Index for efficient lookups
    table.index(['config_type', 'agent_type', 'locale', 'is_active']);
  });

  // Seed default data
  await knex('wizard_configs').insert([
    // === Default Principles (Chinese) ===
    {
      config_type: 'principles',
      agent_type: 'openclaw',
      locale: 'zh-CN',
      items: JSON.stringify([
        '始终保持诚实，不得捏造事实或提供错误信息。',
        '拒绝生成任何违法、歧视性或有害内容。',
        '保护用户隐私，不主动收集或泄露个人信息。',
        '遇到不确定的问题，主动说明并建议用户寻求专业帮助。',
      ]),
      sort_order: 0,
    },
    // === Default Principles (English) ===
    {
      config_type: 'principles',
      agent_type: 'openclaw',
      locale: 'en-US',
      items: JSON.stringify([
        'Always be honest and never fabricate facts or provide false information.',
        'Refuse to generate any illegal, discriminatory, or harmful content.',
        'Protect user privacy and never actively collect or disclose personal information.',
        'When uncertain, proactively acknowledge limitations and suggest seeking professional help.',
      ]),
      sort_order: 0,
    },
    // === Identity Templates (Chinese) ===
    {
      config_type: 'identity_templates',
      agent_type: 'openclaw',
      locale: 'zh-CN',
      items: JSON.stringify([
        '资深文化科技领域分析专家',
        '企业法务顾问',
        '产品经理助手',
        '数据分析师',
        '营销策略顾问',
      ]),
      sort_order: 0,
    },
    // === Identity Templates (English) ===
    {
      config_type: 'identity_templates',
      agent_type: 'openclaw',
      locale: 'en-US',
      items: JSON.stringify([
        'Senior Culture & Technology Analyst',
        'Corporate Legal Advisor',
        'Product Manager Assistant',
        'Data Analyst',
        'Marketing Strategy Consultant',
      ]),
      sort_order: 0,
    },
    // === Temperature Presets (Chinese) ===
    {
      config_type: 'temperature_presets',
      agent_type: 'openclaw',
      locale: 'zh-CN',
      items: JSON.stringify([
        { key: 'work', label: '工作', value: 0.3, description: '精准、专业' },
        { key: 'life', label: '生活', value: 0.7, description: '自然、亲和' },
        { key: 'creative', label: '创意', value: 1.4, description: '发散、创新' },
      ]),
      sort_order: 0,
    },
    // === Temperature Presets (English) ===
    {
      config_type: 'temperature_presets',
      agent_type: 'openclaw',
      locale: 'en-US',
      items: JSON.stringify([
        { key: 'work', label: 'Work', value: 0.3, description: 'Precise & Professional' },
        { key: 'life', label: 'Life', value: 0.7, description: 'Natural & Friendly' },
        { key: 'creative', label: 'Creative', value: 1.4, description: 'Divergent & Innovative' },
      ]),
      sort_order: 0,
    },
    // === Context Length Options (Chinese) ===
    {
      config_type: 'context_options',
      agent_type: 'openclaw',
      locale: 'zh-CN',
      items: JSON.stringify([
        { value: 4096, label: '4K Tokens', description: '基础对话' },
        { value: 8192, label: '8K Tokens', description: '标准对话' },
        { value: 16384, label: '16K Tokens', description: '长文档' },
        { value: 32768, label: '32K Tokens', description: '复杂任务' },
        { value: 131072, label: '128K Tokens', description: '超长上下文' },
      ]),
      sort_order: 0,
    },
    // === Context Length Options (English) ===
    {
      config_type: 'context_options',
      agent_type: 'openclaw',
      locale: 'en-US',
      items: JSON.stringify([
        { value: 4096, label: '4K Tokens', description: 'Basic conversations' },
        { value: 8192, label: '8K Tokens', description: 'Standard conversations' },
        { value: 16384, label: '16K Tokens', description: 'Long documents' },
        { value: 32768, label: '32K Tokens', description: 'Complex tasks' },
        { value: 131072, label: '128K Tokens', description: 'Ultra-long context' },
      ]),
      sort_order: 0,
    },
    // === Chat Suggestions (Chinese) ===
    {
      config_type: 'chat_suggestions',
      agent_type: 'openclaw',
      locale: 'zh-CN',
      items: JSON.stringify([
        { key: 'suggestion1', text: '帮我写一份周报' },
        { key: 'suggestion2', text: '解释一下这段代码' },
        { key: 'suggestion3', text: '给我一些创意建议' },
        { key: 'suggestion4', text: '帮我优化这段文案' },
      ]),
      sort_order: 0,
    },
    // === Chat Suggestions (English) ===
    {
      config_type: 'chat_suggestions',
      agent_type: 'openclaw',
      locale: 'en-US',
      items: JSON.stringify([
        { key: 'suggestion1', text: 'Help me write a weekly report' },
        { key: 'suggestion2', text: 'Explain this code' },
        { key: 'suggestion3', text: 'Give me some creative ideas' },
        { key: 'suggestion4', text: 'Help me improve this copy' },
      ]),
      sort_order: 0,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('wizard_configs');
}
