import { memo, useCallback, useMemo } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { AssistantBlock } from '../contract/snapshot.ts'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** Append Tool-result images while preserving Assistant-native image ownership. */
export function appendResultImages(
  blocks: readonly AssistantBlock[],
  resultImages: readonly ImageAttachmentRef[],
): readonly AssistantBlock[] {
  if (resultImages.length === 0) return blocks
  const seen = new Set(blocks.flatMap(block => block.kind === 'image'
    ? [block.attachment.attachmentId]
    : []))
  const images = resultImages.flatMap((image) => {
    if (seen.has(image.attachmentId)) return []
    seen.add(image.attachmentId)
    return [{ kind: 'image' as const, attachment: image }]
  })
  return images.length === 0 ? blocks : [...blocks, ...images]
}

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  const blocks = useMemo(
    () => owner === undefined ? data.blocks : appendResultImages(data.blocks, tail?.resultImages ?? []),
    [data.blocks, owner, tail],
  )
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  return (
    <AssistantMarkdown
      blocks={blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      reasoningHidden={reasoningHidden}
      revealProcess={revealProcess}
      mentions={mentions}
      t={t}
    />
  )
})
