import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudRequest, CloudValue } from '../types.ts'
import css from './CloudPanel.module.css'

const workspacePage = z.object({
  items: z.array(z.object({ id: z.string().min(1), name: z.string(), tenantId: z.string() })).max(100),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).nullable(),
})
type Page = z.infer<typeof workspacePage>

/** One tenant's workspace selector. Its owner remounts it when the cloud identity changes. */
export function CloudWorkspacePicker({ t, tenant, epoch, value, select, call, disabled }: PropsLocale<'dsh.cloud'> & {
  tenant: string
  epoch: number
  value: string
  select(id: string): void
  disabled: boolean
  call(request: CloudRequest): Promise<CloudValue>
}) {
  const [page, setPage] = useState<Page>(), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false)
  const pending = useRef(false), ticket = useRef(0), seen = useRef(new Set<string>())
  useEffect(() => () => { ticket.current++ }, [])
  const read = async (cursor?: string) => {
    if (disabled || !tenant || pending.current) return
    const id = ++ticket.current
    pending.current = true; setLoading(true); setFailed(false)
    try {
      const path = '/tenants/' + tenant + '/workspaces' + (cursor ? '?cursor=' + cursor : '')
      const data = workspacePage.parse(await call({ epoch, path, method: 'GET', body: null, idempotencyKey: null }))
      if (ticket.current !== id) return
      if (data.items.some(row => row.tenantId !== tenant) || (cursor && data.nextCursor && seen.current.has(data.nextCursor))) throw Error('INVALID_WORKSPACE_PAGE')
      const items = new Map((cursor ? page?.items ?? [] : []).map(row => [row.id, row]))
      for (const row of data.items) items.set(row.id, row)
      if (!cursor) seen.current.clear()
      if (data.nextCursor) seen.current.add(data.nextCursor)
      setPage({ items: [...items.values()], nextCursor: data.nextCursor })
    } catch { if (ticket.current === id) setFailed(true) }
    finally { if (ticket.current === id) { pending.current = false; setLoading(false) } }
  }
  return <>
    <Button variant="outline" disabled={disabled || !tenant || loading} onClick={() => { void read() }}>{t('refreshWorkspaces')}</Button>
    <label className={css.field}>{t('workspace')}<select aria-label={t('workspace')} value={value} disabled={disabled || !tenant} onChange={e => select(e.target.value)}>
      <option value="">{t('choose')}</option>
      {value && !page?.items.some(row => row.id === value) && <option value={value}>{value}</option>}
      {page?.items.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>
    {page?.nextCursor && <Button
      variant="outline" disabled={disabled || loading}
      onClick={() => { const cursor = page.nextCursor; if (cursor) void read(cursor) }}>
      {t('moreWorkspaces')}
    </Button>}
    {failed && <p role="alert">{t('workspacePageFailed')}</p>}
  </>
}
