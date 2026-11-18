/** A lightweight global status entry and the cloud tab's existing globe glyph. */
import { Button, IconGlobeOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { CloudSource } from './source.ts'
import type {} from './locales.ts'
import css from './CloudPanel.module.css'

/** State and navigation owned by the Client plugin, independent of any tab. */
export interface CloudEntryInjected {
  hooks: { cloud: CloudSource }
  open(): void
}

/**
 * Keep cloud/local/paused status reachable while the resource tab is closed.
 * @param props - connection state and the current-scope navigation callback.
 * @returns a sidebar footer status entry.
 */
export function CloudEntry({ t, useCloud, open, wide }: PropsRuntime<'sidebar.footer.action'> & PropsLocale<'dsh.cloud'> & InjectFace<CloudEntryInjected>) {
  const mode = useCloud(value => value.mode)
  const label = `${t('title')} · ${t(mode)}`
  return <Tooltip label={label} side="right" disabled={wide}>
    <Button variant="ghost" className={css.entry} aria-label={label} onClick={open}>
      <IconGlobeOutlineRegular />{wide && label}
    </Button>
  </Tooltip>
}

/**
 * Draw the cloud page's navigation glyph; the sidebar owns its accessible label.
 * @param props - requested icon edge.
 * @returns the existing globe icon.
 */
export function CloudIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconGlobeOutlineRegular size={size} />
}

/**
 * Draw a meaningful cloud glyph in the native tab strip.
 * @param props - the current tab information.
 * @returns the glyph and native tab title.
 */
export function CloudTabTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>) {
  const { tab } = useTabInfo()
  return <><IconGlobeOutlineRegular />{tab.title}</>
}
