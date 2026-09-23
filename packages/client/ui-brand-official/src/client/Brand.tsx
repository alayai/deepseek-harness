import { BrandWordmark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { COCO_MARK_DATA_URL } from './coco-mark.ts'

/** Presentation for sidebar and conversation-hero brand-mark slots. */
export interface OfficialBrandMarkProps extends SidebarBrandMarkOwnerProps {
  /** Optional host class preserving surrounding mark geometry. */
  className?: string | undefined
}

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official CoCo AI mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return (
    <img
      src={COCO_MARK_DATA_URL}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
      style={{ display: 'block', borderRadius: Math.max(4, Math.round(size * 0.22)), objectFit: 'cover' }}
    />
  )
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <BrandWordmark includeMark={false} />
}
