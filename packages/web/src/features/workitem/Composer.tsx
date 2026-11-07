// 会話の入力欄（FR-UI-07: 追加の指示と中断。FR-UI-03: 添付）
import type { WorkItemState } from '@factory/contracts';
import { useId, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { IconButton } from '../../components/kit';
import { IconClip, IconClose, IconSend, IconStop } from '../../components/icons';
import { errorMessage } from '../../lib/api';
import type { Pending } from '../../lib/session';
import { useUi } from '../../stores/ui';
import s from './workspace.module.css';
import h from '../home/home.module.css';

type Attached = { key: string; name: string; path?: string; error?: string };

export function Composer({
  state, pending, onSend, onInterrupt, upload,
}: {
  state: WorkItemState | null;
  pending: Pending | null;
  onSend: (text: string, attachments: string[]) => Promise<void>;
  onInterrupt: () => Promise<void>;
  upload: (f: File) => Promise<string>;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attached[]>([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const toast = useUi((u) => u.toast);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const running = state === 'running' || state === 'planning';
  const uploading = files.some((f) => !f.path && !f.error);

  const placeholder =
    pending?.kind === 'plan' ? '計画への修正を書く…（送ると、修正を依頼します）'
    : pending?.kind === 'approval' ? '質問や補足を書く…（承認への回答は上のカードで）'
    : running ? '指示を追加する…（次の手順から反映します）'
    : state === 'suspended' ? '指示を送ると、続きから再開します…'
    : state === 'completed' ? '続けて依頼する…'
    : 'メッセージを書く…';

  const send = async () => {
    const t = text.trim();
    if (!t || busy || uploading) return;
    setBusy(true);
    try {
      await onSend(t, files.flatMap((f) => (f.path ? [f.path] : [])));
      setText('');
      setFiles([]);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const attach = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) {
      const key = `${f.name}:${Math.random()}`;
      setFiles((cur) => [...cur, { key, name: f.name }]);
      try {
        const path = await upload(f);
        setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, path } : x)));
      } catch (e) {
        setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, error: errorMessage(e) } : x)));
      }
    }
  };

  return (
    <form
      className={s.composer}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {pending?.kind === 'plan' && <div className={s.composerHint} data-tone="alert">計画の承認を待っています。直してほしい点を書いて送ると、エージェントが計画を見直します。</div>}
      <div className={s.composerCard}>
        <label htmlFor={id} className="sr-only">メッセージ</label>
        <textarea
          id={id}
          className={s.composerInput}
          rows={2}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {files.length > 0 && (
          <ul className={h.files} aria-label="添付したファイル">
            {files.map((f) => (
              <li key={f.key} className={h.fileChip} data-error={f.error ? true : undefined}>
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
        <div className={s.composerBar}>
          <IconButton label="ファイルを添付" onClick={() => input.current?.click()}>
            <IconClip />
          </IconButton>
          <input ref={input} type="file" multiple hidden aria-label="添付するファイル" onChange={(e) => void attach(e.target.files).then(() => (e.target.value = ''))} />
          <span className={s.spacer} />
          <span className={s.kbd}>⌘ / Ctrl + Enter</span>
          {running && (
            <Button
              size="sm"
              variant="secondary"
              icon={<IconStop />}
              loading={stopping}
              onClick={() => {
                setStopping(true);
                void onInterrupt()
                  .catch((e: unknown) => toast(errorMessage(e), 'err'))
                  .finally(() => setStopping(false));
              }}
            >
              中断
            </Button>
          )}
          <Button size="sm" type="submit" icon={<IconSend />} disabled={!text.trim() || uploading} loading={busy}>
            {pending?.kind === 'plan' ? '修正を依頼' : '送信'}
          </Button>
        </div>
      </div>
    </form>
  );
}
