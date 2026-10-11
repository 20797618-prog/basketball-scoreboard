import type { PropsWithChildren } from 'react';
import { NavLink } from 'react-router-dom';
import { PwaInstallBar } from '../components/PwaInstallBar';
import { AutoBackupStatus } from '../components/AutoBackupStatus';

const tabs = [
  { to: '/match', label: '比赛' },
  { to: '/people', label: '球员' },
  { to: '/stats', label: '排行' },
  { to: '/cola', label: '可乐' },
];

export function TabLayout({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <PwaInstallBar />
      <AutoBackupStatus />
      {children}
      <nav className="tabbar" aria-label="底部导航">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              isActive ? 'tab-link active' : 'tab-link'
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
