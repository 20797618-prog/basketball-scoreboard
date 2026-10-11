import { Navigate, Route, Routes } from 'react-router-dom';
import { TabLayout } from './ui/layout/TabLayout';
import { ColaPage } from './ui/pages/ColaPage';
import { MatchPage } from './ui/pages/MatchPage';
import { PeoplePage } from './ui/pages/PeoplePage';
import { StatsPage } from './ui/pages/StatsPage';
import { initAutoBackup } from './infrastructure/cloudbase/autoBackup';

initAutoBackup();

export function App() {
  return (
    <TabLayout>
      <Routes>
        <Route path="/match" element={<MatchPage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/cola" element={<ColaPage />} />
        <Route path="*" element={<Navigate to="/match" replace />} />
      </Routes>
    </TabLayout>
  );
}
