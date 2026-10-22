import { Skeleton } from '../components/ui/skeleton'

/**
 * Keeps route loading inside the persistent authenticated workspace shell.
 * @returns Accessible loading feedback and neutral placeholders without private data.
 */
export default function Loading() {
    return (
        <div className="grid gap-6 p-6 md:p-8" role="status" aria-busy="true">
            <span className="sr-only">正在打开页面…</span>
            <div className="grid gap-3" aria-hidden="true">
                <Skeleton className="h-7 w-48 motion-reduce:animate-none" />
                <Skeleton className="h-4 w-64 max-w-full motion-reduce:animate-none" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
                {[0, 1, 2].map(index => (
                    <Skeleton key={index} className="h-40 motion-reduce:animate-none" />
                ))}
            </div>
        </div>
    )
}
