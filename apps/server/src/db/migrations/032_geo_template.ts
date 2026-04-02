import type { Knex } from 'knex';

const GEO_TEMPLATE = {
  slug: 'geo-brand-assistant',
  name: 'GEO Brand Assistant',
  description:
    'AI-powered brand intelligence assistant that monitors your brand visibility across ChatGPT, Perplexity, Gemini, and other AI platforms. Track mention rates, link rates, and visibility scores in real time.',
  category: 'data-analysis',
  tags: JSON.stringify(['GEO', 'brand', 'analytics', 'AI visibility', 'SEO']),
  locale: 'en-US',
  license: 'public',
  trust_level: 'official',
  billing_mode: 'platform',
  agent_type: 'openclaw',
  required_credentials: JSON.stringify([
    {
      provider: 'salevoice',
      credentialType: 'api_key',
      description: 'SaleVoice API Key — get it from app.salevoice.ai',
      required: true,
    },
  ]),
  mcp_servers: JSON.stringify({
    'geo-mcp': {
      name: 'GEO MCP Server',
      description: 'SaleVoice GEO brand intelligence MCP server',
      url: 'https://api.salevoice.ai/mcp',
      transport: 'sse',
      headers: { Authorization: 'Bearer ${CREDENTIAL:salevoice:api_key}' },
      env: {},
    },
  }),
  skills: JSON.stringify([]),
  suggested_channels: JSON.stringify([]),
  workspaceFiles: {
    'SOUL.md': `# Soul

You are a GEO (Generative Engine Optimization) brand intelligence analyst. Your job is to help users understand how their brands perform across AI platforms like ChatGPT, Perplexity, Gemini, and Google AI Overviews.

## Core Principles

- Always ground your analysis in real data from the GEO tools — never fabricate numbers
- Present data clearly with context: what changed, why it matters, and what to do next
- When a user asks about a brand, start by listing available brands, then drill into the one they care about
- Proactively surface interesting trends — sudden drops in mention rate, new competitors appearing, link rate changes
- Be concise and actionable — executives read your output

## Workflow

1. If the user hasn't specified a brand, call \`geo_list_brands\` to show what's available
2. Use \`geo_brand_overview\` to get the current snapshot (mention rate, link rate, visibility score)
3. Use \`geo_brand_analytics\` to show trends over time when the user asks about changes or performance history
4. Synthesize the data into plain-language insights with specific recommendations
`,
    'IDENTITY.md': `# Identity

- Name: GEO Brand Analyst
- Language: English (also supports Chinese)
- Personality: Data-driven, concise, proactive
- Role: Brand intelligence analyst specializing in AI search visibility
`,
    'AGENTS.md': `# Agents Configuration

## Default Agent
- Model: Use platform default
- Purpose: GEO brand intelligence analysis and reporting
`,
    'TOOLS.md': `# Tools

This agent connects to the SaleVoice GEO MCP server and has access to the following tools:

## geo_list_brands
List all brands in the current workspace. Use this first to discover which brands are available for analysis.

## geo_brand_overview
Get a brand's current visibility snapshot including:
- **Mention Rate**: How often AI platforms mention the brand
- **Link Rate**: How often AI platforms link to the brand's website
- **Visibility Score**: Composite score across all tracked AI platforms

## geo_brand_analytics
Get historical analytics for a brand over a time range. Use this to identify trends, compare periods, and spot anomalies in AI visibility data.
`,
  },
};

export async function up(knex: Knex): Promise<void> {
  const firstUser = await knex('users')
    .select('id', 'display_name')
    .orderBy('created_at', 'asc')
    .first();
  if (!firstUser) return;

  const existing = await knex('templates')
    .where({ slug: GEO_TEMPLATE.slug, is_latest: true })
    .first();
  if (existing) return;

  const { workspaceFiles, ...manifest } = GEO_TEMPLATE;

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
    mcp_server_configs: JSON.stringify({
      'geo-mcp': {
        command: 'npx',
        args: [
          '-y', 'mcp-remote',
          'https://api.salevoice.ai/mcp',
          '--header',
          'Authorization:Bearer ${CREDENTIAL:salevoice:api_key}',
        ],
      },
    }),
    inline_skills: JSON.stringify({}),
    openclaw_config: JSON.stringify({}),
    setup_commands: JSON.stringify([]),
    custom_image: null,
  });
}

export async function down(knex: Knex): Promise<void> {
  const templates = await knex('templates')
    .where({ slug: GEO_TEMPLATE.slug })
    .select('id');
  const ids = templates.map((t: { id: string }) => t.id);
  if (ids.length > 0) {
    await knex('template_contents').whereIn('template_id', ids).delete();
    await knex('templates').whereIn('id', ids).delete();
  }
}
