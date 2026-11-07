// シミュレーターの台本。依頼の内容からシナリオを選び、ステージごとの手順（SimStep）を組み立てる
import type { Plan, Task } from '@factory/contracts';
import type { Scenario, Sim, SimStep } from './db';

let seq = 0;
const tid = () => `tu_${Date.now().toString(36)}${(seq++).toString(36)}`;

export function pickScenario(title: string, message: string): Scenario {
  const t = `${title} ${message}`;
  if (/フォーム|入力チェック|バリデーション/.test(t)) return 'web-form';
  if (/ダッシュボード|グラフを画面/.test(t)) return 'dashboard';
  if (/README|ドキュメント|手順/.test(t)) return 'readme';
  if (/表記ゆれ|名寄せ|正規化/.test(t)) return 'csv-cleanup';
  if (/レポート|集計|CSV|Excel/i.test(t)) return 'report';
  return 'generic';
}

// ---------------------------------------------------------------- 小さな部品
const say = (text: string, delay = 500): SimStep => ({ t: 'say', delay, text });
const usage = (i: number, o: number, vm: number): SimStep => ({ t: 'emit', delay: 50, event: { type: 'usage', inputTokens: i, outputTokens: o, vmSeconds: vm } });
const stepChanged = (stepId: string, state: 'started' | 'completed' | 'failed', delay = 400): SimStep => ({ t: 'emit', delay, event: { type: 'step.changed', stepId, state } });
const state = (s: Task['state'], delay = 200): SimStep => ({ t: 'emit', delay, event: { type: 'task.state', state: s } });
const write = (path: string, content: string | null, delay = 100): SimStep => ({ t: 'write', delay, path, content });

function tool(name: string, summary: string, result: string, ok = true, ms = 900): SimStep[] {
  const id = tid();
  return [
    { t: 'emit', delay: 250, event: { type: 'tool.started', toolUseId: id, tool: name, summary } },
    { t: 'emit', delay: ms, event: { type: 'tool.finished', toolUseId: id, ok, summary: result } },
  ];
}

function edit(path: string, content: string, summary: string, result = '保存しました'): SimStep[] {
  const [start, finish] = tool('edit_file', summary, result, true, 700);
  return [start!, write(path, content, 300), finish!];
}

// ---------------------------------------------------------------- 計画
export function planFor(sc: Scenario, item: Task, comments: string[]): Plan {
  const repo = item.repo ? `${item.repo.owner}/${item.repo.name}` : undefined;
  const base: Record<Scenario, Omit<Plan, 'repos'>> = {
    'web-form': {
      summaryForHumans: '問い合わせフォームで、入力の誤りを送信する前にその場で知らせるようにします。メールの形式と、内容が空でないことを確かめ、誤りがあれば欄のすぐ下に理由を出します。',
      goal: 'フォームの入力チェックを直し、誤った内容のまま送信されないようにする',
      deliverables: ['入力チェックの修正（src/contact-form.ts）', 'テストの追加', 'プルリクエスト'],
      steps: ['いまの入力チェックと画面を確認する', 'メールの形式と必須の項目のチェックを足す', '誤りを欄の下に表示する', 'テストを足して、別の VM で確かめる', 'プルリクエストを作る'],
      doneCriteria: ['誤ったメールアドレスでは送信できない', '既存と追加のテストがすべて通る'],
      externalAccess: [],
      estimate: { minutes: 12, usd: 0.6 },
    },
    dashboard: {
      summaryForHumans: '売上データから、地域ごとの週次の売上を棒グラフで見られる画面を追加します。グラフの部品に Chart.js を使う予定です。',
      goal: '週次の売上を地域別に見られるダッシュボードを追加する',
      deliverables: ['ダッシュボードの画面（src/pages/weekly.tsx）', '週次の集計の関数とテスト', 'プルリクエスト'],
      steps: ['売上データの形を確認する', '週次・地域別に集計する関数を書く', 'グラフの画面を作る', 'テストを書いて、別の VM で確かめる', 'プルリクエストを作る'],
      doneCriteria: ['サンプルのデータで、週ごとの合計が元のデータと一致する', '画面にグラフが表示される'],
      externalAccess: ['cdn.jsdelivr.net（Chart.js の取得）'],
      estimate: { minutes: 8, usd: 0.9 },
    },
    readme: {
      summaryForHumans: 'README に、ローカルで開発を始めるための手順（準備、テストの実行、よくあるエラー）を書き足します。コードは変えません。',
      goal: '新しく参加した人が README だけで開発を始められるようにする',
      deliverables: ['README.md の更新', 'docs/development.md（詳しい手順）', 'プルリクエスト'],
      steps: ['いまの README とスクリプトを確認する', '準備からテストの実行までの手順を書く', 'よくあるエラーと対処を書く', 'リンク切れがないか確かめる', 'プルリクエストを作る'],
      doneCriteria: ['書いた手順のコマンドが、そのまま動く'],
      externalAccess: [],
      estimate: { minutes: 6, usd: 0.3 },
    },
    'csv-cleanup': {
      summaryForHumans: '顧客リストの会社名の表記（全角・半角、「株式会社」と「(株)」など）をそろえる処理を直します。',
      goal: '会社名の表記ゆれを統一する',
      deliverables: ['scripts/normalize.py の修正', 'テストの追加', 'プルリクエスト'],
      steps: ['いまの整形の処理とデータを確認する', '全角・半角と法人の種類の表記をそろえる', 'テストを足して、別の VM で確かめる', 'プルリクエストを作る'],
      doneCriteria: ['サンプルの3件が同じ書き方になる', 'テストがすべて通る'],
      externalAccess: [],
      estimate: { minutes: 7, usd: 0.4 },
    },
    report: {
      summaryForHumans: '添付のデータを部署ごとに集計して、グラフ付きのレポート（HTML）を作ります。できあがったら、社内に公開できる形にします。',
      goal: '部署別の売上レポートを作り、社内で共有できるようにする',
      deliverables: ['report/index.html（グラフ付きのレポート）', 'report/summary.csv（集計の結果）'],
      steps: ['データを読み込み、列と件数を確かめる', '部署ごとに合計と前月比を出す', 'グラフを描いて HTML にまとめる', '合計が元のデータと一致するか確かめる', '公開の前のチェックをする'],
      doneCriteria: ['すべての部署の合計が元のデータと一致する', 'レポートがブラウザで開ける'],
      externalAccess: [],
      estimate: { minutes: 10, usd: 0.8 },
    },
    generic: {
      summaryForHumans: `ご依頼の内容（${item.title}）に沿って作業し、結果をまとめてお渡しします。`,
      goal: item.title,
      deliverables: ['作業の結果（notes.md）'],
      steps: ['依頼の内容と関係するファイルを確認する', '作業する', '結果を確かめて、まとめる'],
      doneCriteria: ['依頼の内容を満たしている'],
      externalAccess: [],
      estimate: { minutes: 5, usd: 0.3 },
    },
  };
  const p = base[sc];
  const fixes = comments.map((c) => `（ご指摘を反映）${c}`);
  return {
    ...p,
    summaryForHumans: comments.length ? `${p.summaryForHumans} あわせて、ご指摘の点（${comments.at(-1)}）を反映します。` : p.summaryForHumans,
    steps: [...p.steps.slice(0, -1), ...fixes, p.steps.at(-1)!],
    repos: repo ? [repo] : [],
    estimate: { minutes: p.estimate.minutes + comments.length * 2, usd: Math.round((p.estimate.usd + comments.length * 0.1) * 100) / 100 },
  };
}

export function planning(sc: Scenario, item: Task, firstStep: string, version: number, comments: string[]): SimStep[] {
  const files = item.repo ? 'リポジトリ' : 'ワークスペース';
  return [
    ...(version === 1 ? [state('planning', 300), stepChanged(firstStep, 'started', 500), say(`依頼を確認しました。${files}の中身を見てから、計画を立てます。`)] : [state('planning'), say('ご指摘を反映して、計画を見直します。')]),
    ...(version === 1 ? [...tool('list_files', `${files}のファイルを一覧する`, item.repo ? '6 件のファイル' : '添付ファイルを確認'), ...tool('read_file', item.repo ? 'README.md を読む' : '添付ファイルを読む', '読み込みました', true, 600)] : []),
    usage(5200, 900, 25),
    { t: 'emit', delay: 700, event: { type: 'plan.proposed', planVersion: version, plan: planFor(sc, item, comments) } },
    say(version === 1 ? '計画を作りました。内容を確かめて、問題がなければ承認してください。直してほしい点があれば、そのまま書いて送ってください。' : `計画を見直しました（第${version}版）。もう一度確かめてください。`, 300),
    state('awaiting_approval', 100),
    { t: 'gate', delay: 0, gate: 'plan' },
  ];
}

// ---------------------------------------------------------------- ステージごとの作業
const formTs = (fixed: boolean) => `export type ContactInput = { name: string; email: string; body: string };
export type FieldError = { field: keyof ContactInput; message: string };

const EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

export function validate(input: ContactInput): FieldError[] {
  const errors: FieldError[] = [];
  if (!input.name${fixed ? '.trim()' : ''}) errors.push({ field: 'name', message: 'お名前を入力してください' });
  if (!EMAIL.test(input.email${fixed ? '.trim()' : ''})) errors.push({ field: 'email', message: 'メールアドレスの形式が正しくありません' });
  if (!input.body${fixed ? '.trim()' : ''}) errors.push({ field: 'body', message: 'お問い合わせの内容を入力してください' });
  return errors;
}
`;
const formTest = `import { expect, it } from 'vitest';
import { validate } from './contact-form';

const ok = { name: '山田', email: 'yamada@example.com', body: '質問です' };

it('正しい入力ではエラーがない', () => {
  expect(validate(ok)).toEqual([]);
});
it('メールの形式を確かめる', () => {
  expect(validate({ ...ok, email: 'yamada@' }).map((e) => e.field)).toEqual(['email']);
});
it('空白だけの内容は空とみなす', () => {
  expect(validate({ ...ok, body: '   ' }).map((e) => e.field)).toEqual(['body']);
});
`;

const weeklyTsx = `import { weeklyByRegion } from '../lib/sales';
import sales from '../../data/sample.csv';

export function Weekly() {
  const rows = weeklyByRegion(sales);
  return (
    <section>
      <h1>週次の売上（地域別）</h1>
      <BarChart rows={rows} />
    </section>
  );
}
`;
const salesTs = `export type Sale = { date: string; region: string; amount: number };

export function total(sales: Sale[]) {
  return sales.reduce((s, x) => s + x.amount, 0);
}

/** 週（月曜はじまり）と地域ごとに合計する */
export function weeklyByRegion(sales: Sale[]) {
  const map = new Map<string, number>();
  for (const s of sales) {
    const key = \`\${weekOf(s.date)}|\${s.region}\`;
    map.set(key, (map.get(key) ?? 0) + s.amount);
  }
  return [...map].map(([k, amount]) => ({ week: k.split('|')[0]!, region: k.split('|')[1]!, amount }));
}

function weekOf(date: string) {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
`;

const readme = `# platform

社内の共通基盤です。

## 構成

- \`services/\` … API
- \`infra/\` … CDK

## ローカルでの開発

1. Node.js 24 を入れる（\`.nvmrc\` を参照）
2. 依存を入れる: \`./scripts/setup.sh\`
3. テストを実行する: \`npm test\`

詳しい手順とよくあるエラーは [docs/development.md](docs/development.md) を参照してください。
`;
const devMd = `# 開発の手順

## 準備
- Node.js 24、Docker（DynamoDB Local を使うとき）

## よくあるエラー
| エラー | 対処 |
|---|---|
| \`npm ci\` が EACCES で失敗する | npm のキャッシュの権限を直す（\`sudo chown -R $USER ~/.npm\`） |
| テストが DynamoDB につながらない | \`docker compose up -d dynamodb\` を先に実行する |
`;

const normalizePy = (fixed: boolean) => `import csv
import unicodedata

LEGAL = {"(株)": "株式会社", "（株）": "株式会社", "ｶﾌﾞｼｷｶﾞｲｼｬ": "株式会社"${fixed ? ', "カブシキガイシャ": "株式会社"' : ''}}


def normalize(name: str) -> str:
    s = unicodedata.normalize("NFKC", name).strip()
    for k, v in LEGAL.items():
        s = s.replace(unicodedata.normalize("NFKC", k), v)
    return s
`;

export const reportHtml = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>部署別の売上レポート</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;color:#171717}h1{font-size:22px}table{border-collapse:collapse;margin-top:16px}td,th{padding:6px 12px;border-bottom:1px solid #eee;text-align:right}th:first-child,td:first-child{text-align:left}</style></head>
<body><h1>部署別の売上レポート（2026年10月）</h1><p>添付のデータ（1,284 件）を部署ごとに集計しました。</p>
<svg width="520" height="200" role="img" aria-label="部署別の売上の棒グラフ">
<rect x="20" y="40" width="80" height="150" fill="#2f6bff"/><rect x="140" y="80" width="80" height="110" fill="#2f6bff"/><rect x="260" y="100" width="80" height="90" fill="#2f6bff"/><rect x="380" y="130" width="80" height="60" fill="#2f6bff"/>
<text x="60" y="30" text-anchor="middle" font-size="12">営業1部</text><text x="180" y="70" text-anchor="middle" font-size="12">営業2部</text><text x="300" y="90" text-anchor="middle" font-size="12">企画部</text><text x="420" y="120" text-anchor="middle" font-size="12">管理部</text></svg>
<table><tr><th>部署</th><th>売上</th><th>前月比</th></tr><tr><td>営業1部</td><td>¥18,400,000</td><td>+6.2%</td></tr><tr><td>営業2部</td><td>¥13,250,000</td><td>+1.8%</td></tr><tr><td>企画部</td><td>¥10,900,000</td><td>−3.4%</td></tr><tr><td>管理部</td><td>¥7,150,000</td><td>+0.5%</td></tr></table>
</body></html>
`;

/** ステージの作業。最後は { t: 'next' } でラインの次へ進む */
export function stepWork(sc: Scenario, stepId: string, attempt: number, sim: Sim, isFirstRun: boolean): SimStep[] {
  const start = isFirstRun ? [] : [stepChanged(stepId, 'started')];
  if (stepId === 'implement' || stepId === 'workbench') {
    const steps: SimStep[] = [...start];
    if (attempt > 1) {
      steps.push(say('検証で見つかった問題を直します。'));
      if (sc === 'web-form') steps.push(...edit('src/contact-form.ts', formTs(true), 'src/contact-form.ts: 前後の空白を取り除いてから確かめる'));
      if (sc === 'csv-cleanup') steps.push(...edit('scripts/normalize.py', normalizePy(attempt > 2), 'scripts/normalize.py: 法人の種類の表記を足す'));
      steps.push(...tool('run', 'npm test', sc === 'csv-cleanup' ? 'pytest: 4 件が通過' : '4 件のテストが通過'), usage(8000, 2100, 60), stepChanged(stepId, 'completed'), { t: 'next', delay: 200, outcome: 'pass' });
      return steps;
    }
    steps.push(say('承認ありがとうございます。作業を始めます。'));
    switch (sc) {
      case 'web-form':
        steps.push(
          ...tool('read_file', 'src/contact-form.ts を読む', 'いまは名前の必須チェックだけです'),
          ...edit('src/contact-form.ts', formTs(false), 'src/contact-form.ts: メールの形式と必須のチェックを足す'),
          ...edit('src/contact-form.test.ts', formTest, 'src/contact-form.test.ts: テストを3件にする'),
          ...edit('index.html', formHtml, 'index.html: 誤りを欄の下に出す'),
          ...tool('run', 'npm test', '3 件のテストが通過'),
          ...tool('run', 'npm run dev', 'http://localhost:5173 で待ち受けています', true, 1200),
          { t: 'emit', delay: 100, event: { type: 'preview.ready', port: 5173, path: '/' } },
          say('プレビューで動きを確かめられます。続けて、別の VM で検証します。'),
        );
        break;
      case 'dashboard':
        steps.push(
          ...tool('read_file', 'data/sample.csv を読む', '4 行（2 週 × 2 地域）'),
          ...edit('src/lib/sales.ts', salesTs, 'src/lib/sales.ts: 週次・地域別の集計を足す'),
          ...tool('run', 'npm install chart.js', 'cdn.jsdelivr.net への接続が拒否されました', false, 1100),
          { t: 'emit', delay: 100, event: { type: 'egress.blocked', host: 'cdn.jsdelivr.net' } },
          say('Chart.js の取得先（cdn.jsdelivr.net）への通信が、許可リストで止められました。続けるには許可が必要です。'),
          { t: 'emit', delay: 200, event: { type: 'approval.required', approvalId: 'ap_egress_jsdelivr', reason: 'egress', detail: 'cdn.jsdelivr.net への通信（Chart.js の取得）を、この作業の間だけ許可しますか？ 許可しない場合は、SVG で自前のグラフを描きます。' } },
          state('awaiting_approval', 100),
          { t: 'gate', delay: 0, gate: 'approval', approvalId: 'ap_egress_jsdelivr' },
          ...edit('src/pages/weekly.tsx', weeklyTsx, 'src/pages/weekly.tsx: 週次のグラフの画面を作る'),
          ...tool('run', 'npm run dev', 'http://localhost:5173 で待ち受けています', true, 1200),
          { t: 'emit', delay: 100, event: { type: 'preview.ready', port: 5173, path: '/weekly' } },
        );
        break;
      case 'readme':
        steps.push(
          ...tool('read_file', 'scripts/setup.sh を読む', 'npm ci だけを実行しています'),
          ...edit('README.md', readme, 'README.md: ローカルでの開発の手順を書き足す'),
          ...edit('docs/development.md', devMd, 'docs/development.md: 詳しい手順とよくあるエラー'),
          ...tool('run', './scripts/setup.sh && npm test', 'セットアップとテストが通りました', true, 1500),
        );
        break;
      case 'csv-cleanup':
        steps.push(
          ...tool('read_file', 'data/customers.csv を読む', '3 件（全角・半角・略記が混在）'),
          ...edit('scripts/normalize.py', normalizePy(false), 'scripts/normalize.py: NFKC で正規化し、法人の種類をそろえる'),
          ...tool('run', 'pytest', '2 件が通過'),
        );
        break;
      case 'report':
        steps.push(
          ...tool('run', 'python -c "import pandas as pd; ..."', '1,284 行・6 列を読み込みました', true, 1200),
          ...edit('scripts/aggregate.py', 'import pandas as pd\n\ndf = pd.read_csv("attachments/sales.csv")\nsummary = df.groupby("部署")["売上"].sum()\nsummary.to_csv("report/summary.csv")\n', 'scripts/aggregate.py: 部署ごとに集計する'),
          ...edit('report/summary.csv', '部署,売上,前月比\n営業1部,18400000,+6.2%\n営業2部,13250000,+1.8%\n企画部,10900000,-3.4%\n管理部,7150000,+0.5%\n', 'report/summary.csv: 集計の結果'),
          ...edit('report/index.html', reportHtml, 'report/index.html: グラフ付きのレポート'),
          ...tool('run', 'python -m http.server 8000 --directory report', 'http://localhost:8000 で待ち受けています', true, 800),
          { t: 'emit', delay: 100, event: { type: 'preview.ready', port: 8000, path: '/' } },
          say('合計は元のデータ（¥49,700,000）と一致しました。プレビューでレポートを確かめられます。'),
        );
        break;
      default:
        steps.push(...edit('notes.md', `# 作業のまとめ\n\n- 依頼の内容を確認しました\n- 必要な作業を行いました\n`, 'notes.md: 作業のまとめ'));
    }
    steps.push(usage(18000, 4200, 140), stepChanged(stepId, 'completed'), { t: 'next', delay: 200, outcome: 'pass' });
    return steps;
  }

  if (stepId === 'verify') {
    const fail = (sc === 'web-form' && attempt === 1) || (sc === 'csv-cleanup' && !sim.flags['retried']);
    return [
      ...start,
      say(attempt === 1 ? '検証用の VM（web-playwright@2）で、テストとブラウザでの確認をします。' : `もう一度検証します（${attempt} 回目）。`),
      ...tool('run', sc === 'csv-cleanup' ? 'pytest -q' : 'npm test', fail ? (sc === 'web-form' ? '1 件が失敗: 空白だけの内容でも送信できる' : '1 件が失敗: 「カブシキガイシャ」（全角カナ）がそろわない') : '4 件のテストが通過', !fail, 1400),
      ...(sc === 'web-form' || sc === 'dashboard' ? tool('browser', 'ブラウザで画面を確かめる', fail ? '空白だけで送信できました' : '想定どおりに動きました', !fail, 1500) : []),
      usage(9000, 1600, 90),
      ...(fail
        ? [say(sc === 'web-form' ? '空白だけの入力を、空として扱えていませんでした。実装に戻して直します。' : '全角カナの「カブシキガイシャ」がそろっていません。実装に戻して直します。'), stepChanged(stepId, 'failed'), { t: 'next' as const, delay: 200, outcome: 'fail' as const }]
        : [stepChanged(stepId, 'completed'), { t: 'next' as const, delay: 200, outcome: 'pass' as const }]),
    ];
  }

  if (stepId === 'review') {
    return [
      ...start,
      ...tool('review_diff', '差分をレビューする', '指摘 0 件（軽微な提案 1 件）', true, 1300),
      say('レビューでは問題は見つかりませんでした。提案: エラーの文言を定数にまとめると、あとで直しやすくなります。'),
      usage(7000, 900, 40),
      stepChanged(stepId, 'completed'),
      { t: 'next', delay: 200, outcome: 'pass' },
    ];
  }

  if (stepId === 'deliver') {
    return [
      ...start,
      ...tool('git_push', '作業ブランチを push する', 'push しました（Git ゲートウェイ経由）', true, 900),
      ...tool('create_pull_request', 'プルリクエストを作る', 'プルリクエストを作りました', true, 900),
      { t: 'pr', delay: 100 },
      stepChanged(stepId, 'completed'),
      { t: 'next', delay: 200, outcome: 'pass' },
    ];
  }

  if (stepId === 'publish') {
    return [
      ...start,
      ...tool('publish_precheck', '公開の前のチェック（秘密情報・サイズ・外部の参照）', '問題なし（3 ファイル・6 KB）', true, 1000),
      say('公開の準備ができました。成果物の「社内に公開」から、公開する範囲を選んでください。'),
      stepChanged(stepId, 'completed'),
      { t: 'next', delay: 200, outcome: 'pass' },
    ];
  }

  return [...start, stepChanged(stepId, 'completed'), { t: 'next', delay: 200, outcome: 'pass' }];
}

export function finalSummary(sc: Scenario, pr?: number): string {
  const prText = pr ? `プルリクエスト #${pr} を作りました。` : '';
  switch (sc) {
    case 'web-form':
      return `完了しました。${prText}メールの形式・必須の項目・空白だけの入力をチェックし、誤りは欄の下に表示します。テストは4件すべて通っています。`;
    case 'dashboard':
      return `完了しました。${prText}週次・地域別の売上を棒グラフで表示する画面（/weekly）を追加しました。`;
    case 'readme':
      return `完了しました。${prText}README にローカルでの開発の手順を書き足し、詳しい手順を docs/development.md にまとめました。`;
    case 'csv-cleanup':
      return `完了しました。${prText}会社名の全角・半角と法人の種類の表記をそろえました。`;
    case 'report':
      return '完了しました。レポート（report/index.html）と集計の結果（report/summary.csv）を作りました。社内に公開するか、ダウンロードして使ってください。';
    default:
      return `完了しました。${prText}作業の結果を notes.md にまとめました。`;
  }
}

const formHtml = `<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><title>お問い合わせ</title><link rel="stylesheet" href="/src/styles.css" /></head>
  <body>
    <form id="contact" novalidate>
      <label>お名前 <input name="name" /></label>
      <p class="error" data-for="name" aria-live="polite"></p>
      <label>メール <input name="email" type="email" /></label>
      <p class="error" data-for="email" aria-live="polite"></p>
      <label>内容 <textarea name="body"></textarea></label>
      <p class="error" data-for="body" aria-live="polite"></p>
      <button>送信</button>
    </form>
    <script type="module" src="/src/contact-form.ts"></script>
  </body>
</html>
`;

/** プレビューに出す HTML（モックでは、ワークスペースのファイルから組み立てる） */
export function previewHtml(sc: Scenario, files: Record<string, string>, path: string): string {
  const banner = '<div style="position:fixed;right:8px;bottom:8px;font:11px system-ui;color:#737373;background:#f0f0f0;padding:2px 8px;border-radius:99px">モックのプレビュー</div>';
  if (sc === 'report') return (files['report/index.html'] ?? reportHtml).replace('</body>', `${banner}</body>`);
  if (sc === 'web-form') {
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
body{font-family:system-ui,sans-serif;margin:32px;color:#171717}form{display:grid;gap:6px;max-width:420px}label{display:grid;gap:4px;font-size:14px}
input,textarea{font:inherit;padding:8px 10px;border:1px solid #ddd;border-radius:8px}.error{color:#d92d20;font-size:12px;margin:0 0 6px;min-height:1em}
button{justify-self:start;padding:8px 18px;border:0;border-radius:99px;background:#171717;color:#fff;font:inherit}.ok{color:#1f8a4c}</style></head><body>
<h1 style="font-size:20px">お問い合わせ</h1>
<form id="f" novalidate>
<label>お名前 <input name="name"></label><p class="error" data-for="name"></p>
<label>メール <input name="email" type="email"></label><p class="error" data-for="email"></p>
<label>内容 <textarea name="body" rows="4"></textarea></label><p class="error" data-for="body"></p>
<button>送信</button><p id="done" class="ok"></p></form>
<script>
const f=document.getElementById('f');const EMAIL=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
f.addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));const err={};
if(!String(d.name).trim())err.name='お名前を入力してください';if(!EMAIL.test(String(d.email).trim()))err.email='メールアドレスの形式が正しくありません';if(!String(d.body).trim())err.body='お問い合わせの内容を入力してください';
document.querySelectorAll('.error').forEach(p=>p.textContent=err[p.dataset.for]||'');document.getElementById('done').textContent=Object.keys(err).length?'':'送信しました（プレビューなので実際には送られません）';});
</script>${banner}</body></html>`;
  }
  if (sc === 'dashboard') {
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:32px;color:#171717}</style></head><body>
<h1 style="font-size:20px">週次の売上（地域別）</h1><p style="color:#737373">パス: ${path}</p>
<svg width="460" height="220" role="img" aria-label="週次の売上の棒グラフ"><g font-size="12">
<rect x="30" y="60" width="40" height="140" fill="#2f6bff"/><rect x="75" y="86" width="40" height="114" fill="#9db7ff"/>
<rect x="200" y="44" width="40" height="156" fill="#2f6bff"/><rect x="245" y="82" width="40" height="118" fill="#9db7ff"/>
<text x="72" y="216" text-anchor="middle">10/26 の週</text><text x="242" y="216" text-anchor="middle">11/2 の週</text>
<rect x="340" y="40" width="10" height="10" fill="#2f6bff"/><text x="356" y="49">東日本</text><rect x="340" y="58" width="10" height="10" fill="#9db7ff"/><text x="356" y="67">西日本</text></g></svg>
${banner}</body></html>`;
  }
  return `<!doctype html><html lang="ja"><body style="font-family:system-ui;margin:32px"><p>${path} を表示しています</p>${banner}</body></html>`;
}
