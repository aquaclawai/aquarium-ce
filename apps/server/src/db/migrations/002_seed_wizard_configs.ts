import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex('wizard_configs').insert([
    // ── Principles ───────────────────────────────────────────────────────────
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

    // ── Identity Templates ───────────────────────────────────────────────────
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

    // ── Temperature Presets ──────────────────────────────────────────────────
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

    // ── Context Length Options ────────────────────────────────────────────────
    {
      config_type: 'context_options',
      agent_type: 'openclaw',
      locale: 'zh-CN',
      items: JSON.stringify([
        { value: 4096, label: '4K Tokens', description: '基础对话' },
        { value: 8192, label: '8K Tokens', description: '标准对话' },
        { value: 16384, label: '16K Tokens', description: '长文档' },
        { value: 32768, label: '32K Tokens', description: '复杂任务' },
        { value: 131072, label: '128K Tokens', description: '扩展上下文' },
        { value: 200000, label: '200K Tokens', description: 'Claude / GPT-5 / o3 完整上下文' },
        { value: 262144, label: '256K Tokens', description: 'Kimi / 豆包 扩展上下文' },
        { value: 524288, label: '512K Tokens', description: '大型文档分析' },
        { value: 1000000, label: '1M Tokens', description: 'GPT-4.1 / Gemini 最大上下文' },
      ]),
      sort_order: 0,
    },
    {
      config_type: 'context_options',
      agent_type: 'openclaw',
      locale: 'en-US',
      items: JSON.stringify([
        { value: 4096, label: '4K Tokens', description: 'Basic conversations' },
        { value: 8192, label: '8K Tokens', description: 'Standard conversations' },
        { value: 16384, label: '16K Tokens', description: 'Long documents' },
        { value: 32768, label: '32K Tokens', description: 'Complex tasks' },
        { value: 131072, label: '128K Tokens', description: 'Extended context' },
        { value: 200000, label: '200K Tokens', description: 'Claude / GPT-5 / o3 full context' },
        { value: 262144, label: '256K Tokens', description: 'Kimi / Doubao extended' },
        { value: 524288, label: '512K Tokens', description: 'Large document analysis' },
        { value: 1000000, label: '1M Tokens', description: 'GPT-4.1 / Gemini maximum context' },
      ]),
      sort_order: 0,
    },

    // ── Chat Suggestions ─────────────────────────────────────────────────────
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
  await knex('wizard_configs').del();
}
