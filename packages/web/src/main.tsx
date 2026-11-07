import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createApiClient } from './lib/api';
import { EventStream } from './lib/events';
import type { Services } from './lib/services';
import { applyTheme, useUi } from './stores/ui';
import './styles/global.css';

const mock = import.meta.env.VITE_API_MOCK === 'true';

async function main() {
  if (import.meta.env.VITE_API_MOCK === 'true') {
    // MSW を先に起動する（動的 import なので、モックのコードは本番のビルドに入らない）
    const { startMockWorker } = await import('./mocks/browser');
    await startMockWorker();
  }
  // 本番は Cognito の ID トークン（M1 で Amplify などに差し替える）
  const getToken = () => (mock ? 'mock-token' : (sessionStorage.getItem('sf.idToken') ?? ''));
  const api = createApiClient({ getToken });
  const events = new EventStream(import.meta.env.VITE_WS_URL ?? 'wss://ws.factory.mock/ws', getToken, api);
  events.start();
  const services: Services = { api, events, mock };

  applyTheme(useUi.getState().theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(useUi.getState().theme));

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App services={services} />
    </StrictMode>,
  );
}

void main();
