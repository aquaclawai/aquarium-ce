import type { Knex } from 'knex';

/**
 * Vault configuration (1Password, HashiCorp Vault) is stored in instances.config
 * JSON column under the 'vaultConfig' key. No schema change needed.
 *
 * Shape: { type: 'onepassword' | 'hashicorp', address?: string, authMethod?: string, namespace?: string, mountPath?: string }
 */
export async function up(_knex: Knex): Promise<void> {
  // No-op: vault config stored in existing instances.config JSON column
}

export async function down(_knex: Knex): Promise<void> {
  // No-op
}
