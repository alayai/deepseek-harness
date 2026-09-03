// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { PLATFORM_MODULES } from '../src/platform.ts'
import { getStaticModules } from '../src/seed.ts'

const STORE_ID = '@deepseek-ai/dsh-client-store'
const RUNTIME_IDS = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-runtime/client',
] as const

describe('static module table', () => {
  it('seeds every platform word and shares the store identity on the runtime specifiers', () => {
    const table = getStaticModules()
    expect(Object.keys(table)).toEqual([...PLATFORM_MODULES])
    const store = table[STORE_ID]
    expect(store).toEqual(expect.objectContaining({ createSnapshotStore: expect.any(Function) }))
    for (const specifier of RUNTIME_IDS) {
      expect(table[specifier]).toBe(store)
    }
  })
})
