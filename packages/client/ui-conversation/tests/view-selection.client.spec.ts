import { describe, expect, it } from 'vitest'
import { clampSideRatio, resolveActiveView, resolveSideView } from '../src/client/view-selection.ts'
import type { ViewTab } from '../src/client/contract/views.ts'

describe('resolveActiveView', () => {
  it('resolves the preferred registered View and Chat fallback', () => {
    const tabs: readonly ViewTab[] = [
      { id: 'chat', label: 'Chat' },
      { id: 'custom', label: 'Custom' },
    ]

    expect(resolveActiveView(tabs, 'custom')?.id).toBe('custom')
    expect(resolveActiveView(tabs, 'removed')?.id).toBe('chat')
    expect(resolveActiveView(tabs, null)?.id).toBe('chat')
    expect(resolveSideView(tabs, 'custom', 'chat')?.id).toBe('custom')
    expect(resolveSideView(tabs, 'chat', 'chat')).toBeUndefined()
    expect(resolveSideView(tabs, 'removed', 'chat')).toBeUndefined()
    expect(resolveSideView(tabs, null, 'chat')).toBeUndefined()
    expect(clampSideRatio(0.9)).toBe(0.75)
    expect(clampSideRatio(0.1)).toBe(0.25)
    expect(clampSideRatio(undefined)).toBe(0.5)
    expect(clampSideRatio(Number.NaN)).toBe(0.5)
  })

  it('does not choose an arbitrary registered View', () => {
    expect(resolveActiveView([{ id: 'custom', label: 'Custom' }], null)).toBeUndefined()
  })
})
