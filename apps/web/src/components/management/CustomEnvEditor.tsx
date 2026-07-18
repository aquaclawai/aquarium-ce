import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Phase 25 Plan 25-01 — key-value editor for Agent.customEnv.
 *
 * Internally tracks an ordered array of `{ id, key, value }` rows so we can
 * render stable React keys (the env `key` itself is user-controlled and
 * therefore unreliable). On every edit the component calls `onChange` with
 * the *derived* Record — duplicate keys collapse with last-write-wins, and
 * a warning is rendered inline for user visibility.
 *
 * Controlled-uncontrolled hybrid: seeds rows from `value` on mount or when
 * `value` changes identity (e.g. when the parent dialog reopens in edit
 * mode for a different agent).
 */

interface EnvRow {
  id: number;
  key: string;
  value: string;
}

interface CustomEnvEditorProps {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

let rowIdCounter = 0;
function nextRowId(): number {
  return ++rowIdCounter;
}

function fromRecord(value: Record<string, string>): EnvRow[] {
  const entries = Object.entries(value);
  if (entries.length === 0) return [];
  return entries.map(([key, v]) => ({ id: nextRowId(), key, value: v }));
}

function toRecord(rows: EnvRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const key = r.key.trim();
    if (!key) continue;
    out[key] = r.value;
  }
  return out;
}

export function CustomEnvEditor({ value, onChange }: CustomEnvEditorProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<EnvRow[]>(() => fromRecord(value));

  // Re-seed ONLY when the incoming record's content meaningfully differs from
  // what the local rows currently represent. We derive the parent's view of
  // our rows (`toRecord(rows)`) and compare it to `value` by serialized shape.
  // This prevents the editor from clobbering local-only drafts (a just-added
  // empty row) when the parent re-renders with an identity-new-but-equal {}.
  useEffect(() => {
    const derived = toRecord(rows);
    const sameContent =
      Object.keys(derived).length === Object.keys(value).length &&
      Object.entries(value).every(([k, v]) => derived[k] === v);
    if (!sameContent) {
      setRows(fromRecord(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const duplicateKeys = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<string>();
    for (const r of rows) {
      const k = r.key.trim();
      if (!k) continue;
      const count = (seen.get(k) ?? 0) + 1;
      seen.set(k, count);
      if (count > 1) dupes.add(k);
    }
    return dupes;
  }, [rows]);

  const pushChange = (next: EnvRow[]) => {
    setRows(next);
    onChange(toRecord(next));
  };

  const handleAddRow = () => {
    pushChange([...rows, { id: nextRowId(), key: '', value: '' }]);
  };

  const handleRemoveRow = (id: number) => {
    pushChange(rows.filter((r) => r.id !== id));
  };

  const handleKeyChange = (id: number, newKey: string) => {
    pushChange(rows.map((r) => (r.id === id ? { ...r, key: newKey } : r)));
  };

  const handleValueChange = (id: number, newValue: string) => {
    pushChange(rows.map((r) => (r.id === id ? { ...r, value: newValue } : r)));
  };

  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const trimmedKey = row.key.trim();
        const isDuplicate = trimmedKey.length > 0 && duplicateKeys.has(trimmedKey);
        return (
          <div
            key={row.id}
            className="space-y-1"
            data-agent-env-row={index}
          >
            <div className="flex gap-2 items-center">
              <Input
                type="text"
                placeholder={t('management.agents.form.customEnv.keyPlaceholder')}
                value={row.key}
                onChange={(e) => handleKeyChange(row.id, e.target.value)}
                className="flex-1 font-mono text-xs"
                aria-label={t('management.agents.form.customEnv.keyPlaceholder')}
              />
              <Input
                type="text"
                placeholder={t('management.agents.form.customEnv.valuePlaceholder')}
                value={row.value}
                onChange={(e) => handleValueChange(row.id, e.target.value)}
                className="flex-1"
                aria-label={t('management.agents.form.customEnv.valuePlaceholder')}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('management.agents.form.customEnv.removeRow')}
                onClick={() => handleRemoveRow(row.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {isDuplicate ? (
              <p className="text-xs text-[var(--color-warning-subtle-text)] pl-1">
                {t('management.agents.form.customEnv.duplicateKey', { key: trimmedKey })}
              </p>
            ) : null}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-agent-env-add
        onClick={handleAddRow}
      >
        <Plus className="h-4 w-4" />
        {t('management.agents.form.customEnv.addRow')}
      </Button>
    </div>
  );
}
