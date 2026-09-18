import type { IconProps } from './icons/props.ts'
import { FISH_LOGO_PATH } from './FishLogo.tsx'

/** Display options for the official brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading whale mark; defaults to true. */
  includeMark?: boolean | undefined
}

const VIEW_HEIGHT = 24
const MARK_CROP_X = 26
const VIEW_WIDTH = 248
const NAME_WIDTH = VIEW_WIDTH - MARK_CROP_X
const NAME = 'ETRX一体机智能平台v1.0'
const BADGE = 'LITE'
const WORDMARK_FONT = "ui-sans-serif, system-ui, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"
const NAME_TEXT_STYLE = { fontSize: 14, fontWeight: 600, letterSpacing: 0 } as const
const BADGE_TEXT_STYLE = { fontSize: 9, fontWeight: 700, letterSpacing: '0.04em' } as const

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading whale mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? VIEW_WIDTH : NAME_WIDTH
  return (
    <svg
      width={(size * width) / VIEW_HEIGHT}
      height={size}
      className={className}
      viewBox={includeMark ? `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}` : `${MARK_CROP_X} 0 ${NAME_WIDTH} ${VIEW_HEIGHT}`}
      fill="none"
      aria-hidden="true"
    >
      <g clipPath="url(#dsh-wordmark-whale-clip)">
        <path d={FISH_LOGO_PATH} fill="currentColor" transform="translate(0.141602 3.52185)" />
      </g>
      <text
        x="27"
        y="12.5"
        fill="currentColor"
        fontFamily={WORDMARK_FONT}
        fontSize="14"
        fontWeight="600"
        letterSpacing={0}
        dominantBaseline="central"
        style={NAME_TEXT_STYLE}
      >
        {NAME}
      </text>
      <rect x="212" y="5.5" width="32" height="14" rx="2" fill="currentColor" />
      <text
        x="228"
        y="12.5"
        fill="var(--dsw-alias-label-primary-inverted)"
        fontFamily={WORDMARK_FONT}
        fontSize="9"
        fontWeight="700"
        letterSpacing="0.04em"
        textAnchor="middle"
        dominantBaseline="central"
        style={BADGE_TEXT_STYLE}
      >
        {BADGE}
      </text>
      <defs>
        <clipPath id="dsh-wordmark-whale-clip">
          <rect width="23.16" height="17.0435" fill="white" transform="translate(0.141602 3.52185)" />
        </clipPath>
      </defs>
    </svg>
  )
}
