import './AgentAvatar.css';
import { PRESET_AVATARS } from '../assets/avatars';

interface AgentAvatarProps {
  avatar?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASS: Record<string, string> = {
  sm: 'agent-avatar--sm',
  md: 'agent-avatar--md',
  lg: 'agent-avatar--lg',
};

export function AgentAvatar({ avatar, name, size = 'md', className }: AgentAvatarProps) {
  const sizeClass = SIZE_CLASS[size];
  const classes = ['agent-avatar', sizeClass, className].filter(Boolean).join(' ');

  if (avatar && avatar.startsWith('preset:')) {
    const presetId = avatar.slice(7);
    const src = PRESET_AVATARS[presetId];
    if (src) {
      return (
        <div className={classes}>
          <img className="agent-avatar__img" src={src} alt={name} />
        </div>
      );
    }
  }

  if (avatar && avatar.startsWith('data:')) {
    return (
      <div className={classes}>
        <img className="agent-avatar__img" src={avatar} alt={name} />
      </div>
    );
  }

  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className={classes}>
      <div className="agent-avatar__fallback">{initial}</div>
    </div>
  );
}
