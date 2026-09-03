// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  createConversationStore, readConversationLayoutPreference, readConversationViewPreference,
} from '../src/client/stores.ts'

const KEY = 'dsh.conversation'
const EMPTY = {
  draft: '',
  view: null,
  sideView: null,
  sideRatio: 0.5,
  viewRequest: null,
}

beforeEach(() => {
  localStorage.clear()
})

describe('createConversationStore', () => {
  it('owns draft, selected View, side pane, and one-shot View requests', () => {
    const store = createConversationStore().create()
    expect(store.store.getSnapshot()).toEqual(EMPTY)

    store.actions.setDraft('hello')
    store.actions.setView('chat')
    expect(store.store.getSnapshot()).toEqual({
      ...EMPTY,
      draft: 'hello',
      view: 'chat',
    })

    store.actions.setSideView('trajectory')
    expect(store.store.getSnapshot()).toMatchObject({
      view: 'chat',
      sideView: 'trajectory',
    })

    store.actions.setSideView('chat')
    expect(store.store.getSnapshot()).toMatchObject({
      view: null,
      sideView: 'chat',
    })

    store.actions.setView('chat')
    expect(store.store.getSnapshot().view).toBeNull()

    store.actions.clearSideView()
    store.actions.setView('chat')
    expect(store.store.getSnapshot().view).toBe('chat')

    store.actions.setSideView('trajectory')
    store.actions.openView('trajectory', 'call-1')
    expect(store.store.getSnapshot()).toMatchObject({
      view: 'chat',
      sideView: 'trajectory',
      viewRequest: { view: 'trajectory', focus: 'call-1' },
    })
    store.actions.completeViewRequest()
    expect(store.store.getSnapshot().viewRequest).toBeNull()

    store.actions.setSideRatio(0.9)
    expect(store.store.getSnapshot().sideRatio).toBe(0.75)
    store.actions.setSideRatio(Number.NaN)
    expect(store.store.getSnapshot().sideRatio).toBe(0.5)
  })

  it('persists per Session scope and clears the persisted value', () => {
    const first = createConversationStore().create('sess-1')
    first.actions.setDraft('draft for one')
    first.actions.setView('chat')
    first.actions.setSideView('trajectory')
    expect(localStorage.getItem(`${KEY}.sess-1`)).not.toBeNull()
    expect(localStorage.getItem(`${KEY}.sess-2`)).toBeNull()

    const restored = createConversationStore().create('sess-1')
    expect(restored.store.getSnapshot()).toMatchObject({
      draft: 'draft for one',
      view: 'chat',
      sideView: 'trajectory',
    })

    first.clearPersisted()
    expect(localStorage.getItem(`${KEY}.sess-1`)).toBeNull()
  })

  it('creates independent live instances', () => {
    const handle = createConversationStore()
    const first = handle.create()
    const second = handle.create()
    first.actions.setDraft('only first')
    expect(second.store.getSnapshot().draft).toBe('')
  })

  it('fills side-pane fields omitted from a pre-split persisted record', () => {
    localStorage.setItem(`${KEY}.sess-legacy`, JSON.stringify({
      draft: 'kept',
      view: 'chat',
      viewRequest: null,
    }))
    const restored = createConversationStore().create('sess-legacy')
    expect(restored.store.getSnapshot()).toEqual({
      draft: 'kept',
      view: 'chat',
      sideView: null,
      sideRatio: 0.5,
      viewRequest: null,
    })
  })

  it('reads only a usable persisted View layout', () => {
    const sessionId = 'sess-1' as SessionId
    const store = createConversationStore().create(sessionId)
    store.actions.setView('trajectory')
    store.actions.setSideView('custom')
    expect(readConversationViewPreference(sessionId)).toBe('trajectory')
    expect(readConversationLayoutPreference(sessionId)).toEqual({
      view: 'trajectory',
      sideView: 'custom',
    })

    localStorage.setItem(`${KEY}.${sessionId}`, '{invalid')
    expect(readConversationViewPreference(sessionId)).toBeNull()
    expect(readConversationLayoutPreference(sessionId)).toEqual({ view: null, sideView: null })
  })
})
