'use client'

import type { ComponentProps, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'
import { Button } from './button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'

type DisclosureProps = Omit<ComponentProps<typeof Collapsible>, 'title'> & {
    title: ReactNode
    triggerClassName?: string
    contentClassName?: string
}

/**
 * Shares the same keyboard, focus, and motion behavior across expandable sections.
 * @param props - Accessible trigger content, panel content, state, visual overrides, and supported root attributes.
 * @returns A responsive disclosure using the shared button and collapsible primitives.
 */
export function Disclosure({ title, children, className, triggerClassName, contentClassName, ...props }: DisclosureProps) {
    return (
        <Collapsible className={cn('min-w-0', className)} {...props}>
            <CollapsibleTrigger
                render={
                    <Button
                        variant="ghost"
                        className={cn(
                            'group/disclosure-trigger min-h-11 w-full justify-between gap-3 px-0 text-left whitespace-normal hover:bg-transparent',
                            triggerClassName
                        )}
                    />
                }
            >
                <span className="min-w-0">{title}</span>
                <ChevronDown
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground transition-transform duration-(--motion-fast) group-data-[panel-open]/disclosure-trigger:rotate-180 motion-reduce:transition-none"
                />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className={cn('pt-3 text-sm leading-relaxed', contentClassName)}>{children}</div>
            </CollapsibleContent>
        </Collapsible>
    )
}
