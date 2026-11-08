// モックの初期データ。タスクは、シミュレーターを過去の時刻で一気に流して作る（イベントの履歴と中身が必ず揃う）
import { CreateTaskRequest, Publication, ulid } from '@factory/contracts';
import { setDb, type MockDb } from './db';
import * as fx from './fixtures';
import { advance, atTime, cancel, createTask, fastForward, withPrNumbers } from './simulator';

const MIN = 60_000;

type PastRepo = 'support-site' | 'sales-insights' | 'platform' | 'crm-scripts' | 'handbook';
/** サイドパネルの「過去のタスク」と、続きの読み込みを確かめるための、終わったタスク（何日前・タイトル・リポジトリ。リポジトリがなければ chat ワークフロー） */
const PAST: [days: number, title: string, repo?: PastRepo | undefined, end?: 'cancelled'][] = [
  [1, '請求書の PDF から金額を抜き出す'],
  [1, '採用ページの文言を直す', 'support-site'],
  [2, '会議室の予約状況を一覧にする'],
  [3, '週報のひな形を作る'],
  [3, 'ログイン画面を英語にも対応させる', 'support-site'],
  [4, '顧客アンケートの自由記述を分類'],
  [5, '社内 FAQ のページを追加', 'handbook'],
  [6, '問い合わせメールの返信文の下書き', undefined, 'cancelled'],
  [8, '商品一覧のページ送りを直す', 'sales-insights'],
  [9, '研修の申し込み状況をまとめる'],
  [10, 'バッチの実行時間を短くする', 'crm-scripts'],
  [12, '議事録から宿題を抜き出す'],
  [13, '画像の代替テキストを付ける', 'support-site'],
  [15, '取引先の住所を最新にする'],
  [16, 'API の応答の遅いところを調べる', 'platform'],
  [18, '新人向けのチェックリストを作る'],
  [20, '依存パッケージを最新にする', 'platform'],
  [22, 'メール配信の停止リンクを追加', 'support-site'],
  [24, '出張旅費の精算ルールを要約'],
  [26, '共通ヘッダーのリンク切れを直す', 'handbook'],
  [29, '営業日の計算を祝日に対応させる', 'crm-scripts', 'cancelled'],
  [33, 'プレスリリースの校正'],
  [37, 'サイトの表示速度を測る', 'support-site'],
  [41, '社内用語集を作る'],
  [45, 'エラーメッセージを分かりやすくする', 'platform'],
  [50, '問い合わせの件数を月ごとに数える'],
  [56, 'ダークモードの配色を整える', 'sales-insights'],
  [63, '契約書のひな形の差分を確かめる'],
  [70, 'タイムゾーンの扱いを直す', 'crm-scripts'],
  [78, 'アクセシビリティの点検', 'support-site'],
  [86, '年末の挨拶文を考える'],
  [95, 'セッションの有効期限を延ばす', 'platform'],
];

export function seed(): MockDb {
  const db: MockDb = {
    version: 6,
    settings: { speed: 1 },
    me: structuredClone(fx.me),
    users: structuredClone(fx.users),
    repos: structuredClone(fx.repos),
    workflows: structuredClone(fx.workflows),
    tasks: [],
    events: {},
    plans: {},
    stepRuns: {},
    files: {},
    baseFiles: {},
    attachments: {},
    sim: {},
    publications: [],
    images: structuredClone(fx.images),
    imageVersions: structuredClone(fx.imageVersions),
    buildLogs: Object.fromEntries(
      Object.values(fx.imageVersions)
        .flat()
        .map((v) => [`${v.name}@${v.version}`, fx.buildLog(v.name, v.version)]),
    ),
    networkProfiles: structuredClone(fx.networkProfiles),
    packageSources: structuredClone(fx.packageSources),
    terminatedVms: [],
  };
  setDb(db);
  const now = Date.now();
  const make = (minutesAgo: number, input: Parameters<typeof CreateTaskRequest.parse>[0]) => {
    const at = now - minutesAgo * MIN;
    const item = atTime(at, () => createTask(CreateTaskRequest.parse(input), db.me.id, db.me.name, at));
    return { item, at };
  };

  // 0. 過去のタスク（終わったもの）。PR は新しいものから #127, #126, … にする（下のフォームのタスクを #128 にするため）
  let pastPr = 128;
  for (const [days, title, repo, end] of PAST) {
    const past = make(days * 24 * 60 + 90, {
      title,
      workflowRef: repo ? 'build-verify@3' : 'chat@1',
      ...(repo ? { repo: { owner: 'acme', name: repo } } : {}),
      message: `「${title}」の作業をお願いします。`,
    });
    if (end === 'cancelled') {
      const stopped = fastForward(past.item.id, past.at, () => 'stop', 2000, 6);
      atTime(stopped + 3 * MIN, () => cancel(past.item.id, '計画を見て、タスクを取り下げました。'));
    } else {
      withPrNumbers(
        () => --pastPr,
        () => fastForward(past.item.id, past.at, () => 'approve', 2000, 6),
      );
    }
  }

  // 1. 集計して公開（完了・公開済み）
  const csvPath = 'uploads/seed/sales.csv';
  db.attachments[csvPath] = {
    fileName: 'sales.csv',
    contentType: 'text/csv',
    content: '日付,部署,売上\n2026-10-01,営業1部,620000\n2026-10-01,営業2部,410000\n2026-10-01,企画部,350000\n',
  };
  const report = make(26 * 60, {
    title: '部署別の売上レポートを作って公開',
    workflowRef: 'report-publish@1',
    message: '添付の売上データ（10月分）を部署ごとに集計して、グラフ付きのレポートにしてください。部内に公開したいです。',
    attachments: [csvPath],
  });
  fastForward(report.item.id, report.at, () => 'approve', 2000, 9);
  const pubAt = new Date(report.at + 9 * MIN).toISOString();
  db.publications.push(
    Publication.parse({
      id: ulid(report.at + 9 * MIN),
      taskId: report.item.id,
      title: '部署別の売上レポート（2026年10月）',
      path: 'report/',
      url: `https://d3k8x2pub0.cloudfront.net/p/${report.item.id.toLowerCase()}/`,
      acl: { scope: 'restricted', groups: ['営業企画部'] },
      version: 1,
      status: 'active',
      createdAt: pubAt,
      updatedAt: pubAt,
      expiresAt: new Date(now + 29 * 86_400_000).toISOString(),
    }),
  );

  // 2. 表記ゆれ（検証が続けて失敗して止まった）
  const csv = make(130, {
    title: '顧客リストの表記ゆれを統一',
    workflowRef: 'build-verify@3',
    repo: { owner: 'acme', name: 'crm-scripts' },
    message: '顧客リストの会社名の表記ゆれ（全角・半角、(株) と株式会社）を統一してください。',
  });
  fastForward(csv.item.id, csv.at, () => 'approve', 2000, 6);

  // 3. フォーム（検証で一度失敗し、直して完了。PR #128）
  const form = make(122, {
    title: '問い合わせフォームの入力チェックを直す',
    workflowRef: 'build-verify@3',
    repo: { owner: 'acme', name: 'support-site' },
    message: '問い合わせフォームで、メールアドレスが正しくなくても送信できてしまいます。入力チェックを直してください。',
  });
  fastForward(form.item.id, form.at, () => 'approve', 2000, 8);

  // 3b. 並列（単体テストと E2E を同時に流し、小さい変更なのでセキュリティレビューを飛ばして完了。PR #129）
  const sort = make(60, {
    title: '在庫一覧に並び替えを付ける',
    workflowRef: 'build-parallel@1',
    repo: { owner: 'acme', name: 'sales-insights' },
    message: '在庫一覧の表で、列の見出しを押すと並び替えられるようにしてください。',
  });
  fastForward(sort.item.id, sort.at, () => 'approve', 2000, 8);

  // 4. ダッシュボード（計画の承認待ち）
  const dash = make(4, {
    title: '週次売上ダッシュボードを追加',
    workflowRef: 'build-verify@3',
    repo: { owner: 'acme', name: 'sales-insights' },
    message: '売上データから、地域ごとの週次の売上をグラフで見られる画面を追加してください。',
  });
  fastForward(dash.item.id, dash.at, () => 'stop', 2000, 6);

  // 5. README（実行中。続きは画面を開いている間に流れる）
  const readme = make(5, {
    title: 'README に開発手順を追記',
    workflowRef: 'build-verify@3',
    repo: { owner: 'acme', name: 'platform' },
    message: 'README に、ローカルで開発を始めるための手順を追記してください。',
  });
  const planned = fastForward(readme.item.id, readme.at, () => 'stop', 2000, 6);
  // 計画を承認してから、少しだけ進めておく（fastForward の maxSteps=1 は「承認だけ」）
  fastForward(readme.item.id, planned + 40_000, () => 'approve', 1);
  advance(readme.item.id, planned + 42_000, 14, 4);

  const month = new Date(now).toISOString().slice(0, 7);
  db.users[0]!.monthUsd =
    Math.round(db.tasks.filter((w) => w.createdAt.startsWith(month)).reduce((s, w) => s + (w.costUsd ?? 0), 0) * 100) / 100;
  setDb(db);
  return db;
}
