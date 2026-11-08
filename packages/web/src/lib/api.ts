// 型付きの API クライアント。レスポンスは必ず contracts の Zod で検証する（実装計画 §5.2）
import {
  AdminUser,
  ApiError,
  AttachmentTicket,
  BuildLog,
  Capacity,
  CreatePublicationRequest,
  CreateTaskRequest,
  Diff,
  Download,
  EventPage,
  FileTree,
  ImageSpec,
  ImageSummary,
  ImageVersion,
  Workflow,
  WorkflowDefinition,
  Me,
  NetworkProfile,
  PackageSource,
  PlanRecord,
  PrecheckResult,
  Preview,
  Publication,
  Repo,
  StepRun,
  UpdateAdminUserRequest,
  UpdatePublicationRequest,
  UpdateTaskRequest,
  VmInfo,
  Task,
  TaskPage,
  type ApprovalDecisionBody,
  type ImageScope,
} from '@factory/contracts';
import { z } from 'zod';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(body.message);
  }
}

export type ApiClientOptions = {
  /** API のオリジン。本番は App の CloudFront、開発は Vite の dev server。テストでは明示的に渡す */
  baseUrl?: string;
  /** Cognito の ID トークンを返す。モックでは固定の文字列 */
  getToken: () => Promise<string> | string;
};

const NoContent = z.unknown();

export function createApiClient({ baseUrl = globalThis.location?.origin ?? 'http://localhost', getToken }: ApiClientOptions) {
  async function raw(path: string, init: RequestInit = {}) {
    const token = await getToken();
    // init.headers は Headers や配列のこともある。オブジェクトに展開すると中身が消えるので、Headers で合わせる
    const headers = new Headers(init.headers);
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const res = await fetch(new URL(`/api/v1${path}`, baseUrl), { ...init, headers });
    if (!res.ok) {
      let body: ApiError = { code: 'UNKNOWN', message: `HTTP ${res.status}` };
      try {
        body = ApiError.parse(await res.json());
      } catch {
        // 本文が契約に合わないときは、状態コードだけで伝える
      }
      throw new ApiRequestError(res.status, body);
    }
    return res;
  }

  async function request<S extends z.ZodType>(schema: S, path: string, init?: RequestInit): Promise<z.infer<S>> {
    const res = await raw(path, init);
    if (res.status === 202 || res.status === 204 || (schema as z.ZodType) === NoContent) return undefined as z.infer<S>;
    return schema.parse(await res.json());
  }

  const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const q = (params: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)).toString();
    return s ? `?${s}` : '';
  };
  const taskPath = (id: string) => `/tasks/${encodeURIComponent(id)}`;

  return {
    me: () => request(Me, '/me'),

    // ---- タスク ----
    listTasks: (p: { state?: string; archived?: boolean; cursor?: string; limit?: number } = {}) =>
      request(
        TaskPage,
        `/tasks${q({ state: p.state, archived: p.archived ? 'true' : undefined, cursor: p.cursor, limit: p.limit?.toString() })}`,
      ),
    createTask: (input: z.input<typeof CreateTaskRequest>) => request(Task, '/tasks', json('POST', CreateTaskRequest.parse(input))),
    getTask: (id: string) => request(Task, taskPath(id)),
    updateTask: (id: string, patch: z.input<typeof UpdateTaskRequest>) =>
      request(Task, taskPath(id), json('PATCH', UpdateTaskRequest.parse(patch))),
    postMessage: (id: string, text: string, attachments: string[] = []) =>
      request(NoContent, `${taskPath(id)}/messages`, json('POST', { text, ...(attachments.length ? { attachments } : {}) })),
    interrupt: (id: string) => request(NoContent, `${taskPath(id)}/interrupt`, json('POST')),
    cancel: (id: string) => request(NoContent, `${taskPath(id)}/cancel`, json('POST')),
    events: (id: string, after?: string) => request(EventPage, `${taskPath(id)}/events${q({ after })}`),

    // ---- 計画と承認 ----
    plans: (id: string) => request(z.array(PlanRecord), `${taskPath(id)}/plans`),
    approvePlan: (id: string, version: number) => request(NoContent, `${taskPath(id)}/plans/${version}/approve`, json('POST')),
    requestChanges: (id: string, version: number, comment: string) =>
      request(NoContent, `${taskPath(id)}/plans/${version}/request-changes`, json('POST', { comment })),
    rejectPlan: (id: string, version: number) => request(NoContent, `${taskPath(id)}/plans/${version}/reject`, json('POST')),
    answerApproval: (id: string, approvalId: string, body: ApprovalDecisionBody) =>
      request(NoContent, `${taskPath(id)}/approvals/${encodeURIComponent(approvalId)}`, json('POST', body)),

    // ---- ステップ・ファイル・成果物 ----
    steps: (id: string) => request(z.array(StepRun), `${taskPath(id)}/steps`),
    retryStep: (id: string, runId: string) => request(NoContent, `${taskPath(id)}/steps/${encodeURIComponent(runId)}/retry`, json('POST')),
    files: (id: string, path = '') => request(FileTree, `${taskPath(id)}/files${q({ path })}`),
    /** presigned URL へのリダイレクトを fetch がたどる */
    fileContent: async (id: string, path: string) => {
      const res = await raw(`${taskPath(id)}/files/content${q({ path })}`);
      return { text: await res.text(), contentType: res.headers.get('content-type') ?? 'text/plain' };
    },
    diff: (id: string) => request(Diff, `${taskPath(id)}/diff`),
    /** 添付: presigned URL を受け取り、そこに PUT する。id を省くと作成前の添付（提案の API） */
    upload: async (file: File, id?: string) => {
      const ticket = await request(
        AttachmentTicket,
        id ? `${taskPath(id)}/attachments` : '/attachments',
        json('POST', { fileName: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
      );
      const put = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      });
      if (!put.ok) throw new ApiRequestError(put.status, { code: 'UPLOAD_FAILED', message: 'アップロードに失敗しました' });
      return ticket.path;
    },
    download: (id: string, body: { paths?: string[]; format: 'file' | 'zip' }) =>
      request(Download, `${taskPath(id)}/downloads`, json('POST', body)),
    preview: (id: string, port: number) => request(Preview, `${taskPath(id)}/previews`, json('POST', { port })),

    // ---- 社内公開 ----
    precheck: (id: string, path: string) => request(PrecheckResult, `${taskPath(id)}/publications/precheck`, json('POST', { path })),
    publish: (input: z.input<typeof CreatePublicationRequest>) =>
      request(Publication, '/publications', json('POST', CreatePublicationRequest.parse(input))),
    publications: () => request(z.array(Publication), '/publications'),
    updatePublication: (pid: string, patch: z.input<typeof UpdatePublicationRequest>) =>
      request(Publication, `/publications/${encodeURIComponent(pid)}`, json('PATCH', UpdatePublicationRequest.parse(patch))),
    stopPublication: (pid: string) => request(NoContent, `/publications/${encodeURIComponent(pid)}`, json('DELETE')),

    // ---- GitHub ----
    /** GitHub App の認可へ移る URL（ページごと遷移する。戻り先は /github/callback） */
    githubConnectUrl: () => new URL('/api/v1/github/connect', baseUrl).toString(),
    repos: () => request(z.array(Repo), '/github/repos'),

    // ---- イメージとワークフロー ----
    images: () => request(z.array(ImageSummary), '/images'),
    buildImage: (spec: z.input<typeof ImageSpec>) => request(ImageVersion, '/images', json('POST', ImageSpec.parse(spec))),
    imageVersions: (name: string) => request(z.array(ImageVersion), `/images/${encodeURIComponent(name)}/versions`),
    buildLog: (name: string, v: number) => request(BuildLog, `/images/${encodeURIComponent(name)}/versions/${v}/build-log`),
    setImageVisibility: (name: string, scope: Exclude<ImageScope, 'default'>) =>
      request(ImageSummary, `/images/${encodeURIComponent(name)}/visibility`, json('POST', { scope })),
    workflows: () => request(z.array(Workflow), '/workflows'),

    // ---- 管理 ----
    admin: {
      networkProfiles: () => request(z.array(NetworkProfile), '/admin/network-profiles'),
      putNetworkProfile: (p: Omit<NetworkProfile, 'updatedAt'>) =>
        request(NetworkProfile, `/admin/network-profiles/${encodeURIComponent(p.name)}`, json('PUT', p)),
      packageSources: () => request(z.array(PackageSource), '/admin/package-sources'),
      putPackageSource: (p: Omit<PackageSource, 'updatedAt'>) =>
        request(PackageSource, `/admin/package-sources/${encodeURIComponent(p.name)}`, json('PUT', p)),
      workflow: (name: string) => request(WorkflowDefinition, `/admin/workflows/${encodeURIComponent(name)}`),
      putWorkflow: (name: string, yaml: string) =>
        request(WorkflowDefinition, `/admin/workflows/${encodeURIComponent(name)}`, json('PUT', { yaml })),
      approveOrgImage: (name: string) => request(ImageSummary, `/admin/images/${encodeURIComponent(name)}/approve-org`, json('POST')),
      vms: () => request(z.array(VmInfo), '/admin/vms'),
      terminateVm: (id: string) => request(NoContent, `/admin/vms/${encodeURIComponent(id)}/terminate`, json('POST')),
      capacity: () => request(Capacity, '/admin/capacity'),
      users: () => request(z.array(AdminUser), '/admin/users'),
      putUser: (id: string, body: z.input<typeof UpdateAdminUserRequest>) =>
        request(AdminUser, `/admin/users/${encodeURIComponent(id)}`, json('PUT', body)),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** 画面に出すエラーの文言 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 401) return 'ログインし直してください。';
    if (e.status === 503) return '混み合っています。少し待ってから、もう一度お試しください。';
    return e.body.message;
  }
  if (e instanceof z.ZodError) return '応答の形が想定と違いました（契約の食い違い）。';
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) return 'サーバーに接続できませんでした。';
  return e instanceof Error ? e.message : String(e);
}
