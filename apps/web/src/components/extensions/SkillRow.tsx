import type { InstanceSkill } from '@aquarium/shared';
import { ExtensionRow } from './ExtensionRow';

interface SkillRowProps {
  skill: InstanceSkill;
  onToggle: (skillId: string, enabled: boolean) => void;
  onUninstall: (skillId: string) => void;
  onConfigure: (skillId: string) => void;
  disabled: boolean;
}

export function SkillRow({ skill, onToggle, onUninstall, onConfigure, disabled }: SkillRowProps) {
  return (
    <ExtensionRow
      extensionKind="skill"
      extensionId={skill.skillId}
      extensionName={skill.skillId}
      status={skill.status}
      enabled={skill.enabled}
      errorMessage={skill.errorMessage}
      onToggle={onToggle}
      onUninstall={onUninstall}
      onConfigure={onConfigure}
      disabled={disabled}
    />
  );
}
