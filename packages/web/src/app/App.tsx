import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { AdminPage } from '../features/admin/AdminPage';
import { HomePage } from '../features/home/HomePage';
import { ImagesPage } from '../features/images/ImagesPage';
import { LinesPage } from '../features/lines/LinesPage';
import { PublicationsPage } from '../features/publications/PublicationsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { WorkspacePage } from '../features/workitem/WorkspacePage';
import { ServicesProvider, type Services } from '../lib/services';
import { AppShell, NotFound } from './AppShell';

// 画面の一覧は docs/06_ui_spec.md §1。データの読み込みは apiClient で行い、router のデータ API は使わない（実装計画 §2.2）
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'w/:id', element: <WorkspacePage /> },
      { path: 'publications', element: <PublicationsPage /> },
      { path: 'images', element: <ImagesPage /> },
      { path: 'lines', element: <LinesPage /> },
      { path: 'admin', element: <AdminPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function App({ services }: { services: Services }) {
  const router = createBrowserRouter(routes);
  return (
    <ServicesProvider value={services}>
      <RouterProvider router={router} />
    </ServicesProvider>
  );
}
