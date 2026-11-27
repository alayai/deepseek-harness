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
  botFilter: string
  composeBot: string
  botListVersion: number
  botSetupVersion: number
  botCreateVersion: number
  desktop: string
  section: CloudSection
}

function initial(): CloudViewState {
  return { tenant: '', workspace: '', runtime: '', credential: '', session: '', desktop: '', section: 'overview',
    botFilter: '', composeBot: '', botListVersion: 0, botSetupVersion: 0, botCreateVersion: 0 }
}

const actions = {
  restoreSelection: (state: CloudViewState, tenant: string, workspace: string) => {
    if (!state.tenant && !state.workspace) Object.assign(state, { tenant, workspace })
  },
  reset: (state: CloudViewState) => { Object.assign(state, initial()) },
  tenant: (state: CloudViewState, value: string) => { Object.assign(state, initial(), { tenant: value, section: state.section }) },
  workspace: (state: CloudViewState, value: string) => {
    Object.assign(state, initial(), { tenant: state.tenant, workspace: value, section: state.section })
  },
  resource: (state: CloudViewState, key: 'runtime' | 'credential' | 'session' | 'desktop' | 'composeBot', value: string) => {
    if (key === 'runtime' && value !== state.runtime) state.desktop = ''
    state[key] = value
  },
  filterBot: (state: CloudViewState, id: string, session: string) => { state.botFilter = id; state.session = session },
  openBot: (state: CloudViewState, id: string, session: string) => {
    Object.assign(state, { botFilter: id, composeBot: id, session })
    if (!session) { state.section = 'agent'; state.botSetupVersion++ }
  },
  createdBot: (state: CloudViewState, id: string, session: string, filter: string, compose: string) => {
    state.botListVersion++
    if (state.session === session && state.botFilter === filter && state.composeBot === compose && state.section === 'agent')
      Object.assign(state, { composeBot: id, botFilter: id, session: '' })
  },
  refreshBots: (state: CloudViewState) => { state.botListVersion++ },
  createBot: (state: CloudViewState) => { state.section = 'agent'; state.botCreateVersion++ },
  section: (state: CloudViewState, value: CloudSection) => { state.section = value },
}

/** Client-owned selection source and actions, independent of any slot's scope. */
export type CloudViewStore = EngineStoreInstance<CloudViewState, typeof actions>

/**
 * Create navigation retained in memory for one Client connection. Verified defaults are applied by its owner.
 * @returns the selection source shared by the main page and right-sidebar views.
 */
export function createCloudViewStore(): CloudViewStore {
  return defineStore({ init: initial, actions }).create()
}
