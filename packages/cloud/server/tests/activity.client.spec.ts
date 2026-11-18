import { describe, expect, it } from 'vitest'
import { createCloudActivities } from '../src/client/activity.ts'
import { createCloudViewStore } from '../src/client/view-store.ts'

describe('cloud resource navigation lifetime', () => {
  it('resets dependent resource selections when changing workspace or authority', () => {
    const main = createCloudViewStore()
    main.actions.tenant('team'); main.actions.workspace('first'); main.actions.resource('runtime', 'sandbox')
    main.actions.section('files')
    main.actions.workspace('second')
    expect(main.getSnapshot()).toMatchObject({ tenant: 'team', workspace: 'second', runtime: '', section: 'files' })
    main.actions.reset()
    expect(main.getSnapshot()).toMatchObject({ tenant: '', workspace: '', section: 'overview' })
  })

  it('retains only current acceptance per workspace and rejects late acceptance after clearing authority', () => {
    const owner = createCloudActivities()
    owner.remember({ scope: 'a', path: '/commands', key: 'first' })
    owner.remember({ scope: 'b', path: '/files', key: 'other-workspace' })
    owner.remember({ scope: 'a', path: '/commands', key: 'second' })
    owner.accepted('a', 'first', { path: '/operations', id: 'superseded' })
    expect(owner.source.getSnapshot().a?.operation).toBeUndefined()
    owner.accepted('a', 'second', { path: '/operations', id: 'accepted' })
    expect(owner.source.getSnapshot().a?.operation?.id).toBe('accepted')
    expect(owner.source.getSnapshot().b?.key).toBe('other-workspace')
    owner.clear()
    owner.accepted('a', 'second', { path: '/operations', id: 'late' })
    expect(owner.source.getSnapshot()).toEqual({})
  })
})
