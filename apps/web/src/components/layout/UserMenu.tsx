import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import {
  CreditCard,
  UserCog,
  Settings,
  LogOut,
} from 'lucide-react';

const isEE = import.meta.env.VITE_EDITION !== 'ce';

interface UserMenuProps {
  isAdmin: boolean;
  onClose: () => void;
}

export function UserMenu({ isAdmin, onClose }: UserMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleNav = (path: string) => {
    navigate(path);
    onClose();
  };

  const handleLogout = async () => {
    await logout();
    onClose();
  };

  return (
    <div className="user-menu" role="menu">
      {isEE && (
        <div className="user-menu__group">
          <div className="user-menu__group-label">
            <CreditCard size={14} />
            <span>{t('sidebar.billingGroup')}</span>
          </div>
          <button className="user-menu__item" role="menuitem" onClick={() => handleNav('/billing')}>
            {t('sidebar.billing')}
          </button>
          <button className="user-menu__item" role="menuitem" onClick={() => handleNav('/billing/orders')}>
            {t('sidebar.orders')}
          </button>
          <button className="user-menu__item" role="menuitem" onClick={() => handleNav('/billing/costs')}>
            {t('sidebar.costs')}
          </button>
        </div>
      )}

      <div className="user-menu__group">
        <div className="user-menu__group-label">
          <UserCog size={14} />
          <span>{t('sidebar.userGroup')}</span>
        </div>
        <button className="user-menu__item" role="menuitem" onClick={() => handleNav('/user/credentials')}>
          {t('sidebar.credentials')}
        </button>
        {isEE && (
          <button className="user-menu__item" role="menuitem" onClick={() => handleNav('/profile')}>
            {t('sidebar.account')}
          </button>
        )}
      </div>

      {isEE && isAdmin && (
        <div className="user-menu__group">
          <button
            className="user-menu__item user-menu__item--with-icon"
            role="menuitem"
            onClick={() => handleNav('/admin/config')}
          >
            <Settings size={14} />
            <span>{t('sidebar.systemConfig')}</span>
            <span className="user-menu__admin-badge">Admin</span>
          </button>
          <button
            className="user-menu__item user-menu__item--with-icon"
            role="menuitem"
            onClick={() => handleNav('/admin')}
          >
            <Settings size={14} />
            <span>{t('admin.title')}</span>
            <span className="user-menu__admin-badge">Admin</span>
          </button>
        </div>
      )}

      {isEE && (
        <div className="user-menu__group">
          <button
            className="user-menu__item user-menu__item--danger"
            role="menuitem"
            onClick={handleLogout}
          >
            <LogOut size={14} />
            <span>{t('common.buttons.logout')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
