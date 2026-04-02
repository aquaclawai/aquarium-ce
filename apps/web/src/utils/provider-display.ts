import type { TFunction } from 'i18next';

export const INTERNAL_BACKENDS = new Set(['openrouter', 'litellm']);


export function getProviderDisplayName(
  providerId: string | undefined | null,
  t: TFunction,
): string | undefined {
  if (!providerId) return undefined;
  if (INTERNAL_BACKENDS.has(providerId)) {
    return t('instance.overview.platformAI');
  }
  return providerId;
}

export function formatModelDisplayName(model: string | undefined | null): string {
  if (!model) return '';
  const parts = model.split('/');
  const stripped = parts.filter(p => !INTERNAL_BACKENDS.has(p));
  return stripped.length > 0 ? stripped.join('/') : parts[parts.length - 1];
}
