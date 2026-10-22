import * as React from 'react'
import { cn } from 'cn'

import { Button } from '@/components/ui/button'
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react'

/**
 * Renders page navigation aligned with the shared button controls.
 * @param props - Navigation content, visual overrides, and supported navigation attributes.
 * @returns The centered semantic navigation container.
 */
function Pagination({ className, ...props }: React.ComponentProps<'nav'>) {
    return (
        <nav
            role="navigation"
            aria-label="pagination"
            data-slot="pagination"
            className={cn('mx-auto flex w-full justify-center', className)}
            {...props}
        />
    )
}

/**
 * Groups page controls with compact, consistent spacing.
 * @param props - Page controls, visual overrides, and supported list attributes.
 * @returns The horizontal list of page controls.
 */
function PaginationContent({ className, ...props }: React.ComponentProps<'ul'>) {
    return <ul data-slot="pagination-content" className={cn('flex items-center gap-0.5', className)} {...props} />
}

/**
 * Wraps an individual pagination control.
 * @param props - Page control content and supported list item attributes.
 * @returns A semantic pagination list item.
 */
function PaginationItem({ ...props }: React.ComponentProps<'li'>) {
    return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
    isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, 'size'> &
    React.ComponentProps<'a'>

/**
 * Renders a page link with a visible current-page state.
 * @param props - Target URL, active state, size, and supported anchor attributes.
 * @returns The shared button rendered as a semantic page link.
 */
function PaginationLink({ className, isActive, size = 'icon', ...props }: PaginationLinkProps) {
    return (
        <Button
            variant={isActive ? 'outline' : 'ghost'}
            size={size}
            className={cn(className)}
            nativeButton={false}
            render={<a aria-current={isActive ? 'page' : undefined} data-slot="pagination-link" data-active={isActive} {...props} />}
        />
    )
}

/**
 * Renders the previous-page action with its directional icon.
 * @param props - Label, target URL, visual overrides, and supported page link attributes.
 * @returns The previous-page navigation link.
 */
function PaginationPrevious({ className, text = 'Previous', ...props }: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
    return (
        <PaginationLink aria-label="Go to previous page" size="default" className={cn('pl-1.5!', className)} {...props}>
            <ChevronLeftIcon data-icon="inline-start" />
            <span className="hidden sm:block">{text}</span>
        </PaginationLink>
    )
}

/**
 * Renders the next-page action with its directional icon.
 * @param props - Label, target URL, visual overrides, and supported page link attributes.
 * @returns The next-page navigation link.
 */
function PaginationNext({ className, text = 'Next', ...props }: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
    return (
        <PaginationLink aria-label="Go to next page" size="default" className={cn('pr-1.5!', className)} {...props}>
            <span className="hidden sm:block">{text}</span>
            <ChevronRightIcon data-icon="inline-end" />
        </PaginationLink>
    )
}

/**
 * Marks omitted pages without introducing an interactive control.
 * @param props - Visual overrides and supported span attributes.
 * @returns An aligned ellipsis with supporting screen reader text.
 */
function PaginationEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
    return (
        <span
            aria-hidden
            data-slot="pagination-ellipsis"
            className={cn("flex size-(--control-height) items-center justify-center [&_svg:not([class*='size-'])]:size-4", className)}
            {...props}
        >
            <MoreHorizontalIcon />
            <span className="sr-only">More pages</span>
        </span>
    )
}

export { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious }
