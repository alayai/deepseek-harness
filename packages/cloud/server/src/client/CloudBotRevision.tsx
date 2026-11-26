import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudValue } from '../types.ts'
import type {} from './locales.ts'
import css from './CloudChat.module.css'

const revisionNumber = z.number().int().positive()
const metadata = z.object({ id: z.uuid(), latestRevision: revisionNumber })
const publication = z.object({ botId: z.uuid(), revision: revisionNumber, definition: z.object({
  schemaVersion: z.literal(1), name: z.string().max(100), role: z.string().max(120),
  instructions: z.string().max(16000), requiredCapabilities: z.array(z.string().max(80)).max(24),
}) })
type Edition = 'pinned' | 'latest'
type View = { edition: Edition } & ({ state: 'loading' } | { state: 'error' } | { state: 'ready'; value: z.infer<typeof publication> })

/** Inspect immutable publications without changing the conversation binding or sending a prompt. */
export function CloudBotRevision({ t, base, bot, current, request }: PropsLocale<'dsh.cloud'> & {
  base: string
  bot: { id: string; revision: number }
  current: () => boolean
  request: (path: string) => Promise<CloudValue>
}) {
  const [view, setView] = useState<View>()
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const close = () => { generation.current++; setView(undefined) }
  const read = async (edition: Edition) => {
    if (!current()) return
    const id = ++generation.current, valid = () => generation.current === id && current()
    setView({ edition, state: 'loading' })
    try {
      const path = base + '/bots/' + bot.id
      let revision = bot.revision
      if (edition === 'latest') {
        const meta = metadata.parse(await request(path))
        if (!valid()) return
        if (meta.id !== bot.id || meta.latestRevision < bot.revision) throw Error('BOT_METADATA_MISMATCH')
        revision = meta.latestRevision
      }
      const value = publication.parse(await request(path + '/revisions/' + revision))
      if (value.botId !== bot.id || value.revision !== revision) throw Error('BOT_REVISION_MISMATCH')
      if (valid()) setView({ edition, state: 'ready', value })
    } catch { if (valid()) setView({ edition, state: 'error' }) }
  }
  return <div className={css.botInspection}>
    <Button type="button" size="sm" variant="ghost" aria-expanded={view !== undefined}
      title={t('botInspect')} onClick={() => { if (view) close(); else void read('pinned') }}>{t('chatBot')} · v{bot.revision}</Button>
    {view && <section className={css.botPublication} aria-label={t('botInspect')}>
      <div>
        {(['pinned', 'latest'] as const).map(edition => <Button key={edition} type="button" size="sm" variant="outline"
          aria-pressed={view.edition === edition} onClick={() => { void read(edition) }}>{t(edition === 'pinned' ? 'botPinned' : 'botLatest')}</Button>)}
      </div>
      {view.state === 'loading' ? <p role="status">{t('botLoading')}</p>
        : view.state === 'error' ? <p role="alert">{t('botReadFailed')} <Button type="button" size="sm"
          onClick={() => { void read(view.edition) }}>{t('retry')}</Button></p>
          : <>
            <strong>{view.value.definition.name} · v{view.value.revision}</strong>
            {view.edition === 'latest' && view.value.revision !== bot.revision && <p>{t('botStillPinned')} v{bot.revision}</p>}
            <dl>
              {view.value.definition.role && <><dt>{t('chatBotRole')}</dt><dd>{view.value.definition.role}</dd></>}
              <dt>{t('chatBotInstructions')}</dt><dd>{view.value.definition.instructions || t('botNoInstructions')}</dd>
              {view.value.definition.requiredCapabilities.length > 0 && <><dt>{t('botCapabilities')}</dt><dd>{view.value.definition.requiredCapabilities.join(', ')}</dd></>}
            </dl>
          </>}
    </section>}
  </div>
}
