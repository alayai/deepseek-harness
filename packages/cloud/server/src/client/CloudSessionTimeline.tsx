import type { CloudSessionEventKind, CloudSessionTimelineItem } from './session-events.ts'
import { projectCloudSessionEvents, type CloudSessionEvent } from './session-events.ts'
import css from './CloudPanel.module.css'
import { en } from './locales.ts'

export interface CloudSessionTimelineProps {
  readonly label: string
  readonly events: readonly CloudSessionEvent[]
  readonly states?: Record<'running' | 'succeeded' | 'failed' | 'interrupted', string>
  readonly detailsLabel?: string
  readonly labels?: Partial<Record<CloudSessionEventKind, string>>
}

const defaultLabels: Record<CloudSessionEventKind, string> = {
  user: en.userMessage,
  assistant: en.assistantMessage,
  tool: en.toolMessage,
  status: en.statusMessage,
  error: en.errorMessage,
  unknown: en.unknownMessage,
}

function itemClass(item: CloudSessionTimelineItem): string {
  const suffix = `${item.kind.slice(0, 1).toUpperCase()}${item.kind.slice(1)}`
  return `${css.message} ${css[`message${suffix}`] ?? ''}`
}

/** Render cloud events as text-only chat semantics; this never creates links or markup from event data. */
export function CloudSessionTimeline({ label, events, labels, states, detailsLabel }: CloudSessionTimelineProps) {
  const names = { ...defaultLabels, ...labels }
  const statusNames = states ?? {
    running: en.eventRunning,
    succeeded: en.eventSucceeded,
    failed: en.eventFailed,
    interrupted: en.eventInterrupted,
  }
  return <ol aria-label={label} className={css.timeline}>
    {projectCloudSessionEvents(events).map(item => <li key={item.id} className={itemClass(item)} data-event-kind={item.kind}>
      <article>
        <header>
          <span>{names[item.kind]}</span>
          <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString()}</time>
        </header>
        {item.state && <span role="status">{statusNames[item.state]}</span>}
        <p>{item.text}</p>
        {item.detail && <details>
          <summary>{detailsLabel ?? en.eventDetails}</summary>
          <pre className={css.output}>{item.detail}</pre>
        </details>}
      </article>
    </li>)}
  </ol>
}
