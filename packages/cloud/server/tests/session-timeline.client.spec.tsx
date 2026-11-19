import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CloudSessionTimeline } from '../src/client/CloudSessionTimeline.tsx'
import type { CloudSessionEvent } from '../src/client/session-events.ts'

describe('cloud chat display replay', () => {
  it('renders recorded cloud message and tool events as escaped, paired cards', () => {
    const events: CloudSessionEvent[] = [
      { id: '1', operationId: 'op1', createdAt: '2026-11-19T00:00:00Z', event: { type: 'user/message', data: { content: [{ type: 'text', text: 'read the report' }] } } },
      { id: '2', operationId: 'op1', createdAt: '2026-11-19T00:00:01Z', event: { type: 'tool/call', data: { name: 'read', callId: 'c1', arguments: '{}' } } },
      { id: '3', operationId: 'op1', createdAt: '2026-11-19T00:00:02Z', event: { type: 'tool/result', data: { message: { callId: 'c1', content: [{ type: 'text', text: 'ok' }] } } } },
      { id: '4', operationId: 'op1', createdAt: '2026-11-19T00:00:03Z', event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '<script>alert(1)</script>' }] } } } },
    ]
    const html = renderToStaticMarkup(<CloudSessionTimeline label="Cloud" events={events} detailsLabel="Details" />)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html.match(/data-event-kind="tool"/g)).toHaveLength(1)
    expect(html).not.toContain('<script>')
    expect(html.replace(/<time[^>]*>.*?<\/time>/g, '<time/>')).toMatchSnapshot()
  })
})
