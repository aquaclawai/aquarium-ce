import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { PRESET_AVATARS, AVATAR_CATEGORIES } from '../assets/avatars';
import { Button } from '@/components/ui';
import './AvatarPicker.css';

interface AvatarPickerProps {
  value?: string | null;
  onChange: (avatar: string | null) => void;
}

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function AvatarPicker({ value, onChange }: AvatarPickerProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);

  function handlePresetClick(presetId: string) {
    const presetValue = `preset:${presetId}`;
    onChange(value === presetValue ? null : presetValue);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) return;
    if (file.size > MAX_FILE_SIZE) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange(reader.result);
      }
    };
    reader.readAsDataURL(file);

    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="avatar-picker">
      {AVATAR_CATEGORIES.map((cat) => (
        <div key={cat.id} className="avatar-picker__category">
          <div className="avatar-picker__category-label">
            {t(`wizard.avatar.${cat.id}`)}
          </div>
          <div className="avatar-picker__grid">
            {cat.presets.map((presetId) => {
              const presetValue = `preset:${presetId}`;
              const isSelected = value === presetValue;
              const src = PRESET_AVATARS[presetId];
              return (
                <Button
                  key={presetId}
                  type="button"
                  variant="ghost"
                  className={`avatar-picker__item${isSelected ? ' avatar-picker__item--selected' : ''}`}
                  onClick={() => handlePresetClick(presetId)}
                >
                  <img src={src} alt={presetId} />
                </Button>
              );
            })}
          </div>
        </div>
      ))}

      {value && value.startsWith('data:') && (
        <div className="avatar-picker__custom-preview">
          <img className="avatar-picker__custom-img" src={value} alt="custom" />
          <Button
            type="button"
            variant="ghost"
            className="avatar-picker__remove-btn"
            onClick={() => onChange(null)}
          >
            {t('wizard.avatar.removeLabel')}
          </Button>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        className="avatar-picker__upload-btn"
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={14} />
        {t('wizard.avatar.uploadLabel')}
      </Button>
      <p className="avatar-picker__upload-hint">{t('wizard.avatar.uploadHint')}</p>
      <input type="file"
        ref={fileRef}
        accept=".jpg,.jpeg,.png,.webp"
        onChange={handleFileChange}
        hidden
      />
    </div>
  );
}
