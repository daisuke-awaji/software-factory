import { lazy, Suspense, useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { Loading } from '../components/kit';
import { HomePage } from '../features/home/HomePage';
import { TasksPage } from '../features/tasks/TasksPage';
import { WorkspacePage } from '../features/task/WorkspacePage';
import { ServicesProvider, type Services } from '../lib/services';
import { AppShell, NotFound } from './AppShell';

// よく使うホーム・すべての依頼・ワークスペース以外は、開いたときに読み込む
const AdminPage = lazy(() => import('../features/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const ImagesPage = lazy(() => import('../features/images/ImagesPage').then((m) => ({ default: m.ImagesPage })));
const WorkflowsPage = lazy(() => import('../features/workflows/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage })));
const PublicationsPage = lazy(() => import('../features/publications/PublicationsPage').then((m) => ({ default: m.PublicationsPage })));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const later = (node: ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>;

// 画面の一覧は docs/06_ui_spec.md §1。データの読み込みは apiClient で行い、router のデータ API は使わない（実装計画 §2.2）
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'requests', element: <TasksPage /> },
      { path: 't/:id', element: <WorkspacePage /> },
      { path: 'publications', element: later(<PublicationsPage />) },
      { path: 'images', element: later(<ImagesPage />) },
      { path: 'workflows', element: later(<WorkflowsPage />) },
      { path: 'admin', element: later(<AdminPage />) },
      { path: 'settings', element: later(<SettingsPage />) },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function App({ services }: { services: Services }) {
  const [router] = useState(() => createBrowserRouter(routes, { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' }));
  return (
    <ServicesProvider value={services}>
      <RouterProvider router={router} />
    </ServicesProvider>
  );
}
