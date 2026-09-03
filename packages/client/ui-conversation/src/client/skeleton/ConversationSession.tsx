/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconCloseOutline16, IconPanelLeftOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps, ConvViewOwnerProps,
} from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { clampSideRatio, resolveActiveView, resolveSideView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * Drag handle on the side pane's left edge: pointer capture and rAF-throttled
 * ratio reports against the conversation body's box.
 */
function SplitHandle(props: {
  label: string
  onStart: () => void
  onDrag: (clientX: number) => void
  onEnd: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.viewSplitHandle}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useConversation, useConversationViews, useStore,
  renderSlot, open, selectView, openSideView, closeSideView, t,
}: ConversationSessionHeaderProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const sideId = useStore(s => s.sideView ?? null)
  const active = resolveActiveView(tabs, selectedId)
  const side = resolveSideView(tabs, sideId, active?.id)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const hideChrome = session.blank && conversationPhase(session, conversation) === 'blank'

  return (
    <header
      className={clsx(css.header, hideChrome && css.headerHidden)}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <>
          <div className={css.titleRow}>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  const title = (
                    <button
                      type="button"
                      className={clsx(
                        css.crumb,
                        summary.subagent && css.crumbSubagent,
                        last && css.crumbCurrent,
                      )}
                      disabled={last}
                      onClick={() => { open(summary.id) }}
                    >
                      {summary.displayTitle}
                    </button>
                  )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.utilities', {})}
            </div>
          </div>
          {tabs.length > 1 && (
            <div className={css.tabs} role="tablist">
              {tabs.map((viewTab) => {
                const docked = viewTab.id === side?.id
                const sideLabel = docked
                  ? t('view.closeSide', { label: viewTab.label })
                  : t('view.openSide', { label: viewTab.label })
                return (
                  <div key={viewTab.id} className={css.tabCluster}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewTab.id === active?.id}
                      className={clsx(
                        css.tab,
                        viewTab.id === active?.id && css.tabActive,
                        docked && css.tabDocked,
                      )}
                      onClick={() => { selectView(viewTab.id) }}
                    >
                      {viewTab.label}
                    </button>
                    <Tooltip label={sideLabel} side="bottom" delayMs={400}>
                      <button
                        type="button"
                        className={css.tabSide}
                        aria-label={sideLabel}
                        aria-pressed={docked}
                        onClick={() => {
                          if (docked) closeSideView()
                          else openSideView(viewTab.id)
                        }}
                      >
                        {docked
                          ? <span aria-hidden="true"><IconCloseOutline16 size={12} /></span>
                          : <span aria-hidden="true"><IconPanelLeftOutline16 size={12} className={css.tabSideIcon} /></span>}
                      </button>
                    </Tooltip>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </header>
  )
}

/**
 * Renders the primary Session view inside the resident scrollport, portals an
 * optional side View into the conversation body's right-hand mount, and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, render, and locale shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession({
  useSession, useConversation, useConversationViews, useInput, inputActions, useStore, actions,
  renderSlot, bindDraftMirror, openView, t,
}: ConversationSessionProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const sideId = useStore(s => s.sideView ?? null)
  const sideRatio = useStore(s => clampSideRatio(s.sideRatio))
  const active = resolveActiveView(tabs, selectedId)
  const side = resolveSideView(tabs, sideId, active?.id)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  const viewRequest = useStore(s => s.viewRequest ?? null)
  const areaRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLElement | null>(null)
  const [sideHost, setSideHost] = useState<HTMLElement | null>(null)
  const blank = session.blank && conversationPhase(session, conversation) === 'blank'

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  useLayoutEffect(() => {
    const found = areaRef.current?.closest('[data-conversation-body]')
    if (found instanceof HTMLElement) bodyRef.current = found
    const body = bodyRef.current
    if (body === null) {
      setSideHost(null)
      return
    }
    const mount = body.querySelector('[data-conversation-side]')
    setSideHost(mount instanceof HTMLElement ? mount : null)
    const split = !blank && side !== undefined
    if (!split) {
      body.removeAttribute('data-conversation-split')
      body.removeAttribute('data-conversation-split-dragging')
      body.style.removeProperty('--dsh-view-split-primary')
      body.style.removeProperty('--dsh-view-split-side')
      return
    }
    body.setAttribute('data-conversation-split', '')
    body.style.setProperty('--dsh-view-split-primary', `${sideRatio}fr`)
    body.style.setProperty('--dsh-view-split-side', `${1 - sideRatio}fr`)
    return () => {
      body.removeAttribute('data-conversation-split')
      body.removeAttribute('data-conversation-split-dragging')
      body.style.removeProperty('--dsh-view-split-primary')
      body.style.removeProperty('--dsh-view-split-side')
    }
  }, [blank, side, sideRatio])

  const onSplitDrag = useCallback((clientX: number) => {
    const body = bodyRef.current
    if (body === null) return
    const box = body.getBoundingClientRect()
    if (box.width <= 0) return
    actions.setSideRatio((clientX - box.left) / box.width)
  }, [actions])
  const onSplitStart = useCallback(() => {
    bodyRef.current?.setAttribute('data-conversation-split-dragging', '')
  }, [])
  const onSplitEnd = useCallback(() => {
    bodyRef.current?.removeAttribute('data-conversation-split-dragging')
  }, [])

  if (blank) return null

  const owner: ConvViewOwnerProps = {
    viewRequest,
    openView,
    completeViewRequest: actions.completeViewRequest,
  }

  return (
    <>
      <div ref={areaRef} className={css.viewArea}>
        {active !== undefined && renderSlot('conversation.view', owner, { only: active.id })}
      </div>
      {side !== undefined && sideHost !== null && createPortal(
        <>
          <SplitHandle
            label={t('view.resize')}
            onStart={onSplitStart}
            onDrag={onSplitDrag}
            onEnd={onSplitEnd}
          />
          <div className={css.viewPaneSide}>
            {renderSlot('conversation.view', owner, { only: side.id })}
          </div>
        </>,
        sideHost,
      )}
    </>
  )
}
