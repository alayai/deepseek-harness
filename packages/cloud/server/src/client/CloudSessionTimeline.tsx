import { memo, useMemo, useState } from 'react'
import { DisclosureRow, IconCodeOutlineRegular, IconGlobeOutlineRegular, MarkdownDelegateProvider, MarkdownText, UserMessageBubble } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudSessionTimelineItem } from './session-events.ts'
import type { BotIdentity, BotPresentation } from './bot-presentation.ts'
import css from './CloudChat.module.css'
import type {} from './locales.ts'

interface TimelineProps extends PropsLocale<'dsh.cloud'> {
  readonly items: readonly CloudSessionTimelineItem[]
  readonly native?: boolean
  readonly speaker?: BotIdentity | undefined
  readonly presentation?: BotPresentation['renderSlot']
}

/** Cloud replies use native Markdown, with no local file resolver or automatic remote image downloads. */
export const CloudSessionTimeline = memo(function CloudSessionTimeline({ t, items, native = false, speaker, presentation }: TimelineProps) {
  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('chatCopy'), copiedLabel: t('chatCopied') },
    footnotes: t('chatFootnotes'),
  }), [t])
  const states = {
    running: t('eventRunning'), succeeded: t('eventSucceeded'), failed: t('eventFailed'), interrupted: t('eventInterrupted'),
  }
  return <MarkdownDelegateProvider allowRemoteImages={false}>
    <ol aria-label={t('events')} className={css.timeline}>
      {items.map((item) => {
        const fallback = item.kind === 'tool'
          ? native ? <RemoteTool item={item} title={t('toolMessage')} state={item.state ? states[item.state] : ''} empty={t('chatNoToolDetails')} /> : <details className={css.toolCard}>
            <summary>
              <span className={css.toolName}>{t('toolMessage')}{item.text && <> · {item.text}</>}</span>
              {item.state && <span className={css.toolState} data-state={item.state}>{states[item.state]}</span>}
            </summary>
            <pre>{item.detail || t('chatNoToolDetails')}</pre>
          </details>
          : item.kind === 'error'
            ? <div className={css.turnError}>{t('chatTurnError')}</div>
            : <article>
              <header className={css.messageHeader}>
                {item.kind === 'assistant' && <span className={css.assistantIcon}><IconGlobeOutlineRegular size={14} /></span>}
                <span>{t(item.kind === 'user' ? 'userMessage' : 'assistantMessage')}</span>
                {Number.isFinite(Date.parse(item.createdAt)) && <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>}
              </header>
              {item.kind === 'user'
                ? native ? <UserMessageBubble>{item.text}</UserMessageBubble> : <p className={css.bubble}>{item.text}</p>
                : <div className={css.reply}>
                  <MarkdownText text={item.text} labels={markdownLabels} streaming={item.state === 'running'} />
                  {(item.state === 'failed' || item.state === 'interrupted') && <small>{states[item.state]}</small>}
                </div>}
            </article>
        return <li key={item.id} className={css[item.kind]} data-event-kind={item.kind}>
          {presentation?.('dsh.cloud.bot.message', { item, bot: speaker, stateLabel: item.state ? states[item.state] : '',
            errorLabel: t('chatTurnError'), toolLabel: t('toolMessage'), emptyLabel: t('chatNoToolDetails') }, { fallback }) ?? fallback}
        </li>
      })}
    </ol>
  </MarkdownDelegateProvider>
})

function RemoteTool({ item, title, state, empty }: { item: CloudSessionTimelineItem; title: string; state: string; empty: string }) {
  const [open, setOpen] = useState(false)
  return <DisclosureRow className={css.toolCard} icon={<IconCodeOutlineRegular size={16} />}
    title={item.text || title} expandable open={open} running={item.state === 'running'} expandOnRowClick
    onToggle={() => { setOpen(value => !value) }} headerAccessory={<span className={css.toolState} data-state={item.state}>{state}</span>}>
    <pre>{item.detail || empty}</pre>
  </DisclosureRow>
}
