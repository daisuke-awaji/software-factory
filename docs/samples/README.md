# 計画書のコード片の検証用プロジェクト

`docs/03_architecture.md` と `docs/04_implementation_plan.md` に載せたコード片を、そのまま型チェック・テストできるようにしたものです。**本番のコードではありません**（M1 で `packages/*` に移したら削除します）。

```bash
cd docs/samples
npm install
npm run typecheck   # strict（contracts / api / web / engine は exactOptionalPropertyTypes も有効）
npm test            # vitest: 12 件
npm run synth       # CDK の synth（AWS へのデプロイはしない）
```

2026-11-06 の確認結果（Node.js 22.23 / TypeScript 6.0.3）: typecheck 成功、テスト 12/12 成功、synth の検証レポートは空（警告 0 件）。

| ファイル | 内容 |
|---|---|
| `src/contracts/index.ts` | 共有の Zod スキーマ（WorkItem / Line / StageDef / Plan / FactoryEvent） |
| `src/api/app.ts` | Hono + `@hono/zod-openapi` + `hono/aws-lambda` |
| `src/web/apiClient.ts`、`sessionStore.ts`、`mocks.ts` | 型付き fetch、Zustand のストア、MSW 3 のハンドラー（HTTP と WebSocket） |
| `src/engine/handler.ts` | ライン実行エンジン（Durable Functions SDK v3） |
| `src/engine/vmManager.ts` | `RunMicrovm` と `CreateMicrovmAuthToken` |
| `src/infra/stack.ts` | `CfnNetworkConnector`、`CfnMicrovmImage`、`durableConfig` |
