// ホーム（ADR-0010）: 新しい依頼の入力欄だけを出す。対応が必要な項目と依頼の一覧はサイドパネルと「すべての依頼」にある
import { Page } from '../../app/AppShell';
import { ErrorBanner } from '../../components/kit';
import { useApi } from '../../lib/services';
import { useResource } from '../../lib/useResource';
import { NewTask } from './NewTask';
import s from './home.module.css';

export function HomePage() {
  const api = useApi();
  const workflows = useResource(() => api.workflows(), []);
  return (
    <Page>
      <div className={s.main}>
        <h1 className={s.greeting}>新しい依頼</h1>
        <NewTask workflows={workflows.data} />
        <ErrorBanner error={workflows.error} onRetry={() => void workflows.reload()} />
      </div>
    </Page>
  );
}
