// モックの固定データ（リポジトリ、ワークフロー、イメージ、許可リスト、ユーザー）。すべて contracts で検証してから使う
import { AdminUser, ImageSpec, ImageSummary, ImageVersion, Workflow, WorkflowDefinition, Me, NetworkProfile, PackageSource, Repo } from '@factory/contracts';
import { parse } from 'yaml';

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

export const me = Me.parse({
  id: 'u-sato',
  name: '佐藤 美咲',
  email: 'misaki.sato@example.co.jp',
  roles: ['user', 'admin'],
  github: { connected: true, login: 'msato' },
});

export const users = AdminUser.array().parse([
  { id: 'u-sato', name: '佐藤 美咲', email: 'misaki.sato@example.co.jp', roles: ['user', 'admin'], limits: { concurrentTasks: 5, monthlyUsd: 200 }, monthUsd: 0 },
  { id: 'u-tanaka', name: '田中 健', email: 'ken.tanaka@example.co.jp', roles: ['user'], limits: { concurrentTasks: 3, monthlyUsd: 100 }, monthUsd: 12.4 },
  { id: 'u-suzuki', name: '鈴木 花子', email: 'hanako.suzuki@example.co.jp', roles: ['user'], limits: { concurrentTasks: 3, monthlyUsd: 100 }, monthUsd: 3.15 },
]);

export const repos = Repo.array().parse([
  { owner: 'acme', name: 'support-site', defaultBranch: 'main', private: true, protected: true },
  { owner: 'acme', name: 'sales-insights', defaultBranch: 'main', private: true, protected: true },
  { owner: 'acme', name: 'platform', defaultBranch: 'main', private: true, protected: true },
  { owner: 'acme', name: 'crm-scripts', defaultBranch: 'main', private: true, protected: true },
  { owner: 'acme', name: 'handbook', defaultBranch: 'main', private: false, protected: false },
]);

/** リポジトリの中身（作業を始めたときの状態。差分の基準になる） */
export const repoFiles: Record<string, Record<string, string>> = {
  'acme/support-site': {
    'README.md': '# support-site\n\nお客さま向けのサポートサイトです。\n\n```sh\nnpm install\nnpm run dev\n```\n',
    'package.json': '{\n  "name": "support-site",\n  "private": true,\n  "scripts": { "dev": "vite", "test": "vitest run" }\n}\n',
    'index.html': '<!doctype html>\n<html lang="ja">\n  <head><meta charset="utf-8" /><title>お問い合わせ</title></head>\n  <body>\n    <form id="contact">\n      <label>お名前 <input name="name" /></label>\n      <label>メール <input name="email" /></label>\n      <label>内容 <textarea name="body"></textarea></label>\n      <button>送信</button>\n    </form>\n    <script type="module" src="/src/contact-form.ts"></script>\n  </body>\n</html>\n',
    'src/contact-form.ts': "export function validate(input: { name: string; email: string; body: string }) {\n  const errors: string[] = [];\n  if (!input.name) errors.push('name');\n  return errors;\n}\n",
    'src/contact-form.test.ts': "import { expect, it } from 'vitest';\nimport { validate } from './contact-form';\n\nit('名前は必須', () => {\n  expect(validate({ name: '', email: 'a@example.com', body: 'x' })).toContain('name');\n});\n",
    'src/styles.css': 'form { display: grid; gap: 12px; max-width: 480px; }\n',
  },
  'acme/sales-insights': {
    'README.md': '# sales-insights\n\n売上データの分析ツールです。\n',
    'package.json': '{\n  "name": "sales-insights",\n  "private": true,\n  "scripts": { "dev": "vite", "test": "vitest run" }\n}\n',
    'src/pages/index.tsx': "export function Home() {\n  return <h1>Sales insights</h1>;\n}\n",
    'src/lib/sales.ts': "export type Sale = { date: string; region: string; amount: number };\n\nexport function total(sales: Sale[]) {\n  return sales.reduce((s, x) => s + x.amount, 0);\n}\n",
    'data/sample.csv': 'date,region,amount\n2026-10-26,東日本,120000\n2026-10-26,西日本,98000\n2026-11-02,東日本,134000\n2026-11-02,西日本,101000\n',
  },
  'acme/platform': {
    'README.md': '# platform\n\n社内の共通基盤です。\n\n## 構成\n\n- `services/` … API\n- `infra/` … CDK\n',
    'docs/architecture.md': '# アーキテクチャ\n\nAPI Gateway → Lambda → DynamoDB の構成です。\n',
    'package.json': '{\n  "name": "platform",\n  "private": true,\n  "scripts": { "test": "vitest run", "lint": "eslint ." }\n}\n',
    'scripts/setup.sh': '#!/bin/sh\nset -e\nnpm ci\n',
  },
  'acme/crm-scripts': {
    'README.md': '# crm-scripts\n\n顧客データの整形スクリプトです。\n',
    'scripts/normalize.py': 'import csv\n\n\ndef normalize(name: str) -> str:\n    return name.strip()\n',
    'tests/test_normalize.py': 'from scripts.normalize import normalize\n\n\ndef test_strip():\n    assert normalize(" 株式会社A ") == "株式会社A"\n',
    'data/customers.csv': 'id,name\n1,株式会社Ａ\n2,(株)B商事\n3,ｶﾌﾞｼｷｶﾞｲｼｬC\n',
  },
  'acme/handbook': { 'README.md': '# handbook\n\n社内ハンドブックです。\n' },
};

// ---------------------------------------------------------------- ワークフロー（YAML で持ち、Zod で検証する）
export const workflowYaml: Record<string, string> = {
  chat: `name: chat
version: 1
title: チャット
description: 1台の VM で、計画から仕上げまでを会話しながら進める
steps:
  - id: workbench
    type: agent
    image: base@3
    network: default
    gates: [plan-approval]
`,
  'build-verify': `name: build-verify
version: 3
title: 作って確かめる
description: 実装・検証・レビューを別々の VM で行い、プルリクエストで届ける
steps:
  - id: implement
    type: agent
    image: web@5
    network: web
    instructions: skills/implement.md
    gates: [plan-approval]
    next: verify
  - id: verify
    type: agent
    image: web-playwright@2
    network: none
    instructions: skills/verify.md
    on:
      pass: review
      fail: { goto: implement, maxLoops: 2 }
  - id: review
    type: agent
    image: base@3
    network: none
    instructions: skills/review.md
    next: deliver
  - id: deliver
    type: system
    action: create-pull-request
`,
  'report-publish': `name: report-publish
version: 1
title: 集計して公開
description: 添付したデータを集計し、グラフ付きのレポートを社内に公開できる形で届ける
steps:
  - id: workbench
    type: agent
    image: data@2
    network: data
    gates: [plan-approval]
    next: publish
  - id: publish
    type: system
    action: propose-publish
`,
};

export function parseWorkflowYaml(yaml: string): ReturnType<typeof Workflow.parse> {
  return Workflow.parse(parse(yaml));
}

export const workflows = Object.entries(workflowYaml).map(([name, yaml]) =>
  WorkflowDefinition.parse({ name, version: parseWorkflowYaml(yaml).version, yaml, workflow: parseWorkflowYaml(yaml), updatedAt: at(12) }),
);

// ---------------------------------------------------------------- イメージ
const spec = (s: unknown) => ImageSpec.parse(s);
export const imageVersions: Record<string, ImageVersion[]> = {
  base: [3].map((v) => ImageVersion.parse({ name: 'base', version: v, state: 'ready', createdAt: at(30), spec: spec({ name: 'base', description: 'Node.js 24・Python 3.13・git', base: 'base@1', memoryMiB: 2048, packages: { apt: ['git', 'ripgrep'] } }) })),
  web: [5].map((v) => ImageVersion.parse({ name: 'web', version: v, state: 'ready', createdAt: at(20), spec: spec({ name: 'web', description: 'Web アプリの開発（Vite・Chromium）', base: 'base@3', memoryMiB: 4096, packages: { apt: ['chromium'], npm: ['vite@8', 'vitest@5'] }, warmup: ['vite --version'] }) })),
  data: [2].map((v) => ImageVersion.parse({ name: 'data', version: v, state: 'ready', createdAt: at(18), spec: spec({ name: 'data', description: 'データの集計（pandas・matplotlib）', base: 'base@3', memoryMiB: 4096, packages: { pip: ['pandas==2.3', 'matplotlib==3.10', 'openpyxl'] } }) })),
  'web-playwright': [1, 2].map((v) => ImageVersion.parse({ name: 'web-playwright', version: v, state: 'ready', createdAt: at(10 - v * 3), spec: spec({ name: 'web-playwright', description: 'ブラウザでの E2E テスト用', base: 'web@5', memoryMiB: 4096, packages: { npm: [`@playwright/test@1.${63 + v}`] }, run: ['npx playwright install --with-deps chromium'] }) })),
  'pdf-tools': [1].map((v) => ImageVersion.parse({ name: 'pdf-tools', version: v, state: 'ready', createdAt: at(4), spec: spec({ name: 'pdf-tools', description: 'PDF の読み取りと変換', base: 'data@2', memoryMiB: 2048, packages: { apt: ['poppler-utils'], pip: ['pypdf'] } }) })),
};

export const images = ImageSummary.array().parse([
  { name: 'base', description: 'Node.js 24・Python 3.13・git', scope: 'default', latestVersion: 3, memoryMiB: 2048, updatedAt: at(30) },
  { name: 'web', description: 'Web アプリの開発（Vite・Chromium）', scope: 'default', latestVersion: 5, memoryMiB: 4096, updatedAt: at(20) },
  { name: 'data', description: 'データの集計（pandas・matplotlib）', scope: 'default', latestVersion: 2, memoryMiB: 4096, updatedAt: at(18) },
  { name: 'web-playwright', description: 'ブラウザでの E2E テスト用', scope: 'project', owner: '佐藤 美咲', latestVersion: 2, memoryMiB: 4096, updatedAt: at(4) },
  { name: 'pdf-tools', description: 'PDF の読み取りと変換', scope: 'personal', owner: '田中 健', latestVersion: 1, memoryMiB: 2048, orgRequest: 'pending', updatedAt: at(4) },
]);

export const buildLog = (name: string, v: number, ok = true) => [
  `#1 イメージ定義を検証しています（${name}@${v}）`,
  '#2 Dockerfile を合成しています（L1: factory-base → L2: 定義）',
  '#3 ベースのイメージを取得しています',
  '#4 パッケージをインストールしています',
  ...(ok
    ? ['#5 /validate: 自己テストを実行しています', '#6 warmup を実行しています', `#7 完了: ${name}@${v} を登録しました`]
    : ['#5 エラー: パッケージが見つかりませんでした', '#6 失敗: ビルドを中止しました']),
];

// ---------------------------------------------------------------- 管理
export const networkProfiles = NetworkProfile.array().parse([
  { name: 'default', description: 'chat ワークフローの既定（パッケージの取得だけ）', allow: ['registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org'], updatedAt: at(14) },
  { name: 'web', description: 'Web アプリの開発', allow: ['registry.npmjs.org', 'fonts.googleapis.com', 'fonts.gstatic.com'], updatedAt: at(9) },
  { name: 'data', description: 'データの集計', allow: ['pypi.org', 'files.pythonhosted.org'], updatedAt: at(9) },
  { name: 'none', description: '外部への通信なし（検証とレビュー）', allow: [], updatedAt: at(14) },
]);

export const packageSources = PackageSource.array().parse([
  { name: 'public', kind: 'public', npmRegistry: 'https://registry.npmjs.org/', pypiIndex: 'https://pypi.org/simple/', updatedAt: at(14) },
]);
