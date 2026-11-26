import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudPanelInjected } from './CloudPanel.tsx'
import type {} from './locales.ts'

const task = z.object({
  id: z.uuid(), runtimeId: z.uuid(), kind: z.string(), state: z.string(), createdAt: z.string(),
  errorCode: z.string().nullable(),
})
const page = z.object({ items: z.array(task).max(20), nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).nullable() })

/** One page of server-owned tasks for the selected runtime. Only public status metadata is retained. */
export function CloudTaskHistory({ t, runtime, base, epoch, call }: PropsLocale<'dsh.cloud'> & {
  runtime: string
  base: string
  epoch: number
  call: CloudPanelInjected['call']
}) {
  const [cursor, setCursor] = useState(''), [revision, refresh] = useState(0)
  const [result, setResult] = useState<{ key: string; data?: z.infer<typeof page> }>()
  const key = JSON.stringify([base, epoch, runtime, cursor, revision])
  useEffect(() => {
    let live = true
    const path = base + '/runtimes/' + runtime + '/operations?limit=20' + (cursor ? '&cursor=' + cursor : '')
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => { void call({ epoch, path, method: 'GET', body: null, idempotencyKey: null }).then((value) => {
      const data = page.parse(value)
      if (data.items.some(row => row.runtimeId !== runtime) || (cursor && data.nextCursor === cursor)) throw Error('INVALID_TASK_PAGE')
      if (live) setResult({ key, data })
    }).catch(() => { if (live) setResult({ key }) }).finally(() => {
      if (live && !cursor) timer = setTimeout(load, 5000)
    }) }
    load()
    return () => { live = false; clearTimeout(timer) }
  }, [call, key])
  const current = result?.key === key ? result : undefined
  const next = current?.data?.nextCursor
  return <>
    {!current ? <p role="status">{t('waiting')}</p> : !current.data ? <p role="alert">{t('taskHistoryFailed')}</p>
      : current.data.items.length === 0 ? <p>{t('empty')}</p> : <ul>{current.data.items.map(item =>
        <li key={item.id}><strong>{item.kind} · {item.state}</strong> <time dateTime={item.createdAt}>{item.createdAt}</time>
          <div><code>{item.id}</code>{item.errorCode && <> · {item.errorCode}</>}</div></li>)}</ul>}
    <Button variant="outline" onClick={() => { setCursor(''); refresh(n => n + 1) }}>{t('taskLatest')}</Button>
    {next && <Button variant="outline" onClick={() => setCursor(next)}>{t('nextPage')}</Button>}
  </>
}
