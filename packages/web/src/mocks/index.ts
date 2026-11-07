// モックのバックエンドを用意する（保存した DB を読み込むか、なければシードを作る）。ブラウザとテストで共有する
import { clearStorage, loadDb, setDb } from './db';
import { resumeBuilds } from './handlers';
import { seed } from './seed';
import { resumeAll, stopAll } from './simulator';

export function initMockBackend(opts: { fresh?: boolean; speed?: number } = {}) {
  stopAll();
  if (opts.fresh) clearStorage();
  const loaded = opts.fresh ? null : loadDb();
  const db = loaded ?? seed();
  if (opts.speed !== undefined) db.settings.speed = opts.speed;
  setDb(db);
  resumeBuilds();
  resumeAll();
  return db;
}

export { handlers } from './handlers';
