/** Quiet form and result layouts for explicit indexing and retrieval actions. */
const styles = {
    page: 'workspace-page grid gap-6',
    pageHeading: 'workspace-page-header grid gap-2 [&_p]:text-sm [&_p]:text-muted-foreground',
    backLink: 'w-fit justify-start',
    sourceLink: 'mt-3 w-fit justify-start',
    primary: '',
    secondary: '',
    textButton: 'w-fit',
    hint: 'text-xs leading-relaxed text-muted-foreground',
    fieldError: 'text-sm text-error-foreground',
    notice: '',
    error: '',
    indexPanel:
        'min-w-0 gap-4 rounded-none border-0 border-y py-6 shadow-none [&_[data-slot=card-header]]:px-0 [&_[data-slot=card-content]]:space-y-4 [&_[data-slot=card-content]]:px-0',
    sectionHeading:
        'flex flex-wrap items-start justify-between gap-4 [&_h2]:flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:text-[length:var(--type-subheading)] [&_h2]:font-semibold [&_p]:mt-2 [&_p]:text-sm [&_p]:text-muted-foreground',
    indexState: 'flex flex-wrap items-center gap-3 text-sm',
    modelSummary:
        'grid min-w-0 gap-2 border-b pb-6 text-sm [&_a]:flex [&_a]:w-fit [&_a]:items-center [&_a]:gap-1 [&_a]:text-xs [&_a]:text-muted-foreground [&_a:hover]:text-foreground [&_strong]:break-all [&_span]:text-xs [&_span]:text-muted-foreground [&_p]:break-all [&_p]:text-xs [&_p]:text-muted-foreground',
    actions: 'flex flex-wrap items-center gap-2',
    searchForm: 'grid min-w-0 max-w-4xl gap-6',
    fields: 'm-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2',
    field: 'grid min-w-0 gap-2',
    queryField: 'grid min-w-0 gap-2 sm:col-span-2',
    results: 'grid min-w-0 gap-4 border-t pt-6 [&>h2]:text-[length:var(--type-subheading)] [&>h2]:font-semibold',
    hit: 'min-w-0 rounded-none border-0 border-b py-0 pb-6 shadow-none [&_[data-slot=card-content]]:px-0 [&_header]:flex [&_header]:flex-wrap [&_header]:justify-between [&_header]:gap-2 [&_h3]:break-all [&_h3]:font-semibold [&_header>span]:text-xs [&_header>span]:text-muted-foreground',
    hitContent: 'mt-4 whitespace-pre-wrap break-words text-sm leading-7',
    scores: 'my-3 flex flex-wrap gap-4 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:font-mono [&_dd]:text-sm',
} as const
export default styles
