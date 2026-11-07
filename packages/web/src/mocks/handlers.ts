// MSW 3 のハンドラー。開発時はブラウザ（setupWorker）、テストでは Node（setupServer）で同じものを使う（実装計画 §6.3）
// 入力も出力も contracts で検証する。パスは `*/api/v1/...` と書き、どのオリジンでも一致させる（N2）
import {
  AdminUser, ApprovalDecisionBody, AttachmentRequest, CreatePublicationRequest, CreateTaskRequest, DownloadRequest, FileEntry, ImageScope,
  ImageSpec, ImageSummary, ImageVersion, WorkflowDefinition, NetworkProfile, PackageSource, PostMessageRequest, PrecheckResult, Publication,
  RequestChangesBody, UpdateAdminUserRequest, UpdatePublicationRequest, UpdateTaskRequest, VmInfo, Task, WsClientFrame, ulid,
} from '@factory/contracts';
import { http, HttpResponse, delay, ws } from 'msw';
import { parse as parseYaml, stringify } from 'yaml';
import { z } from 'zod';
import { diffFiles } from './diff';
import { getDb, onEvent, save, task } from './db';
import { buildLog } from './fixtures';
import { previewHtml } from './scenarios';
import * as sim from './simulator';
import { zip } from './zip';

const API = '*/api/v1';
const FILES = 'https://files.factory.mock';

type R = Response;
const err = (status: number, code: string, message: string) => HttpResponse.json({ code, message, requestId: ulid() }, { status });
const notFound = () => err(404, 'NOT_FOUND', '見つかりません');
const accepted = () => new HttpResponse(null, { status: 202 });
const latency = () => delay(Math.round(60 + Math.random() * 120));

async function body<S extends z.ZodType>(schema: S, request: Request): Promise<z.infer<S> | R> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err(400, 'VALIDATION_ERROR', '本文が JSON ではありません');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return err(400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.') || '(本文)'}: ${i.message}`).join(' / '));
  return parsed.data;
}
const isResponse = (v: unknown): v is R => v instanceof Response;

/** 状態が合わない操作（Conflict）を 409 にする */
function act(fn: () => void): R {
  try {
    fn();
    return accepted();
  } catch (e) {
    if (e instanceof sim.Conflict) return err(409, 'CONFLICT', e.message);
    throw e;
  }
}

const mine = (id: string | readonly string[] | undefined) => {
  const w = typeof id === 'string' ? task(id) : undefined;
  return w && w.ownerId === getDb().me.id ? w : undefined;
};
const isAdmin = () => getDb().me.roles.includes('admin');

// ---------------------------------------------------------------- 一時的な URL（presigned URL の代わり）
type Ticket = { kind: 'upload'; path: string; fileName: string; contentType: string } | { kind: 'download'; taskId: string; paths: string[]; format: 'file' | 'zip'; fileName: string };
const tickets = new Map<string, Ticket>();
const ticket = (t: Ticket) => {
  const token = ulid().toLowerCase();
  tickets.set(token, t);
  return token;
};
const expires = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();

function contentType(path: string) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.csv')) return 'text/csv; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css';
  return 'text/plain; charset=utf-8';
}

function listDir(files: Record<string, string>, dir: string): FileEntry[] {
  const prefix = dir ? `${dir.replace(/\/$/, '')}/` : '';
  const out = new Map<string, FileEntry>();
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const [head, ...tail] = rest.split('/');
    if (!head) continue;
    if (tail.length) out.set(head, { name: head, path: prefix + head, type: 'dir' });
    else out.set(head, { name: head, path, type: 'file', size: new TextEncoder().encode(content).length });
  }
  return [...out.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
}

function underPath(files: Record<string, string>, path: string) {
  const all = path === '' || path === '.' || path === '/';
  const prefix = path.replace(/^\//, '');
  return Object.entries(files).filter(([p]) => all || p === prefix || p.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
}

function precheck(id: string, path: string) {
  const files = underPath(getDb().files[id] ?? {}, path).filter(([p]) => !p.startsWith('attachments/'));
  const findings: z.infer<typeof PrecheckResult>['findings'] = [];
  let bytes = 0;
  for (const [p, c] of files) {
    const size = new TextEncoder().encode(c).length;
    bytes += size;
    if (/AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*=\s*\S+/i.test(c)) findings.push({ kind: 'secret', severity: 'error', path: p, message: '秘密情報（キーやパスワード）らしき文字列があります' });
    if (size > 5 * 1024 * 1024) findings.push({ kind: 'size', severity: 'error', path: p, message: '1ファイルの上限（5 MB）を超えています' });
    if (/(href|src)="\/(?!\/)/.test(c)) findings.push({ kind: 'absolute-path', severity: 'warning', path: p, message: 'ルートからの絶対パス（/…）は、公開先では別の場所を指します' });
    if (/(href|src)="https?:\/\//.test(c)) findings.push({ kind: 'external-ref', severity: 'warning', path: p, message: '外部のサイトを読み込んでいます（公開先からは届かないことがあります）' });
  }
  if (files.length === 0) findings.push({ kind: 'size', severity: 'error', path: path || '.', message: '公開するファイルがありません' });
  return PrecheckResult.parse({ ok: !findings.some((f) => f.severity === 'error'), files: files.length, bytes, findings });
}

function vms(): VmInfo[] {
  const d = getDb();
  const out: VmInfo[] = [];
  for (const w of d.tasks) {
    if (['completed', 'failed', 'cancelled'].includes(w.state)) continue;
    const run = d.stepRuns[w.id]?.findLast((r) => r.state === 'running');
    if (!run) continue;
    const image = run.image ?? 'base@3';
    const mem = d.images.find((i) => i.name === image.split('@')[0])?.memoryMiB ?? 2048;
    out.push(VmInfo.parse({ id: `vm-${w.id.slice(-8).toLowerCase()}-${run.runId.replace('#', '-')}`, taskId: w.id, stepRunId: run.runId, owner: d.users.find((u) => u.id === w.ownerId)?.name ?? w.ownerId, image, memoryMiB: mem, state: w.state === 'running' || w.state === 'planning' ? 'running' : 'suspended', startedAt: run.startedAt }));
  }
  return out;
}

// ---------------------------------------------------------------- イメージのビルド（タイマーで進める）
function startBuild(name: string, version: number, fail: boolean) {
  const d = getDb();
  const all = buildLog(name, version, !fail);
  const key = `${name}@${version}`;
  d.buildLogs[key] = [];
  let i = 0;
  const step = () => {
    const db = getDb();
    const v = db.imageVersions[name]?.find((x) => x.version === version);
    if (!v) return;
    db.buildLogs[key]!.push(all[i]!);
    i++;
    if (i === 5 && !fail) v.state = 'validating';
    if (i >= all.length) {
      v.state = fail ? 'failed' : 'ready';
      if (fail) v.error = 'パッケージが見つかりませんでした（名前を確かめてください）';
      const summary = db.images.find((s) => s.name === name);
      if (summary && !fail) Object.assign(summary, { latestVersion: version, updatedAt: new Date().toISOString(), memoryMiB: v.spec.memoryMiB, ...(v.spec.description ? { description: v.spec.description } : {}) });
      save();
      return;
    }
    save();
    setTimeout(step, 700 / Math.max(0.1, db.settings.speed));
  };
  setTimeout(step, 400 / Math.max(0.1, d.settings.speed));
}

/** 再読み込みで止まったビルドを最後まで進める */
export function resumeBuilds() {
  const d = getDb();
  for (const versions of Object.values(d.imageVersions))
    for (const v of versions)
      if (v.state === 'building' || v.state === 'validating') {
        const ok = !JSON.stringify(v.spec.packages).match(/nonexistent|typo/);
        v.state = ok ? 'ready' : 'failed';
        d.buildLogs[`${v.name}@${v.version}`] = buildLog(v.name, v.version, ok);
        const summary = d.images.find((s) => s.name === v.name);
        if (summary && ok) summary.latestVersion = v.version;
      }
}

// ---------------------------------------------------------------- WebSocket（API Gateway の WebSocket API を模擬する）
const socket = ws.link('wss://ws.factory.mock/ws');

const wsHandler = socket.addEventListener('connection', ({ client }) => {
  if (!new URL(client.url).searchParams.get('token')) {
    client.close(4401, 'unauthorized');
    return;
  }
  const subs = new Set<string>();
  client.addEventListener('message', (event) => {
    let frame;
    try {
      frame = WsClientFrame.safeParse(JSON.parse(String(event.data)));
    } catch {
      return;
    }
    if (!frame.success) return;
    if (frame.data.action === 'subscribe' && mine(frame.data.taskId)) subs.add(frame.data.taskId);
    else subs.delete(frame.data.taskId);
  });
  const off = onEvent((e) => {
    if (subs.has(e.taskId)) client.send(JSON.stringify(e));
  });
  client.addEventListener('close', off);
});

// ---------------------------------------------------------------- HTTP
export const handlers = [
  // 認証: ヘッダーがなければ 401（API Gateway の JWT authorizer の代わり）
  http.all(`${API}/*`, ({ request }) => {
    if (!request.headers.get('authorization')?.startsWith('Bearer ')) return err(401, 'UNAUTHORIZED', 'ログインしてください');
    return undefined;
  }),
  http.all(`${API}/*`, async () => {
    await latency();
    return undefined;
  }),

  http.get(`${API}/me`, () => HttpResponse.json(getDb().me)),

  // ---- タスク ----
  http.get(`${API}/tasks`, ({ request }) => {
    const u = new URL(request.url);
    const state = u.searchParams.get('state');
    const archived = u.searchParams.get('archived') === 'true';
    const limit = Math.min(100, Number(u.searchParams.get('limit') ?? 20));
    // 更新の新しい順。カーソルは読み終えた件数（本物は不透明な文字列: 05_api_spec.md）
    const from = Math.max(0, Number(u.searchParams.get('cursor') ?? 0) || 0);
    const items = getDb()
      .tasks.filter((w) => w.ownerId === getDb().me.id && (state ? w.state === state : true) && !!w.archived === archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const next = from + limit;
    return HttpResponse.json({ items: items.slice(from, next), ...(items.length > next ? { nextCursor: String(next) } : {}) });
  }),
  http.post(`${API}/tasks`, async ({ request }) => {
    const input = await body(CreateTaskRequest, request);
    if (isResponse(input)) return input;
    const d = getDb();
    const limit = d.users.find((u) => u.id === d.me.id)?.limits.concurrentTasks ?? 3;
    const active = d.tasks.filter((w) => w.ownerId === d.me.id && !['completed', 'failed', 'cancelled'].includes(w.state)).length;
    if (active >= limit) return err(429, 'QUOTA_EXCEEDED', `同時に進められるタスクは ${limit} 件までです。終わったタスクがあれば、それを待ってから出してください。`);
    if (!d.workflows.some((l) => l.name === input.workflowRef.split('@')[0])) return err(400, 'VALIDATION_ERROR', `ワークフロー ${input.workflowRef} はありません`);
    if (input.repo) {
      if (!d.me.github.connected) return err(403, 'GITHUB_NOT_CONNECTED', 'GitHub と連携していません');
      if (!d.repos.some((r) => r.owner === input.repo!.owner && r.name === input.repo!.name)) return err(403, 'FORBIDDEN', 'このリポジトリを使う権限がありません');
    }
    const item = sim.createTask(input, d.me.id, d.me.name);
    return HttpResponse.json(Task.parse(item), { status: 201 });
  }),
  http.get(`${API}/tasks/:id`, ({ params }) => {
    const w = mine(params['id']);
    return w ? HttpResponse.json(w) : notFound();
  }),
  http.patch(`${API}/tasks/:id`, async ({ params, request }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const patch = await body(UpdateTaskRequest, request);
    if (isResponse(patch)) return patch;
    if (patch.title !== undefined) w.title = patch.title;
    if (patch.archived !== undefined) w.archived = patch.archived;
    w.updatedAt = new Date().toISOString();
    save();
    return HttpResponse.json(w);
  }),
  http.post(`${API}/tasks/:id/messages`, async ({ params, request }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const m = await body(PostMessageRequest, request);
    if (isResponse(m)) return m;
    return act(() => sim.postMessage(w.id, m.text, m.attachments ?? [], getDb().me.name));
  }),
  http.post(`${API}/tasks/:id/interrupt`, ({ params }) => {
    const w = mine(params['id']);
    return w ? act(() => sim.interrupt(w.id)) : notFound();
  }),
  http.post(`${API}/tasks/:id/cancel`, ({ params }) => {
    const w = mine(params['id']);
    return w ? act(() => sim.cancel(w.id)) : notFound();
  }),
  http.get(`${API}/tasks/:id/events`, ({ params, request }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const after = new URL(request.url).searchParams.get('after');
    const items = (getDb().events[w.id] ?? []).filter((e) => !after || e.eventId > after);
    return HttpResponse.json({ items });
  }),

  // ---- 計画と承認 ----
  http.get(`${API}/tasks/:id/plans`, ({ params }) => {
    const w = mine(params['id']);
    return w ? HttpResponse.json(getDb().plans[w.id] ?? []) : notFound();
  }),
  http.post(`${API}/tasks/:id/plans/:v/approve`, ({ params }) => {
    const w = mine(params['id']);
    return w ? act(() => sim.approvePlan(w.id, Number(params['v']), getDb().me.name)) : notFound();
  }),
  http.post(`${API}/tasks/:id/plans/:v/request-changes`, async ({ params, request }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const b = await body(RequestChangesBody, request);
    if (isResponse(b)) return b;
    return act(() => sim.requestChanges(w.id, Number(params['v']), b.comment, getDb().me.name));
  }),
  http.post(`${API}/tasks/:id/plans/:v/reject`, ({ params }) => {
    const w = mine(params['id']);
    return w ? act(() => sim.rejectPlan(w.id, Number(params['v']), getDb().me.name)) : notFound();
  }),
  http.post(`${API}/tasks/:id/approvals/:aid`, async ({ params, request }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const b = await body(ApprovalDecisionBody, request);
    if (isResponse(b)) return b;
    return act(() => sim.answerApproval(w.id, String(params['aid']), b.decision, getDb().me.name));
  }),

  // ---- ステップ・ファイル・成果物 ----
  http.get(`${API}/tasks/:id/steps`, ({ params }) => {
    const w = mine(params['id']);
    return w ? HttpResponse.json(getDb().stepRuns[w.id] ?? []) : notFound();
  }),
  http.post(`${API}/tasks/:id/steps/:runId/retry`, ({ params }) => {
    const w = mine(params['id']);
    return w ? act(() => sim.retry(w.id, String(params['runId']))) : notFound();
  }),
  http.get(`${API}/tasks/:id/files`, ({ params, request }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const path = new URL(request.url).searchParams.get('path') ?? '';
    const running = !['completed', 'failed', 'cancelled'].includes(w.state);
    return HttpResponse.json({ path, source: running ? 'vm' : 'snapshot', entries: listDir(getDb().files[w.id] ?? {}, path) });
  }),
  http.get(`${API}/tasks/:id/files/content`, ({ params, request }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const path = new URL(request.url).searchParams.get('path') ?? '';
    if (getDb().files[w.id]?.[path] === undefined) return notFound();
    // 本物は S3 の presigned URL へのリダイレクト
    return new HttpResponse(null, { status: 302, headers: { location: `${FILES}/obj/${w.id}/${encodeURIComponent(path)}` } });
  }),
  http.get(`${FILES}/obj/:id/:path`, ({ params }) => {
    const path = decodeURIComponent(String(params['path']));
    const c = getDb().files[String(params['id'])]?.[path];
    return c === undefined ? new HttpResponse('not found', { status: 404 }) : new HttpResponse(c, { headers: { 'content-type': contentType(path) } });
  }),
  http.get(`${API}/tasks/:id/diff`, ({ params }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const d = getDb();
    return HttpResponse.json({ base: w.repo?.baseBranch ?? 'main', head: w.branch ?? 'workspace', files: diffFiles(d.baseFiles[w.id] ?? {}, d.files[w.id] ?? {}) });
  }),
  ...['/attachments', '/tasks/:id/attachments'].map((p) =>
    http.post(`${API}${p}`, async ({ params, request }) => {
      if (params['id'] && !mine(params['id'])) return notFound();
      const b = await body(AttachmentRequest, request);
      if (isResponse(b)) return b;
      const token = ulid().toLowerCase();
      const path = `uploads/${token}/${b.fileName}`;
      tickets.set(token, { kind: 'upload', path, fileName: b.fileName, contentType: b.contentType });
      return HttpResponse.json({ uploadUrl: `${FILES}/upload/${token}`, path, expiresAt: expires(900) });
    }),
  ),
  http.put(`${FILES}/upload/:token`, async ({ params, request }) => {
    const t = tickets.get(String(params['token']));
    if (!t || t.kind !== 'upload') return new HttpResponse(null, { status: 403 });
    tickets.delete(String(params['token']));
    const text = t.contentType.startsWith('text/') || /\.(csv|txt|md|json|tsv)$/i.test(t.fileName) ? await request.text() : `（${t.fileName}: バイナリのファイル）`;
    getDb().attachments[t.path] = { fileName: t.fileName, contentType: t.contentType, content: text.slice(0, 200_000) };
    save();
    return new HttpResponse(null, { status: 200 });
  }),
  http.post(`${API}/tasks/:id/downloads`, async ({ params, request }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const b = await body(DownloadRequest, request);
    if (isResponse(b)) return b;
    const files = getDb().files[w.id] ?? {};
    const paths = b.paths?.length ? b.paths : Object.keys(files);
    if (paths.some((p) => files[p] === undefined && !Object.keys(files).some((f) => f.startsWith(`${p}/`)))) return notFound();
    const fileName = b.format === 'zip' ? `${w.title.slice(0, 40)}.zip` : (paths[0]!.split('/').at(-1) ?? 'file');
    const token = ticket({ kind: 'download', taskId: w.id, paths, format: b.format, fileName });
    return HttpResponse.json({ url: `${FILES}/dl/${token}`, fileName, expiresAt: expires(300) });
  }),
  http.get(`${FILES}/dl/:token`, ({ params }) => {
    const t = tickets.get(String(params['token']));
    if (!t || t.kind !== 'download') return new HttpResponse(null, { status: 403 });
    const files = getDb().files[t.taskId] ?? {};
    if (t.format === 'file') return new HttpResponse(files[t.paths[0]!] ?? '', { headers: { 'content-type': contentType(t.paths[0]!) } });
    const selected = Object.fromEntries(Object.entries(files).filter(([p]) => t.paths.some((x) => p === x || p.startsWith(`${x}/`))));
    return new HttpResponse(zip(selected), { headers: { 'content-type': 'application/zip' } });
  }),
  http.post(`${API}/tasks/:id/previews`, async ({ params, request }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const b = await body(z.object({ port: z.number().int() }), request);
    if (isResponse(b)) return b;
    const ready = (getDb().events[w.id] ?? []).findLast((e) => e.type === 'preview.ready' && e.port === b.port);
    if (!ready || ready.type !== 'preview.ready') return err(409, 'CONFLICT', `ポート ${b.port} で待ち受けているアプリはありません`);
    if (['failed', 'cancelled'].includes(w.state)) return err(409, 'CONFLICT', 'VM が停止しているため、プレビューは開けません');
    // 本物は `https://<Preview>/__open?t=<一回限りのチケット>`。モックでは HTML を Blob の URL にして返す
    const html = previewHtml(getDb().sim[w.id]?.scenario ?? 'generic', getDb().files[w.id] ?? {}, ready.path);
    const url =
      typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        : `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    return HttpResponse.json({ url, expiresAt: expires(60) });
  }),

  // ---- 社内公開 ----
  http.post(`${API}/tasks/:id/publications/precheck`, async ({ params, request }) => {
    const w = mine(params['id']);
    if (!w) return notFound();
    const b = await body(z.object({ path: z.string() }), request);
    if (isResponse(b)) return b;
    return HttpResponse.json(precheck(w.id, b.path));
  }),
  http.post(`${API}/publications`, async ({ request }) => {
    const b = await body(CreatePublicationRequest, request);
    if (isResponse(b)) return b;
    const w = mine(b.taskId);
    if (!w) return notFound();
    const check = precheck(w.id, b.path);
    if (!check.ok) return err(422, 'PRECHECK_FAILED', check.findings.filter((f) => f.severity === 'error').map((f) => `${f.path}: ${f.message}`).join(' / '));
    if (b.acl.scope === 'restricted' && !b.acl.users?.length && !b.acl.groups?.length) return err(400, 'VALIDATION_ERROR', '限られた人に公開するときは、ユーザーかグループを1つ以上指定してください');
    const id = ulid();
    const nowIso = new Date().toISOString();
    const pub = Publication.parse({ id, taskId: w.id, title: b.title ?? w.title, path: b.path, url: `https://d3k8x2pub0.cloudfront.net/p/${id.toLowerCase()}/`, acl: b.acl, version: 1, status: 'active', createdAt: nowIso, updatedAt: nowIso, ...(b.expiresAt ? { expiresAt: b.expiresAt } : {}) });
    getDb().publications.unshift(pub);
    save();
    return HttpResponse.json(pub, { status: 201 });
  }),
  http.get(`${API}/publications`, () => {
    const d = getDb();
    const ids = new Set(d.tasks.filter((w) => w.ownerId === d.me.id).map((w) => w.id));
    for (const p of d.publications) if (p.status === 'active' && p.expiresAt && Date.parse(p.expiresAt) < Date.now()) p.status = 'expired';
    return HttpResponse.json(d.publications.filter((p) => ids.has(p.taskId)));
  }),
  http.patch(`${API}/publications/:pid`, async ({ params, request }) => {
    const p = getDb().publications.find((x) => x.id === params['pid']);
    if (!p) return notFound();
    const b = await body(UpdatePublicationRequest, request);
    if (isResponse(b)) return b;
    if (b.acl) p.acl = b.acl;
    if (b.expiresAt === null) delete p.expiresAt;
    else if (b.expiresAt) p.expiresAt = b.expiresAt;
    if (b.republish) {
      p.version += 1;
      p.status = 'active';
    }
    p.updatedAt = new Date().toISOString();
    save();
    return HttpResponse.json(p);
  }),
  http.delete(`${API}/publications/:pid`, ({ params }) => {
    const p = getDb().publications.find((x) => x.id === params['pid']);
    if (!p) return notFound();
    p.status = 'stopped';
    p.updatedAt = new Date().toISOString();
    save();
    return new HttpResponse(null, { status: 204 });
  }),

  // ---- GitHub ----
  http.get(`${API}/github/repos`, () => {
    const d = getDb();
    if (!d.me.github.connected) return err(403, 'GITHUB_NOT_CONNECTED', 'GitHub と連携していません。設定から連携してください。');
    return HttpResponse.json(d.repos);
  }),

  // ---- イメージとワークフロー ----
  http.get(`${API}/images`, () => HttpResponse.json(getDb().images)),
  http.post(`${API}/images`, async ({ request }) => {
    const spec = await body(ImageSpec, request);
    if (isResponse(spec)) return spec;
    const d = getDb();
    const existing = d.images.find((i) => i.name === spec.name);
    if (existing && existing.scope === 'default' && !isAdmin()) return err(403, 'FORBIDDEN', '既定のイメージは管理者だけが更新できます');
    const baseName = spec.base.split('@')[0]!;
    const baseV = Number(spec.base.split('@')[1]);
    if (!d.imageVersions[baseName]?.some((v) => v.version === baseV && v.state === 'ready')) return err(400, 'VALIDATION_ERROR', `ベースのイメージ ${spec.base} はありません`);
    const versions = (d.imageVersions[spec.name] ??= []);
    const version = (versions.at(-1)?.version ?? 0) + 1;
    const v = ImageVersion.parse({ name: spec.name, version, state: 'building', spec, createdAt: new Date().toISOString() });
    versions.push(v);
    if (!existing) d.images.push(ImageSummary.parse({ name: spec.name, ...(spec.description ? { description: spec.description } : {}), scope: 'personal', owner: d.me.name, memoryMiB: spec.memoryMiB, updatedAt: v.createdAt }));
    save();
    startBuild(spec.name, version, /nonexistent|typo/.test(JSON.stringify(spec.packages)));
    return HttpResponse.json(v, { status: 201 });
  }),
  http.get(`${API}/images/:name/versions`, ({ params }) => {
    const v = getDb().imageVersions[String(params['name'])];
    return v ? HttpResponse.json(v) : notFound();
  }),
  http.get(`${API}/images/:name/versions/:v/build-log`, ({ params }) => {
    const d = getDb();
    const key = `${params['name']}@${params['v']}`;
    const v = d.imageVersions[String(params['name'])]?.find((x) => x.version === Number(params['v']));
    if (!v) return notFound();
    return HttpResponse.json({ lines: d.buildLogs[key] ?? [], done: v.state === 'ready' || v.state === 'failed' });
  }),
  http.post(`${API}/images/:name/visibility`, async ({ params, request }) => {
    const img = getDb().images.find((i) => i.name === params['name']);
    if (!img) return notFound();
    if (img.scope === 'default') return err(409, 'CONFLICT', '既定のイメージの公開範囲は変えられません');
    const b = await body(z.object({ scope: ImageScope.exclude(['default']) }), request);
    if (isResponse(b)) return b;
    if (b.scope === 'org') img.orgRequest = 'pending';
    else {
      img.scope = b.scope;
      delete img.orgRequest;
    }
    img.updatedAt = new Date().toISOString();
    save();
    return HttpResponse.json(img);
  }),
  http.get(`${API}/workflows`, () => HttpResponse.json(getDb().workflows.map((l) => l.workflow))),

  // ---- 管理（Admin のロールが必須） ----
  http.all(`${API}/admin/*`, () => (isAdmin() ? undefined : err(403, 'FORBIDDEN', '管理者だけが使えます'))),
  http.get(`${API}/admin/network-profiles`, () => HttpResponse.json(getDb().networkProfiles)),
  http.put(`${API}/admin/network-profiles/:name`, async ({ params, request }) => {
    const b = await body(NetworkProfile.omit({ updatedAt: true }), request);
    if (isResponse(b)) return b;
    if (b.name !== params['name']) return err(400, 'VALIDATION_ERROR', 'パスと本文の名前が違います');
    const d = getDb();
    const p = NetworkProfile.parse({ ...b, allow: [...new Set(b.allow)], updatedAt: new Date().toISOString() });
    d.networkProfiles = [...d.networkProfiles.filter((x) => x.name !== p.name), p].sort((a, c) => a.name.localeCompare(c.name));
    save();
    return HttpResponse.json(p);
  }),
  http.get(`${API}/admin/package-sources`, () => HttpResponse.json(getDb().packageSources)),
  http.put(`${API}/admin/package-sources/:name`, async ({ params, request }) => {
    const b = await body(PackageSource.omit({ updatedAt: true }), request);
    if (isResponse(b)) return b;
    if (b.name !== params['name']) return err(400, 'VALIDATION_ERROR', 'パスと本文の名前が違います');
    if (b.kind === 'codeartifact' && (!b.npmRegistry || !b.pypiIndex)) return err(400, 'VALIDATION_ERROR', 'CodeArtifact では npm と PyPI の URL が必要です');
    const d = getDb();
    const p = PackageSource.parse({ ...b, updatedAt: new Date().toISOString() });
    d.packageSources = [...d.packageSources.filter((x) => x.name !== p.name), p];
    save();
    return HttpResponse.json(p);
  }),
  http.get(`${API}/admin/workflows/:name`, ({ params }) => {
    const l = getDb().workflows.find((x) => x.name === params['name']);
    return l ? HttpResponse.json(l) : notFound();
  }),
  http.put(`${API}/admin/workflows/:name`, async ({ params, request }) => {
    const b = await body(z.object({ yaml: z.string().min(1).max(100_000) }), request);
    if (isResponse(b)) return b;
    let raw: unknown;
    try {
      raw = parseYaml(b.yaml);
    } catch (e) {
      return err(400, 'VALIDATION_ERROR', `YAML として読めません: ${e instanceof Error ? e.message.split('\n')[0] : ''}`);
    }
    const d = getDb();
    const cur = d.workflows.find((x) => x.name === params['name']);
    const parsed = WorkflowDefinition.shape.workflow.safeParse({ ...(raw as object), version: (cur?.version ?? 0) + 1 });
    if (!parsed.success) return err(400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' / '));
    if (parsed.data.name !== params['name']) return err(400, 'VALIDATION_ERROR', 'name がパスと違います');
    const ids = new Set(parsed.data.steps.map((s) => s.id));
    const bad = parsed.data.steps.flatMap((s) => [s.next, s.on?.pass, s.on?.fail?.goto].filter((x): x is string => !!x && !ids.has(x)));
    if (bad.length) return err(400, 'VALIDATION_ERROR', `存在しないステップを参照しています: ${bad.join(', ')}`);
    const raws = raw as Record<string, unknown>;
    const def = WorkflowDefinition.parse({ name: parsed.data.name, version: parsed.data.version, yaml: stringify({ ...raws, version: parsed.data.version }), workflow: parsed.data, updatedAt: new Date().toISOString() });
    d.workflows = [...d.workflows.filter((x) => x.name !== def.name), def];
    save();
    return HttpResponse.json(def);
  }),
  http.post(`${API}/admin/images/:name/approve-org`, ({ params }) => {
    const img = getDb().images.find((i) => i.name === params['name']);
    if (!img) return notFound();
    if (img.orgRequest !== 'pending') return err(409, 'CONFLICT', '承認待ちの申請はありません');
    img.scope = 'org';
    delete img.orgRequest;
    img.updatedAt = new Date().toISOString();
    save();
    return HttpResponse.json(img);
  }),
  http.get(`${API}/admin/vms`, () => HttpResponse.json(vms())),
  http.post(`${API}/admin/vms/:vmId/terminate`, ({ params }) => {
    const vm = vms().find((v) => v.id === params['vmId']);
    if (!vm) return notFound();
    getDb().terminatedVms.push(vm.id);
    return act(() => sim.terminateVm(vm.taskId));
  }),
  http.get(`${API}/admin/capacity`, () => {
    const list = vms();
    const running = list.filter((v) => v.state === 'running').length;
    return HttpResponse.json({
      memoryMiB: { used: list.reduce((s, v) => s + v.memoryMiB, 0), limit: 65_536 },
      agents: { used: running, limit: 20 },
      tpm: { used: running * 12_000 + 1_500, limit: 400_000 },
      queueLength: 0,
    });
  }),
  http.get(`${API}/admin/users`, () => HttpResponse.json(getDb().users)),
  http.put(`${API}/admin/users/:uid`, async ({ params, request }) => {
    const d = getDb();
    const u = d.users.find((x) => x.id === params['uid']);
    if (!u) return notFound();
    const b = await body(UpdateAdminUserRequest, request);
    if (isResponse(b)) return b;
    if (b.roles) {
      if (u.id === d.me.id && !b.roles.includes('admin')) return err(409, 'CONFLICT', '自分の管理者の権限は外せません（ほかの管理者に依頼してください）');
      u.roles = b.roles;
    }
    if (b.limits) u.limits = b.limits;
    save();
    return HttpResponse.json(AdminUser.parse(u));
  }),

  // ---- それ以外の /api は 404 ----
  http.all(`${API}/*`, () => err(404, 'NOT_FOUND', 'その API はありません')),
  wsHandler,
];
