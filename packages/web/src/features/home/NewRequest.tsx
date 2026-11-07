// 新しい依頼の入力欄（FR-UI-01・03・08）。作ったらワークスペースに移る
import type { Line, Repo } from '@factory/contracts';
import { useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Banner, TextInput } from '../../components/kit';
import { IconClip, IconClose, IconRepo, IconSend } from '../../components/icons';
import { errorMessage } from '../../lib/api';
import { useApi } from '../../lib/services';
import { useResource } from '../../lib/useResource';
import s from './home.module.css';

const templates = [
  { label: 'レポートを作る', line: 'report-publish', repo: '', text: '添付した CSV を部署ごとに集計して、グラフ付きのレポートにしてください。部内に公開したいです。' },
  { label: 'Web フォームを直す', line: 'build-verify', repo: 'acme/support-site', text: '問い合わせフォームの入力チェックを直してください。誤りは送信する前に、その場で知らせたいです。' },
  { label: 'README を書き足す', line: 'build-verify', repo: 'acme/platform', text: 'README に、ローカルで開発を始めるための手順（準備、テストの実行、よくあるエラー）を追記してください。' },
];

type Attached = { key: string; name: string; path?: string; error?: string };

export function NewRequest({ lines }: { lines: Line[] | undefined }) {
  const api = useApi();
  const navigate = useNavigate();
  const repos = useResource(() => api.repos(), []);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [repo, setRepo] = useState('');
  const [line, setLine] = useState('chat');
  const [lineTouched, setLineTouched] = useState(false);
  const [files, setFiles] = useState<Attached[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { text: useId(), title: useId(), repo: useId(), line: useId() };

  const selectedRepo: Repo | undefined = repos.data?.find((r) => `${r.owner}/${r.name}` === repo);
  const derivedTitle = (title.trim() || text.trim().split(/\n|。/)[0]?.slice(0, 60) || '').trim();
  const uploading = files.some((f) => !f.path && !f.error);
  const canSubmit = text.trim().length > 0 && derivedTitle.length > 0 && !busy && !uploading;
  const notConnected = !!repos.error && /GitHub/.test(repos.error);

  const chooseRepo = (v: string) => {
    setRepo(v);
    if (!lineTouched) setLine(v ? 'build-verify' : 'chat');
  };

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
      const l = lines?.find((x) => x.name === line);
      const [owner, name] = repo.split('/');
      const attachments = files.flatMap((f) => (f.path ? [f.path] : []));
      const wi = await api.createWorkItem({
        title: derivedTitle,
        message: text.trim(),
        lineRef: `${line}@${l?.version ?? 1}`,
        ...(owner && name ? { repo: { owner, name, baseBranch: selectedRepo?.defaultBranch ?? 'main' } } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      void navigate(`/w/${wi.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <section className={s.newRequest} aria-label="新しい依頼">
      <div className={s.newCard}>
        <label htmlFor={ids.text} className="sr-only">依頼の内容</label>
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
          <input ref={fileInput} type="file" multiple hidden aria-label="添付するファイル" onChange={(e) => void attach(e.target.files).then(() => (e.target.value = ''))} />
          <span className={s.chipSelect}>
            <IconRepo />
            <label htmlFor={ids.repo} className="sr-only">リポジトリ</label>
            <select id={ids.repo} value={repo} onChange={(e) => chooseRepo(e.target.value)} disabled={!repos.data}>
              <option value="">リポジトリを使わない</option>
              {repos.data?.map((r) => (
                <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>{r.owner}/{r.name}</option>
              ))}
            </select>
          </span>
          <span className={s.chipSelect}>
            <label htmlFor={ids.line}>ライン</label>
            <select id={ids.line} value={line} onChange={(e) => { setLine(e.target.value); setLineTouched(true); }}>
              {lines?.map((l) => (
                <option key={l.name} value={l.name}>{l.title ?? l.name}</option>
              ))}
            </select>
          </span>
          <span className={s.spacer} />
          <span className={s.kbdHint}>⌘ / Ctrl + Enter</span>
          <Button size="sm" icon={<IconSend />} onClick={() => void submit()} disabled={!canSubmit} loading={busy}>
            依頼する
          </Button>
        </div>
      </div>
      <div className={s.newMeta}>
        <label htmlFor={ids.title} className={s.titleLabel}>タイトル</label>
        <TextInput id={ids.title} className={s.titleInput} value={title} placeholder={derivedTitle || '本文の最初の文を使います'} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <span className={s.templates} role="group" aria-label="ひな形から始める">
          {templates.map((t) => (
            <button
              key={t.label}
              type="button"
              className={s.template}
              onClick={() => {
                setText(t.text);
                setLine(t.line);
                setLineTouched(true);
                if (!t.repo || repos.data?.some((r) => `${r.owner}/${r.name}` === t.repo)) setRepo(t.repo);
              }}
            >
              {t.label}
            </button>
          ))}
        </span>
      </div>
      {lines && <p className={s.lineDesc}>{lines.find((l) => l.name === line)?.description}</p>}
      {notConnected && (
        <Banner action={<Link to="/settings">連携する</Link>}>GitHub と連携すると、リポジトリを選べるようになります。</Banner>
      )}
      {selectedRepo && !selectedRepo.protected && (
        <Banner tone="warn">
          {repo} の {selectedRepo.defaultBranch} ブランチには保護がありません。変更はプルリクエストで届きますが、レビューを必須にする設定をおすすめします。
        </Banner>
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </section>
  );
}
