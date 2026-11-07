// ホーム（ADR-0010）: 新しい依頼の入力欄だけを出す。対応が必要な項目と依頼の一覧はサイドパネルと「すべての依頼」にある
import { Page } from '../../app/AppShell';
import { ErrorBanner } from '../../components/kit';
import { useApi } from '../../lib/services';
import { useResource } from '../../lib/useResource';
import { NewRequest } from './NewRequest';
import s from './home.module.css';

export function HomePage() {
  const api = useApi();
  const lines = useResource(() => api.lines(), []);
  return (
    <Page>
      <div className={s.main}>
        <h1 className={s.greeting}>新しい依頼</h1>
        <NewRequest lines={lines.data} />
        <ErrorBanner error={lines.error} onRetry={() => void lines.reload()} />
      </div>
    </Page>
  );
}
