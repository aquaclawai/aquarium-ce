import type { ConfigChangeSummary } from '@aquarium/shared';
import { CONFIG_FIELD_META } from './config-field-meta.js';

type ConfigObject = Record<string, unknown>;

export function computeChangeSummary(
  prevConfig: ConfigObject | null,
  currConfig: ConfigObject | null
): ConfigChangeSummary[] {
  const changes: ConfigChangeSummary[] = [];
  const prev = prevConfig ?? {};
  const curr = currConfig ?? {};

  for (const meta of CONFIG_FIELD_META) {
    const { key, label, category, valueFormatter } = meta;
    const prevValue = prev[key];
    const currValue = curr[key];

    const prevExists = prevValue !== undefined && prevValue !== null && prevValue !== '';
    const currExists = currValue !== undefined && currValue !== null && currValue !== '';

    if (!prevExists && currExists) {
      changes.push({
        field: key,
        fieldLabel: label,
        category,
        changeType: 'added',
        newValue: valueFormatter ? valueFormatter(currValue) : summarizeValue(currValue),
        sizeDelta: computeSizeDelta(null, currValue),
      });
    } else if (prevExists && !currExists) {
      changes.push({
        field: key,
        fieldLabel: label,
        category,
        changeType: 'removed',
        oldValue: valueFormatter ? valueFormatter(prevValue) : summarizeValue(prevValue),
        sizeDelta: computeSizeDelta(prevValue, null),
      });
    } else if (prevExists && currExists && !isEqual(prevValue, currValue)) {
      changes.push({
        field: key,
        fieldLabel: label,
        category,
        changeType: 'modified',
        oldValue: valueFormatter ? valueFormatter(prevValue) : summarizeValue(prevValue),
        newValue: valueFormatter ? valueFormatter(currValue) : summarizeValue(currValue),
        sizeDelta: computeSizeDelta(prevValue, currValue),
      });
    }
  }

  return changes;
}

export function computeChangeCount(
  prevConfig: ConfigObject | null,
  currConfig: ConfigObject | null
): number {
  return computeChangeSummary(prevConfig, currConfig).length;
}

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return '（空）';
  if (typeof value === 'string') {
    if (value.length === 0) return '（空）';
    if (value.length <= 30) return value;
    return value.slice(0, 27) + '...';
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return `${value.length} 项`;
  if (typeof value === 'object') return `${Object.keys(value).length} 个字段`;
  return String(value);
}

function computeSizeDelta(oldVal: unknown, newVal: unknown): number {
  const oldSize = oldVal != null ? Buffer.byteLength(JSON.stringify(oldVal), 'utf8') : 0;
  const newSize = newVal != null ? Buffer.byteLength(JSON.stringify(newVal), 'utf8') : 0;
  return newSize - oldSize;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}
