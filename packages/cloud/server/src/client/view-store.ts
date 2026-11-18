/** Connection-scoped navigation survives closing a cloud tab without storing credentials. */
import { defineStore, type EngineStoreInstance } from '@deepseek-ai/dsh-client-store'

/** Resource group displayed in the cloud view. */
export type CloudSection = 'overview' | 'agent' | 'files' | 'desktop' | 'tasks' | 'settings'

interface CloudViewState {
  tenant: string
  workspace: string
  runtime: string
  credential: string
  session: string
  desktop: string
  section: CloudSection
}

function initial(): CloudViewState {
  return { tenant: '', workspace: '', runtime: '', credential: '', session: '', desktop: '', section: 'overview' }
}

const actions = {
  reset: (state: CloudViewState) => { Object.assign(state, initial()) },
  tenant: (state: CloudViewState, value: string) => { Object.assign(state, initial(), { tenant: value, section: state.section }) },
  workspace: (state: CloudViewState, value: string) => {
    Object.assign(state, initial(), { tenant: state.tenant, workspace: value, section: state.section })
  },
  resource: (state: CloudViewState, key: 'runtime' | 'credential' | 'session' | 'desktop', value: string) => { state[key] = value },
  section: (state: CloudViewState, value: CloudSection) => { state.section = value },
}

/** Client-owned selection source and actions, independent of any slot's scope. */
export type CloudViewStore = EngineStoreInstance<CloudViewState, typeof actions>

/**
 * Create navigation retained in memory for one Client connection. No browser persistence is used.
 * @returns the selection source shared by the main page and right-sidebar views.
 */
export function createCloudViewStore(): CloudViewStore {
  return defineStore({ init: initial, actions }).create()
}
