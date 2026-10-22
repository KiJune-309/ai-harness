'use client'

import * as React from 'react'
import { cn } from 'cn'

/**
 * Renders tabular content within a local horizontal scroll boundary.
 * @param props - Table content, visual overrides, and supported table attributes.
 * @returns A semantic table that keeps wide content inside its container.
 */
function Table({ className, ...props }: React.ComponentProps<'table'>) {
    return (
        <div data-slot="table-container" className="relative w-full overflow-x-auto">
            <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
        </div>
    )
}

/**
 * Groups column headings on a quiet secondary surface.
 * @param props - Header rows, visual overrides, and supported table section attributes.
 * @returns The table header with shared row separation.
 */
function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
    return <thead data-slot="table-header" className={cn('bg-muted/50 [&_tr]:border-b', className)} {...props} />
}

/**
 * Groups table data without an extra border below the final row.
 * @param props - Data rows, visual overrides, and supported table section attributes.
 * @returns The table body with consistent row boundaries.
 */
function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
    return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

/**
 * Separates summary rows from the main table body.
 * @param props - Footer rows, visual overrides, and supported table section attributes.
 * @returns The table footer on a subtle secondary surface.
 */
function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
    return (
        <tfoot data-slot="table-footer" className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)} {...props} />
    )
}

/**
 * Renders a table row with restrained hover and selection feedback.
 * @param props - Row content, visual overrides, and supported row attributes.
 * @returns The semantic row with shared state colors and separators.
 */
function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
    return (
        <tr
            data-slot="table-row"
            className={cn(
                'border-b border-border transition-colors duration-(--motion-fast) hover:bg-muted/60 has-aria-expanded:bg-muted/60 data-[state=selected]:bg-accent motion-reduce:transition-none',
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders a compact column heading with lower visual emphasis than row content.
 * @param props - Heading content, visual overrides, and supported header cell attributes.
 * @returns The aligned table heading cell.
 */
function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
    return (
        <th
            data-slot="table-head"
            className={cn(
                'h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0',
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders a data cell with consistent horizontal and vertical reading space.
 * @param props - Cell content, visual overrides, and supported data cell attributes.
 * @returns The aligned table data cell.
 */
function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
    return (
        <td
            data-slot="table-cell"
            className={cn('px-3 py-3 align-middle leading-relaxed whitespace-nowrap [&:has([role=checkbox])]:pr-0', className)}
            {...props}
        />
    )
}

/**
 * Renders supporting context below a table.
 * @param props - Caption content, visual overrides, and supported caption attributes.
 * @returns The muted table caption.
 */
function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
    return <caption data-slot="table-caption" className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
