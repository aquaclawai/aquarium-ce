import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

/**
 * Phase 25 Plan 25-01 — tag-input for Agent.customArgs.
 *
 * Enter adds the trimmed value to the args list; Backspace on an empty
 * input removes the last tag. Each rendered tag has an `×` remove button
 * with a localized aria-label.
 */

interface CustomArgsEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export function CustomArgsEditor({ value, onChange }: CustomArgsEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = draft.trim();
      if (trimmed.length === 0) return;
      onChange([...value, trimmed]);
      setDraft('');
    } else if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  const handleRemove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {value.map((arg, idx) => (
            <Badge
              key={`${arg}-${idx}`}
              variant="secondary"
              className="font-mono text-xs gap-1 pr-1"
              data-agent-arg-tag={idx}
            >
              <span>{arg}</span>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-sm hover:bg-background/40 h-4 w-4"
                aria-label={t('management.agents.form.customArgs.remove', { arg })}
                onClick={() => handleRemove(idx)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <Input
        type="text"
        data-agent-args-input
        placeholder={t('management.agents.form.customArgs.placeholder')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        className="font-mono text-xs"
        aria-label={t('management.agents.form.customArgs.label')}
      />
    </div>
  );
}
