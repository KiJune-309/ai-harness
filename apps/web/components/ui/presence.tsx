import type { ComponentProps } from 'react'
import { cn } from 'cn'

/**
 * Reveals or hides content with the shared short motion and accessibility state.
 * @param props - Visibility, panel content, visual overrides, and supported container attributes.
 * @returns A panel that keeps hidden descendants inert while its layout collapses.
 */
export function Presence({ visible, children, className, ...props }: ComponentProps<'div'> & { visible: boolean }) {
    return (
        <div
            {...props}
            data-visible={visible}
            aria-hidden={!visible}
            inert={!visible}
            className={cn(
                'grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity,transform] duration-[var(--motion-normal)] ease-[var(--motion-ease)] data-[visible=false]:-translate-y-1 data-[visible=false]:grid-rows-[0fr] data-[visible=false]:opacity-0 motion-reduce:transform-none motion-reduce:transition-none',
                className
            )}
        >
            <div className="min-h-0 overflow-hidden">{children}</div>
        </div>
    )
}
