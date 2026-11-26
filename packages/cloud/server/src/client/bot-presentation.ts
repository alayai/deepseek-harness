import type { ReactNode } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudSessionTimelineItem } from './session-events.ts'

export interface BotIdentity { id: string; name: string }
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'dsh.cloud.bot.header': {
      kind: 'single'
      scope: 'root'
      owner: {
        bot: BotIdentity | undefined
        title: string
        controls: ReactNode
        resourcesLabel: string
        openResources(): void
      }
    }
    'dsh.cloud.bot.message': {
      kind: 'single'
      scope: 'root'
      owner: {
        item: CloudSessionTimelineItem
        bot: BotIdentity | undefined
        stateLabel: string
        errorLabel: string
        toolLabel: string
        emptyLabel: string
      }
    }
  }
}
export type BotPresentation = Partial<PropsRenderSlots<'dsh.cloud.bot.header' | 'dsh.cloud.bot.message'>>
