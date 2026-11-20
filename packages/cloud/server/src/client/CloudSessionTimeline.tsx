import { memo, useMemo } from 'react'
import { IconGlobeOutlineRegular, MarkdownDelegateProvider, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudSessionTimelineItem } from './session-events.ts'
import css from './CloudChat.module.css'
import type {} from './locales.ts'

interface TimelineProps extends PropsLocale<'dsh.cloud'> {
  readonly items: readonly CloudSessionTimelineItem[]
}

/** Cloud replies use native Markdown, with no local file resolver or automatic remote image downloads. */
export const CloudSessionTimeline = memo(function CloudSessionTimeline({ t, items }: TimelineProps) {
  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('chatCopy'), copiedLabel: t('chatCopied') },
    footnotes: t('chatFootnotes'),
  }), [t])
  const states = {
    running: t('eventRunning'), succeeded: t('eventSucceeded'), failed: t('eventFailed'), interrupted: t('eventInterrupted'),
  }
  return <MarkdownDelegateProvider allowRemoteImages={false}>
    <ol aria-label={t('events')} className={css.timeline}>
      {items.map(item => <li key={item.id} className={css[item.kind]} data-event-kind={item.kind}>
        {item.kind === 'tool'
          ? <details className={css.toolCard}>
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
                ? <p className={css.bubble}>{item.text}</p>
                : <div className={css.reply}>
                  <MarkdownText text={item.text} labels={markdownLabels} streaming={item.state === 'running'} />
                  {(item.state === 'failed' || item.state === 'interrupted') && <small>{states[item.state]}</small>}
                </div>}
            </article>}
      </li>)}
    </ol>
  </MarkdownDelegateProvider>
})
