// 新しいタスクの入力欄（FR-UI-01・03）。本文・添付・リポジトリだけを受け取る。タイトルはサーバーが本文から作り、ワークスペースの「名前を変更」で直せる
import type { Workflow } from '@factory/contracts';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Banner } from '../../components/kit';
import { Skeleton } from '../../components/skeletons';
import { IconClip, IconClose, IconRepo, IconSend } from '../../components/icons';
import { errorMessage } from '../../lib/api';
import { useApi } from '../../lib/services';
import { useResource } from '../../lib/useResource';
import s from './home.module.css';

type Attached = { key: string; name: string; path?: string; error?: string };

export function NewTask({ workflows }: { workflows: Workflow[] | undefined }) {
  const api = useApi();
  const navigate = useNavigate();
  const repos = useResource(() => api.repos(), []);
  const [text, setText] = useState('');
  const [repo, setRepo] = useState('');
  const [files, setFiles] = useState<Attached[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { text: useId(), repo: useId() };

  const selectedRepo = repos.data?.find((r) => `${r.owner}/${r.name}` === repo);
  /** ワークフローは選ばせない: リポジトリを使うなら「作って確かめる」、使わないなら会話 */
  const workflow = repo ? 'build-verify' : 'chat';
  const uploading = files.some((f) => !f.path && !f.error);
  const canSubmit = text.trim().length > 0 && !busy && !uploading;

  const attach = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) {
      const key = `${f.name}:${Math.random()}`;
      setFiles((cur) => [...cur, { key, name: f.name }]);
      try {
        const path = await api.upload(f);
        setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, path } : x)));
      } catch (e) {
        setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, error: errorMessage(e) } : x)));
      }
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const l = workflows?.find((x) => x.name === workflow);
      const [owner, name] = repo.split('/');
      const attachments = files.flatMap((f) => (f.path ? [f.path] : []));
      const created = await api.createTask({
        message: text.trim(),
        workflowRef: `${workflow}@${l?.version ?? 1}`,
        ...(owner && name ? { repo: { owner, name, baseBranch: selectedRepo?.defaultBranch ?? 'main' } } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      void navigate(`/t/${created.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <section className={s.newTask} aria-label="新しいタスク">
      <div className={s.newCard}>
        <label htmlFor={ids.text} className="sr-only">
          タスクの内容
        </label>
        <textarea
          id={ids.text}
          className={s.newInput}
          rows={3}
          value={text}
          placeholder="何を作りたいですか？ やりたいことを、ふだんの言葉で書いてください"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {files.length > 0 && (
          <ul className={s.files} aria-label="添付したファイル">
            {files.map((f) => (
              <li key={f.key} className={s.fileChip} data-error={f.error ? true : undefined}>
                <IconClip /> {f.name}
                {!f.path && !f.error && <span className="muted">（アップロード中）</span>}
                {f.error && <span>（{f.error}）</span>}
                <button type="button" aria-label={`${f.name} を外す`} onClick={() => setFiles((cur) => cur.filter((x) => x.key !== f.key))}>
                  <IconClose />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={s.newBar}>
          <button type="button" className={s.chip} onClick={() => fileInput.current?.click()}>
            <IconClip /> 添付
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="添付するファイル"
            onChange={(e) => void attach(e.target.files).then(() => (e.target.value = ''))}
          />
          {!repos.data && !repos.error && (
            <span className={s.chipSelect} aria-hidden="true">
              <IconRepo />
              <Skeleton width={140} height={10} />
            </span>
          )}
          {repos.data && (
            <span className={s.chipSelect}>
              <IconRepo />
              <label htmlFor={ids.repo} className="sr-only">
                リポジトリ
              </label>
              <select id={ids.repo} value={repo} onChange={(e) => setRepo(e.target.value)}>
                <option value="">リポジトリを使わない</option>
                {repos.data.map((r) => (
                  <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
                    {r.owner}/{r.name}
                  </option>
                ))}
              </select>
            </span>
          )}
          <span className={s.spacer} />
          <Button size="sm" icon={<IconSend />} onClick={() => void submit()} disabled={!canSubmit} loading={busy}>
            開始する
          </Button>
        </div>
      </div>
      {selectedRepo && !selectedRepo.protected && (
        <Banner tone="warn">
          {repo} の {selectedRepo.defaultBranch}{' '}
          ブランチには保護がありません。変更はプルリクエストで届きますが、レビューを必須にする設定をおすすめします。
        </Banner>
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </section>
  );
}
