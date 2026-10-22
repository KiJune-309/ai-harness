import * as React from 'react'
import { cn } from 'cn'
import { ChevronDownIcon } from 'lucide-react'

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
    size?: 'sm' | 'default'
}

/**
 * Renders a native select aligned with the application form controls.
 * @param props - Select size, visual overrides, options, and supported select attributes.
 * @returns The styled select with a decorative chevron and native selection behavior.
 */
function NativeSelect({ className, size = 'default', ...props }: NativeSelectProps) {
    return (
        <div
            className={cn('group/native-select relative w-fit has-[select:disabled]:opacity-50', className)}
            data-slot="native-select-wrapper"
            data-size={size}
        >
            <select
                data-slot="native-select"
                data-size={size}
                className="h-(--control-height) w-full min-w-0 appearance-none rounded-lg border border-input bg-background py-2 pr-9 pl-3 text-base text-foreground transition-colors duration-(--motion-fast) outline-none select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-[size=sm]:h-(--control-height-sm) data-[size=sm]:rounded-[6px] data-[size=sm]:py-1 md:text-sm pointer-coarse:min-h-11 motion-reduce:transition-none dark:bg-input/20 dark:hover:bg-input/40 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                {...props}
            />
            <ChevronDownIcon
                className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground select-none"
                aria-hidden="true"
                data-slot="native-select-icon"
            />
        </div>
    )
}

/**
 * Renders an option using the operating system menu colors.
 * @param props - Option content and supported option attributes.
 * @returns A native select option with accessible system colors.
 */
function NativeSelectOption({ className, ...props }: React.ComponentProps<'option'>) {
    return <option data-slot="native-select-option" className={cn('bg-[Canvas] text-[CanvasText]', className)} {...props} />
}

/**
 * Renders a labeled group of native select options.
 * @param props - Group label, options, and supported optgroup attributes.
 * @returns A native option group with accessible system colors.
 */
function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<'optgroup'>) {
    return <optgroup data-slot="native-select-optgroup" className={cn('bg-[Canvas] text-[CanvasText]', className)} {...props} />
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
