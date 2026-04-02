import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('templates', (table) => {
    table.integer('security_score').notNullable().defaultTo(0);
  });

  const officialSlugs = ['general-ai-assistant', 'customer-service-bot', 'team-collaboration-assistant'];
  const officialTemplates = await knex('templates')
    .whereIn('slug', officialSlugs)
    .select('id');

  const templateIds = officialTemplates.map((t: { id: string }) => t.id);

  if (templateIds.length > 0) {
    const defaultSecurity = JSON.stringify({
      minSecurityProfile: 'standard',
      includeTrustLevels: true,
      customNeverDoRules: [],
      customSuspiciousPatterns: [],
    });

    await knex('template_contents')
      .whereIn('template_id', templateIds)
      .whereNull('security')
      .update({ security: defaultSecurity });

    await knex('templates')
      .whereIn('id', templateIds)
      .update({ security_score: 60 });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('templates', (table) => {
    table.dropColumn('security_score');
  });
}
