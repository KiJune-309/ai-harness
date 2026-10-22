'use client'

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

/**
 * Groups related panels with accessible tab navigation.
 * @param props - Tab state, orientation, content, and supported root attributes.
 * @returns The tabs root with consistent space between navigation and content.
 */
function Tabs({ className, orientation = 'horizontal', ...props }: TabsPrimitive.Root.Props) {
    return (
        <TabsPrimitive.Root
            data-slot="tabs"
            data-orientation={orientation}
            className={cn('group/tabs flex gap-4 data-horizontal:flex-col', className)}
            {...props}
        />
    )
}

const tabsListVariants = cva(
    'group/tabs-list inline-flex w-fit max-w-full items-center justify-center rounded-lg p-1 text-muted-foreground group-data-horizontal/tabs:h-(--control-height) group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none pointer-coarse:group-data-horizontal/tabs:h-13 pointer-coarse:group-data-horizontal/tabs:data-[variant=line]:h-11',
    {
        variants: {
            variant: {
                default: 'bg-muted',
                line: 'gap-4 bg-transparent p-0',
            },
        },
        defaultVariants: {
            variant: 'line',
        },
    }
)

/**
 * Renders tab navigation in a segmented or understated line style.
 * @param props - Visual variant, tab controls, and supported list attributes.
 * @returns The tab list with its selected navigation treatment.
 */
function TabsList({ className, variant = 'line', ...props }: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
    return (
        <TabsPrimitive.List
            data-slot="tabs-list"
            data-variant={variant}
            className={cn(tabsListVariants({ variant }), className)}
            {...props}
        />
    )
}

/**
 * Renders a tab control with clear selected and keyboard focus states.
 * @param props - Tab value, label, visual overrides, and supported tab attributes.
 * @returns The interactive tab control styled for its containing list.
 */
function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
    return (
        <TabsPrimitive.Tab
            data-slot="tabs-trigger"
            className={cn(
                "relative inline-flex h-full flex-1 items-center justify-center gap-2 rounded-[6px] border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--motion-fast) outline-none group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-disabled:pointer-events-none aria-disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11 motion-reduce:transition-none group-data-[variant=default]/tabs-list:data-active:border-border group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                'group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:px-1 group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:data-active:text-primary dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent',
                'data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground',
                'after:absolute after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-1 group-data-horizontal/tabs:after:bottom-0 group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-1 group-data-vertical/tabs:after:right-0 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100 motion-reduce:after:transition-none',
                className
            )}
            {...props}
        />
    )
}

/**
 * Renders the panel associated with a selected tab.
 * @param props - Panel value, content, visual overrides, and supported panel attributes.
 * @returns The tab panel with the primitive visibility behavior preserved.
 */
function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
    return <TabsPrimitive.Panel data-slot="tabs-content" className={cn('min-w-0 flex-1 text-sm outline-none', className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
