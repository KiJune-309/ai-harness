/** Workflow catalog layout, safe historical routing, and collection feedback typography. */
const styles = {
    page: 'workspace-page flex min-w-0 flex-col gap-6',
    heading:
        'workspace-page-header flex min-w-0 flex-wrap items-start justify-between gap-4 [&_h1]:[overflow-wrap:anywhere] [&_p]:mt-2 [&_p]:text-sm [&_p]:text-muted-foreground',
    toolbar: 'workspace-toolbar flex min-w-0 flex-wrap items-center gap-3 text-sm text-muted-foreground',
    search: 'order-first min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-sm',
    empty: 'flex min-h-64 flex-col items-center justify-center gap-4 text-center [&_h2]:text-lg [&_h2]:font-semibold [&_p]:max-w-lg [&_p]:text-sm [&_p]:text-muted-foreground',
    feedback: 'workspace-page mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-4 text-center',
    templateGrid: 'workspace-collection grid min-w-0',
    templateCard:
        'grid min-w-0 gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&_h2]:[overflow-wrap:anywhere] [&_h2]:text-[15px] [&_h2]:font-medium [&_p]:[overflow-wrap:anywhere] [&_p]:text-sm [&_p]:text-muted-foreground',
    cardTop: 'flex flex-wrap items-center justify-between gap-2',
    cardMeta: 'flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground',
    openTemplate: 'flex items-center gap-2 text-xs text-muted-foreground',
} as const

export default styles
