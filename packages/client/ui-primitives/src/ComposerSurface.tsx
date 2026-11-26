/** Shared composer presentation; the caller owns text, submit and authority. */
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import clsx from 'clsx'
import css from './ComposerSurface.module.css'

/** Render a native composer card around a caller-owned input and actions. */
export const ComposerSurface = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function ComposerSurface({ className, ...props }, ref) {
  return <div ref={ref} {...props} className={clsx(css.surface, className)} />
})
