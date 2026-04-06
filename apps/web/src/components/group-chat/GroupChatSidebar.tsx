import { useTranslation } from 'react-i18next';
import type { GroupChat, GroupChatMember } from '@aquarium/shared';
import './group-chat.css';

export interface GroupChatSidebarProps {
  chat: GroupChat | null;
  isOwner: boolean;
  editingMemberId: string | null;
  editDisplayName: string;
  editRole: string;
  onSetEditDisplayName: (v: string) => void;
  onSetEditRole: (v: string) => void;
  onStartEdit: (member: GroupChatMember) => void;
  onCancelEdit: () => void;
  onSaveEdit: (memberId: string) => void;
  onRemoveMember: (memberId: string) => void;
  onShowAddMember: () => void;
}

export function GroupChatSidebar({
  chat,
  isOwner,
  editingMemberId,
  editDisplayName,
  editRole,
  onSetEditDisplayName,
  onSetEditRole,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRemoveMember,
  onShowAddMember,
}: GroupChatSidebarProps) {
  const { t } = useTranslation();

  if (!chat) return null;

  return (
    <div className="gc-sidebar">
      <div className="gc-sidebar-header">
        <h3 className="gc-sidebar-title">{t('groupChat.members.title')}</h3>
        {isOwner && (
          <button
            onClick={onShowAddMember}
            className="gc-sidebar-add-btn"
            title={t('groupChat.members.addButton')}
          >
            +
          </button>
        )}
      </div>

      {chat.members.map((member: GroupChatMember) => (
        <div key={member.id} className="gc-member">
          {editingMemberId === member.id ? (
            <div className="gc-member-edit">
              <input
                type="text"
                value={editDisplayName}
                onChange={e => onSetEditDisplayName(e.target.value)}
                placeholder={t('groupChat.members.displayNameLabel')}
                autoFocus
              />
              <input
                type="text"
                value={editRole}
                onChange={e => onSetEditRole(e.target.value)}
                placeholder={t('groupChat.members.roleLabel')}
                style={{ fontSize: '0.75rem' }}
              />
              <div className="gc-member-edit-actions">
                <button
                  onClick={onCancelEdit}
                  className="gc-member-edit-btn gc-member-edit-btn--cancel"
                >
                  {t('groupChat.members.cancel')}
                </button>
                <button
                  onClick={() => onSaveEdit(member.id)}
                  className="gc-member-edit-btn gc-member-edit-btn--save"
                >
                  {t('groupChat.members.save')}
                </button>
              </div>
            </div>
          ) : (
            <div className="gc-member-row">
              <div className={`gc-member-dot gc-member-dot--${member.isHuman ? 'human' : 'bot'}`} />
              <div className="gc-member-info">
                <div className="gc-member-name-row">
                  <div className="gc-member-name-left">
                    <span className="gc-member-name">{member.displayName}</span>
                    <span className={`gc-member-type gc-member-type--${member.isHuman ? 'human' : 'bot'}`}>
                      {member.isHuman ? t('groupChat.detail.typeBadgeHuman') : t('groupChat.detail.typeBadgeBot')}
                    </span>
                  </div>
                </div>
                {member.role && (
                  <div className="gc-member-role">{member.role}</div>
                )}
              </div>

              {isOwner && (
                <div className="gc-member-actions">
                  <button
                    onClick={() => onStartEdit(member)}
                    title={t('groupChat.members.editTitle')}
                    className="gc-member-action-btn"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => onRemoveMember(member.id)}
                    title={t('groupChat.members.removeTitle')}
                    className="gc-member-action-btn gc-member-action-btn--danger"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
