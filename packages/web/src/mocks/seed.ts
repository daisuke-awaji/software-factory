// モックの初期データ。ワークアイテムは、シミュレーターを過去の時刻で一気に流して作る（イベントの履歴と中身が必ず揃う）
import { CreateWorkItemRequest, Publication, ulid } from '@factory/contracts';
import { setDb, type MockDb } from './db';
import * as fx from './fixtures';
import { advance, atTime, createWorkItem, fastForward } from './simulator';

const MIN = 60_000;

export function seed(): MockDb {
  const db: MockDb = {
    version: 3,
    settings: { speed: 1 },
    me: structuredClone(fx.me),
    users: structuredClone(fx.users),
    repos: structuredClone(fx.repos),
    lines: structuredClone(fx.lines),
    workItems: [],
    events: {},
    plans: {},
    stageRuns: {},
    files: {},
    baseFiles: {},
    attachments: {},
    sim: {},
    publications: [],
    images: structuredClone(fx.images),
    imageVersions: structuredClone(fx.imageVersions),
    buildLogs: Object.fromEntries(Object.values(fx.imageVersions).flat().map((v) => [`${v.name}@${v.version}`, fx.buildLog(v.name, v.version)])),
    networkProfiles: structuredClone(fx.networkProfiles),
    packageSources: structuredClone(fx.packageSources),
    terminatedVms: [],
  };
  setDb(db);
  const now = Date.now();
  const make = (minutesAgo: number, input: Parameters<typeof CreateWorkItemRequest.parse>[0]) => {
    const at = now - minutesAgo * MIN;
    const item = atTime(at, () => createWorkItem(CreateWorkItemRequest.parse(input), db.me.id, db.me.name, at));
    return { item, at };
  };

  // 1. 集計して公開（完了・公開済み）
  const csvPath = 'uploads/seed/sales.csv';
  db.attachments[csvPath] = { fileName: 'sales.csv', contentType: 'text/csv', content: '日付,部署,売上\n2026-10-01,営業1部,620000\n2026-10-01,営業2部,410000\n2026-10-01,企画部,350000\n' };
  const report = make(26 * 60, {
    title: '部署別の売上レポートを作って公開',
    lineRef: 'report-publish@1',
    message: '添付の売上データ（10月分）を部署ごとに集計して、グラフ付きのレポートにしてください。部内に公開したいです。',
    attachments: [csvPath],
  });
  fastForward(report.item.id, report.at, () => 'approve');
  const pubAt = new Date(report.at + 9 * MIN).toISOString();
  db.publications.push(
    Publication.parse({
      id: ulid(report.at + 9 * MIN), workItemId: report.item.id, title: '部署別の売上レポート（2026年10月）', path: 'report/',
      url: `https://d3k8x2pub0.cloudfront.net/p/${report.item.id.toLowerCase()}/`, acl: { scope: 'restricted', groups: ['営業企画部'] },
      version: 1, status: 'active', createdAt: pubAt, updatedAt: pubAt, expiresAt: new Date(now + 29 * 86_400_000).toISOString(),
    }),
  );

  // 2. 表記ゆれ（検証が続けて失敗して止まった）
  const csv = make(130, { title: '顧客リストの表記ゆれを統一', lineRef: 'build-verify@3', repo: { owner: 'acme', name: 'crm-scripts' }, message: '顧客リストの会社名の表記ゆれ（全角・半角、(株) と株式会社）を統一してください。' });
  fastForward(csv.item.id, csv.at, () => 'approve');

  // 3. フォーム（検証で一度失敗し、直して完了。PR #128）
  const form = make(122, { title: '問い合わせフォームの入力チェックを直す', lineRef: 'build-verify@3', repo: { owner: 'acme', name: 'support-site' }, message: '問い合わせフォームで、メールアドレスが正しくなくても送信できてしまいます。入力チェックを直してください。' });
  fastForward(form.item.id, form.at, () => 'approve');

  // 4. ダッシュボード（計画の承認待ち）
  const dash = make(3, { title: '週次売上ダッシュボードを追加', lineRef: 'build-verify@3', repo: { owner: 'acme', name: 'sales-insights' }, message: '売上データから、地域ごとの週次の売上をグラフで見られる画面を追加してください。' });
  fastForward(dash.item.id, dash.at, () => 'stop');

  // 5. README（実行中。続きは画面を開いている間に流れる）
  const readme = make(1, { title: 'README に開発手順を追記', lineRef: 'build-verify@3', repo: { owner: 'acme', name: 'platform' }, message: 'README に、ローカルで開発を始めるための手順を追記してください。' });
  fastForward(readme.item.id, readme.at, () => 'stop');
  // 計画を承認してから、少しだけ進めておく（fastForward の maxSteps=1 は「承認だけ」）
  fastForward(readme.item.id, readme.at + 20_000, () => 'approve', 1);
  advance(readme.item.id, readme.at + 22_000, 18);

  db.users[0]!.monthUsd = Math.round(db.workItems.reduce((s, w) => s + (w.costUsd ?? 0), 0) * 100) / 100;
  setDb(db);
  return db;
}
