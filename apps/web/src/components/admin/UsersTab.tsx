import { useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { AdminUser, AdminUserInstance } from '@aquarium/shared';

interface UsersTabProps {
  users: AdminUser[];
}

export function UsersTab({ users }: UsersTabProps) {
  const { t } = useTranslation();
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userInstances, setUserInstances] = useState<AdminUserInstance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(false);

  const toggleUserInstances = async (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setUserInstances([]);
      return;
    }
    setExpandedUserId(userId);
    setInstancesLoading(true);
    try {
      const instances = await api.get<AdminUserInstance[]>(`/admin/users/${userId}/instances`);
      setUserInstances(instances);
    } catch (err) {
      console.error(err instanceof Error ? err.message : t('admin.users.failedToLoadInstances'));
    } finally {
      setInstancesLoading(false);
    }
  };

  return (
    <>
      <div className="admin-users-section">
        <h2>{t('admin.users.title', { count: users.length })}</h2>
        <div className="admin-users-table-wrapper">
          <table className="admin-users-table">
            <thead>
              <tr>
                <th>{t('admin.users.columns.name')}</th>
                <th>{t('admin.users.columns.email')}</th>
                <th>{t('admin.users.columns.instances')}</th>
                <th>{t('admin.users.columns.running')}</th>
                <th>{t('admin.users.columns.joined')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <Fragment key={u.id}>
                  <tr className={expandedUserId === u.id ? 'admin-row-expanded' : ''}>
                    <td className="admin-user-name">{u.displayName}</td>
                    <td>{u.email}</td>
                    <td>{u.instanceCount}</td>
                    <td>
                      {u.runningCount > 0
                        ? <span className="admin-running-badge">{u.runningCount}</span>
                        : '0'}
                    </td>
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        {u.instanceCount > 0 && (
                          <button
                            className="btn-small btn-secondary"
                            onClick={() => toggleUserInstances(u.id)}
                          >
                            {expandedUserId === u.id ? t('admin.users.hideInstances') : t('admin.users.showInstances')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedUserId === u.id && (
                    <tr className="admin-instances-row">
                      <td colSpan={6}>
                        {instancesLoading ? (
                          <div className="admin-instances-loading">
                            <span className="spinner" /> {t('admin.users.loadingInstances')}
                          </div>
                        ) : (
                          <div className="admin-instances-list">
                            {userInstances.map(inst => (
                              <Link key={inst.id} to={`/instances/${inst.id}`} className="admin-instance-item">
                                <span className="admin-instance-name">{inst.name}</span>
                                <span className={`status-badge status-${inst.status}`}>
                                  {(inst.status === 'starting' || inst.status === 'stopping') && <span className="spinner" />}{' '}
                                  {t('common.status.' + inst.status)}
                                </span>
                                <span className="admin-instance-meta">{t('common.agentType.' + inst.agentType)}</span>
                                <span className="admin-instance-meta">{t('common.deploymentTarget.' + inst.deploymentTarget)}</span>
                                <span className="admin-instance-meta">{inst.imageTag}</span>
                                <span className="admin-instance-meta">{new Date(inst.createdAt).toLocaleDateString()}</span>
                              </Link>
                            ))}
                            {userInstances.length === 0 && (
                              <div className="admin-no-instances">{t('admin.users.noInstances')}</div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
