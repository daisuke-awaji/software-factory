// 設定画面の「モックの操作」から使う（モックのときだけ動的に読み込む）
import { getDb, save } from './db';
import { initMockBackend } from './index';

export const mockControl = {
  speed: () => getDb().settings.speed,
  setSpeed(speed: number) {
    getDb().settings.speed = speed;
    save();
  },
  /** GitHub App の認可の往復（本物はページの遷移で行う）を、その場で済ませる */
  setGithubConnected(connected: boolean) {
    const me = getDb().me;
    me.github = connected ? { connected: true, login: 'msato' } : { connected: false };
    save();
  },
  setAdmin(admin: boolean) {
    const d = getDb();
    d.me.roles = admin ? ['user', 'admin'] : ['user'];
    const u = d.users.find((x) => x.id === d.me.id);
    if (u) u.roles = d.me.roles;
    save();
  },
  reset() {
    initMockBackend({ fresh: true });
  },
};
