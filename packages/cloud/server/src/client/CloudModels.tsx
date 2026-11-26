import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CloudPanelInjected } from './CloudPanel.tsx'
import type {} from './locales.ts'
import css from './CloudPanel.module.css'

import { useWorkspaceModels } from './workspace-models.ts'
type Injected = { hooks: Pick<CloudPanelInjected['hooks'], 'cloud' | 'view'>; call: CloudPanelInjected['call']; manage(): void }

/** Show only the models configured for the workspace selected in Cloud resources. */
export function CloudModels({ t, close, useCloud, useView, call, manage }: PropsRuntime<'settings.section'> & PropsLocale<'dsh.cloud'> & InjectFace<Injected>) {
  const { mode, epoch, serverUrl } = useCloud(value => value)
  const { tenant, workspace } = useView(value => value)
  const open = () => { close(); manage() }
  if (mode !== 'cloud') return <p role="status">{t(mode === 'local' ? 'checkingMode' : mode)}</p>
  return <section className={css.section}>
    <h3>{t('workspaceModels')}</h3>
    {tenant && workspace
      ? <ModelList key={JSON.stringify([serverUrl, epoch, tenant, workspace])} t={t} epoch={epoch}
        path={`/tenants/${tenant}/workspaces/${workspace}/model-credentials`} call={call} />
      : <p>{t('chooseWorkspace')}</p>}
    <Button variant="outline" onClick={open}>{t(tenant && workspace ? 'manageModels' : 'chatResources')}</Button>
  </section>
}

function ModelList({ t, epoch, path, call }: PropsLocale<'dsh.cloud'> & { epoch: number; path: string; call: CloudPanelInjected['call'] }) {
  const { page, status, more, refresh } = useWorkspaceModels(call, epoch, path, path, true)
  return <>
    {status === 'loading' && <p role="status">{t('waiting')}</p>}
    {status === 'error' && <p role="alert">{t(page ? 'modelPageFailed' : 'modelsReadFailed')}</p>}
    {page && (page.items.length ? <ul>{page.items.map(row => <li key={row.id}><strong>{row.model}</strong> · {row.endpoint}</li>)}</ul>
      : <p>{t('noWorkspaceModels')}</p>)}
    {page?.nextCursor && <Button variant="outline" disabled={status === 'loadingMore'} onClick={() => { void more() }}>{t('moreModels')}</Button>}
    {page?.truncated && <p>{t('legacyModels')}</p>}
    <Button variant="outline" disabled={status === 'loading' || status === 'loadingMore'} onClick={refresh}>{t('retry')}</Button>
  </>
}
