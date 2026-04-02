import type { Knex } from 'knex';

const JINKO_TEMPLATE = {
  slug: 'jinko-travel-assistant',
  name: 'Jinko Travel Assistant',
  description:
    'AI-powered travel assistant that searches flights, compares prices, plans trips, and books tickets using the Jinko flight search API. Supports destination discovery, flexible date calendars, and end-to-end booking.',
  category: 'travel',
  tags: JSON.stringify(['travel', 'flights', 'booking', 'trip planning', 'Jinko']),
  locale: 'en-US',
  license: 'public',
  trust_level: 'official',
  billing_mode: 'platform',
  agent_type: 'openclaw',
  required_credentials: JSON.stringify([
    {
      provider: 'jinko',
      credentialType: 'api_key',
      description: 'Jinko API Key (jnk_...) — get from builders.gojinko.com',
      required: true,
    },
  ]),
  mcp_servers: JSON.stringify({
    jinko: {
      name: 'Jinko Travel MCP',
      description: 'Jinko flight search, booking, and trip planning MCP server',
      url: 'https://mcp.builders.gojinko.com/mcp',
      headers: { Authorization: 'Bearer ${CREDENTIAL:jinko:api_key}' },
      env: {},
    },
  }),
  skills: JSON.stringify([]),
  suggested_channels: JSON.stringify([]),
  workspaceFiles: {
    'SOUL.md': `# Soul

You are a travel assistant specializing in flight search and trip planning. Your job is to help users find the best flights, compare prices across dates, plan multi-leg trips, and book tickets.

## Core Principles

- Always use the Jinko tools to search for real flight data — never fabricate prices or schedules
- Present flight options clearly: airline, times, duration, stops, and price
- When a user is flexible on dates, use the flight calendar to show price trends across a date range
- Proactively suggest alternatives: nearby airports, flexible dates, different cabin classes
- Confirm all booking details with the user before calling the book tool

## Workflow

1. If the user hasn't specified a destination, use \`find_destination\` to help them discover options by keyword
2. Use \`find_flight\` for cached route searches or \`flight_calendar\` for flexible date price comparison
3. Use \`flight_search\` to get live pricing — either by route + date or with an offer_token from step 2
4. Use \`trip\` to create an itinerary, add flight items, and set traveler details
5. Use \`book\` only after the user explicitly confirms they want to proceed with booking
`,
    'IDENTITY.md': `# Identity

- Name: Travel Assistant
- Language: English (also supports Chinese)
- Personality: Helpful, thorough, price-conscious
- Role: Travel booking specialist powered by Jinko flight data
`,
    'TOOLS.md': `# Tools

This agent connects to the Jinko Travel MCP server and has access to the following tools:

## find_destination
Discover travel destinations accessible from departure airports. Returns destinations sorted by cheapest available flight with offer_tokens. Use this when the user wants to explore where they can fly from a given origin.

## flight_calendar
Show cheapest flight prices across a date range for a specific route. Use this when the user has flexible travel dates and wants to find the cheapest day to fly. Returns daily lowest prices with offer_tokens for each entry.

## find_flight
Search cached flight data for a specific route. Returns flights with offer_tokens that can be used with flight_search for live pricing. Supports filtering by dates, cabin class, stops, and price.

## flight_search
Get live flight pricing and fare options directly from airlines. Dual-mode:
- **Search mode** (origin + destination + departure_date): Live search returning real-time availability and pricing.
- **Price-check mode** (offer_token): Get detailed fare breakdown for a specific flight from find_flight or flight_calendar results.
Returns fare options with price breakdown, baggage rules, and trip_item_tokens for the trip tool.

## trip
Create and manage a trip: add flight items and set traveler details. Use trip_item_tokens from flight_search results. Set passenger info (name, date of birth, gender) and contact details. Returns a trip_id for booking.

## book
Get a checkout URL for a trip. IMPORTANT: Only call this after the user has explicitly confirmed they want to proceed. The trip must have flight items and travelers set. Returns a checkout_url that the user opens in a browser to complete payment via Stripe.
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
    .where({ slug: JINKO_TEMPLATE.slug, is_latest: true })
    .first();
  if (existing) return;

  const { workspaceFiles, ...manifest } = JINKO_TEMPLATE;

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

export async function down(knex: Knex): Promise<void> {
  const templates = await knex('templates')
    .where({ slug: JINKO_TEMPLATE.slug })
    .select('id');
  const ids = templates.map((t: { id: string }) => t.id);
  if (ids.length > 0) {
    await knex('template_contents').whereIn('template_id', ids).delete();
    await knex('templates').whereIn('id', ids).delete();
  }
}
