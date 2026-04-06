import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SystemConfig, AdminUserWithRole, UserRole } from '@aquarium/shared';
import '../../pages/SystemConfigPage.css';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { ListSkeleton } from '@/components/skeletons';

export interface PermissionsSectionProps {
  users: AdminUserWithRole[];
  adminEmails: string[];
  loadingUsers: boolean;
  roleUpdating: string | null;
  onRoleChange: (userId: string, role: UserRole) => Promise<void>;
  currentUserId: string;
  config: SystemConfig;
  onConfigChange: (config: SystemConfig) => void;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  hasChanges: boolean;
}

export function PermissionsSection({
  users,
  adminEmails,
  loadingUsers,
  roleUpdating,
  onRoleChange,
  config,
  onConfigChange,
  saving,
  onSave,
  onReset,
  hasChanges,
}: PermissionsSectionProps) {
  const { t } = useTranslation();
  const [userSearch, setUserSearch] = useState('');

  const filteredUsers = users.filter(u =>
    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.displayName.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <>
      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.permissions.adminEmails')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.permissions.adminEmailsDesc')}</p>
        {adminEmails.length > 0 ? (
          <ul className="sys-config__list">
            {adminEmails.map((email: string) => (
              <li key={email} className="sys-config__list-item">
                <span>{email}</span>
                <span className="sys-config__role-badge sys-config__role-badge--admin">
                  {t('systemConfig.permissions.roleAdmin')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sys-config__empty-text">{t('systemConfig.permissions.noAdminEmails')}</p>
        )}
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.permissions.roleManagement')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.permissions.roleManagementDesc')}</p>

        <div className="sys-config__field" style={{ marginBottom: 'var(--spacing-md)' }}>
          <Input
            type="text"
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            placeholder={t('systemConfig.permissions.searchUsers')}
          />
        </div>

        {loadingUsers ? (
          <ListSkeleton rows={5} />
        ) : (
          <table className="sys-config__table">
            <thead>
              <tr>
                <th>{t('systemConfig.permissions.userName')}</th>
                <th>{t('systemConfig.permissions.userEmail')}</th>
                <th>{t('systemConfig.permissions.userRole')}</th>
                <th>{t('systemConfig.permissions.userInstances')}</th>
                <th>{t('systemConfig.permissions.userJoined')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="sys-config__table-empty">
                    {userSearch ? t('systemConfig.permissions.noMatchingUsers') : t('systemConfig.permissions.noUsersFound')}
                  </td>
                </tr>
              ) : (
                filteredUsers.map(user => (
                  <tr key={user.id}>
                    <td>{user.displayName}</td>
                    <td><code>{user.email}</code></td>
                    <td>
                      <Select
                        value={user.role}
                        onValueChange={v => onRoleChange(user.id, v as UserRole)}
                        disabled={roleUpdating === user.id}
                      >
                        <SelectTrigger className="sys-config__role-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">{t('systemConfig.permissions.roleAdmin')}</SelectItem>
                          <SelectItem value="user">{t('systemConfig.permissions.roleUser')}</SelectItem>
                          <SelectItem value="viewer">{t('systemConfig.permissions.roleViewer')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td>{user.instanceCount}</td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.permissions.instanceQuota')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.permissions.instanceQuotaDesc')}</p>
        <div className="sys-config__field">
          <label>{t('systemConfig.permissions.quotaPerUser')}</label>
          <Input
            type="number"
            min={0}
            value={config.instanceQuotaPerUser ?? 0}
            onChange={e => onConfigChange({ ...config, instanceQuotaPerUser: parseInt(e.target.value, 10) || 0 })}
          />
        </div>
      </section>

      <section className="sys-config__section">
        <h2 className="sys-config__section-title">{t('systemConfig.permissions.defaultRole')}</h2>
        <p className="sys-config__field-desc">{t('systemConfig.permissions.defaultRoleDesc')}</p>
        <div className="sys-config__field">
          <Select
            value={config.defaultUserRole ?? 'user'}
            onValueChange={v => onConfigChange({ ...config, defaultUserRole: v as UserRole })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">{t('systemConfig.permissions.roleAdmin')}</SelectItem>
              <SelectItem value="user">{t('systemConfig.permissions.roleUser')}</SelectItem>
              <SelectItem value="viewer">{t('systemConfig.permissions.roleViewer')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <div className="sys-config__header-actions">
        <Button
          variant="secondary"
          onClick={onReset}
          disabled={saving || !hasChanges}
        >
          {t('systemConfig.resetDefaults')}
        </Button>
        <Button
          onClick={onSave}
          disabled={saving || !hasChanges}
        >
          {saving ? t('systemConfig.saving') : t('systemConfig.saveConfig')}
        </Button>
      </div>
    </>
  );
}
