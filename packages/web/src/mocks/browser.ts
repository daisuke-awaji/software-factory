// 開発時（VITE_API_MOCK=true）に、ブラウザで MSW を起動する
import { setupWorker } from 'msw/browser';
import { handlers, initMockBackend } from './index';

export async function startMockWorker() {
  // ?mock-reset でデータを作り直す（E2E やデモの前に使う）。?mock-speed=5 で進む速さを変える
  const params = new URLSearchParams(location.search);
  const speed = params.get('mock-speed');
  initMockBackend({ fresh: params.has('mock-reset'), ...(speed ? { speed: Number(speed) } : {}) });
  const worker = setupWorker(...handlers);
  // 画面のファイル（/src/*.tsx など）は MSW を通さずにそのまま取りに行く
  // GitHub Pages では /<リポジトリ名>/ の下に置くため、ワーカーの場所と範囲をベースのパスに合わせる
  const base = import.meta.env.BASE_URL;
  await worker.start({ quiet: true, onUnhandledFrame: 'bypass', serviceWorker: { url: `${base}mockServiceWorker.js`, options: { scope: base } } });
  if (params.has('mock-reset') || speed) {
    params.delete('mock-reset');
    params.delete('mock-speed');
    const q = params.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  }
}
