// 設定: GitHub との連携（D11: ユーザーごと）、テーマ、モックの操作（モックのときだけ）
import { useEffect, useState } from 'react';
import { Page } from '../../app/AppShell';
import { Button } from '../../components/ui/button';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Card, PageHeader, Tag } from '../../components/kit';
import { useServices } from '../../lib/services';
import { useMe } from '../../stores/me';
import { useUi, type Theme } from '../../stores/ui';
import p from '../pages.module.css';

type MockControl = typeof import('../../mocks/control').mockControl;

export function SettingsPage() {
  const { api, mock } = useServices();
  const me = useMe((m) => m.me)!;
  const setMe = useMe((m) => m.setMe);
  const theme = useUi((u) => u.theme);
  const setTheme = useUi((u) => u.setTheme);
  const toast = useUi((u) => u.toast);
  const [control, setControl] = useState<MockControl | null>(null);
  const [speed, setSpeed] = useState('1');

  useEffect(() => {
    // 定数の条件にしておくと、本番のビルドからモックのコードが消える
    if (import.meta.env.VITE_API_MOCK !== 'true' || !mock) return;
    void import('../../mocks/control').then((m) => {
      setControl(m.mockControl);
      setSpeed(String(m.mockControl.speed()));
    });
  }, [mock]);

  const reloadMe = async () => setMe(await api.me());
  const connect = async () => {
    if (control) {
      // モックでは GitHub の画面への往復を省き、その場で連携したことにする
      control.setGithubConnected(true);
      await reloadMe();
      toast('GitHub と連携しました（モック）', 'ok');
    } else location.assign(api.githubConnectUrl());
  };

  return (
    <Page>
      <PageHeader title="設定" />
      <div className={p.stack} style={{ maxWidth: 760 }}>
        <Card>
          <div className={p.settingRow}>
            <div>
              <h3>GitHub</h3>
              <p>
                {me.github.connected
                  ? `@${me.github.login} として連携しています。リポジトリへの権限は GitHub 側の設定に従います。`
                  : 'リポジトリを使う依頼には、GitHub との連携が必要です（GitHub App の user-to-server 認可）。'}
              </p>
            </div>
            {me.github.connected ? (
              <span className={p.row}>
                <Tag tone="ok">連携済み</Tag>
                {control && (
                  <Button size="sm" variant="ghost" onClick={() => { control.setGithubConnected(false); void reloadMe(); }}>
                    解除
                  </Button>
                )}
              </span>
            ) : (
              <Button size="sm" onClick={() => void connect()}>GitHub と連携する</Button>
            )}
          </div>
          <div className={p.settingRow}>
            <div>
              <h3>テーマ</h3>
              <p>「自動」は OS の設定に合わせます。</p>
            </div>
            <SegmentedControl<Theme>
              size="sm"
              aria-label="テーマ"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'system', label: '自動' },
                { value: 'light', label: 'ライト' },
                { value: 'dark', label: 'ダーク' },
              ]}
            />
          </div>
        </Card>

        {control && (
          <Card>
            <div className={p.settingRow}>
              <div>
                <h3>モックの進む速さ</h3>
                <p>シミュレーターの台本を流す速さです。デモでは 1 倍、確認を急ぐときは 5 倍などにします。</p>
              </div>
              <SegmentedControl
                size="sm"
                aria-label="モックの進む速さ"
                value={speed}
                onChange={(v) => {
                  setSpeed(v);
                  control.setSpeed(Number(v));
                }}
                options={['0.5', '1', '3', '10'].map((v) => ({ value: v, label: `${v} 倍` }))}
              />
            </div>
            <div className={p.settingRow}>
              <div>
                <h3>管理者として使う</h3>
                <p>外すと、管理の画面とメニューが隠れます（一般の利用者の見え方を確かめる）。</p>
              </div>
              <input
                type="checkbox"
                aria-label="管理者として使う"
                checked={me.roles.includes('admin')}
                onChange={(e) => {
                  control.setAdmin(e.target.checked);
                  void reloadMe();
                }}
              />
            </div>
            <div className={p.settingRow}>
              <div>
                <h3>データを作り直す</h3>
                <p>依頼・公開物・イメージを、最初の状態に戻します（ブラウザに保存しているモックのデータを消します）。</p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  control.reset();
                  location.assign(import.meta.env.BASE_URL);
                }}
              >
                作り直す
              </Button>
            </div>
          </Card>
        )}
      </div>
    </Page>
  );
}
