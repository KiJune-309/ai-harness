/** Restrained content layouts for knowledge collections, uploads, and source details. */
const styles = {
    page: 'workspace-page grid gap-6',
    heading:
        'workspace-page-header flex min-w-0 flex-wrap items-start justify-between gap-4 [&_h1]:break-words [&_p]:mt-2 [&_p]:text-sm [&_p]:text-muted-foreground',
    headingActions: 'flex flex-wrap gap-2',
    sectionHeading:
        'mb-4 flex flex-wrap items-start justify-between gap-4 [&_h2]:text-[length:var(--type-subheading)] [&_h2]:font-semibold [&_p]:mt-2 [&_p]:max-w-3xl [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground',
    primaryButton: '',
    secondaryButton: '',
    notice: '',
    errorBanner: '',
    uploadDialog: 'flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl',
    fields: 'grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2',
    field: 'grid min-w-0 gap-2',
    fileField: 'sm:col-span-2',
    filePicker:
        'relative grid min-h-40 place-items-center overflow-hidden rounded-lg border border-dashed border-input bg-background p-6 focus-within:ring-2 focus-within:ring-ring',
    fileInput: 'absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0',
    filePickerContent: 'pointer-events-none grid max-w-full justify-items-center gap-2 text-center',
    filePickerTitle: 'max-w-full break-all text-sm font-medium',
    filePickerDescription: 'text-xs text-muted-foreground',
    hint: 'text-xs leading-relaxed text-muted-foreground',
    fieldError: 'text-sm text-error-foreground',
    formActions: 'flex shrink-0 flex-wrap items-center justify-between gap-3',
    toolbar: 'workspace-toolbar flex flex-wrap items-center gap-3 border-b pb-4 text-sm',
    search: 'order-first w-full min-w-0 sm:order-none sm:ml-auto sm:max-w-sm sm:flex-1',
    empty: 'text-sm text-muted-foreground',
    documentList: 'grid min-w-0 divide-y',
    documentCard: 'gap-0 rounded-none border-0 bg-transparent py-0 shadow-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
    documentCardLink:
        'grid w-full min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-lg px-2 py-4 text-left outline-none transition-colors duration-(--motion-fast) hover:bg-muted motion-reduce:transition-none sm:grid-cols-[2rem_minmax(0,1fr)_minmax(9rem,14rem)] sm:px-4',
    documentCardHeader: 'flex size-8 items-center justify-center text-muted-foreground',
    documentInfo:
        'grid min-w-0 gap-1 [&_h2]:break-all [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:leading-5 [&_p]:break-words [&_p]:text-xs [&_p]:leading-relaxed [&_p]:text-muted-foreground',
    documentCardFooter:
        'col-start-2 grid min-w-0 gap-2 text-xs text-muted-foreground sm:col-start-auto sm:min-w-36 sm:justify-items-end [&_p]:min-w-0 [&_p]:[overflow-wrap:anywhere]',
    status: '',
    failedStatus: '',
    pagination: 'flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground [&_div]:flex [&_div]:gap-2',
    backLink: 'w-fit justify-start',
    statusPanel:
        '[&_[data-slot=card-content]]:flex [&_[data-slot=card-content]]:flex-wrap [&_[data-slot=card-content]]:items-center [&_[data-slot=card-content]]:gap-3 [&_p]:text-sm [&_p]:text-muted-foreground',
    metadata:
        'grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3 [&_dt]:mb-1 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:break-words [&_dd]:text-sm',
    chunksSection: 'min-w-0',
    chunkList: 'grid gap-6',
    chunk: 'min-w-0 scroll-mt-6 rounded-none border-0 border-b pb-6 shadow-none [&_[data-slot=card-content]]:px-0 focus-visible:outline-2 focus-visible:outline-ring [&_header]:mb-3 [&_header]:flex [&_header]:flex-wrap [&_header]:items-center [&_header]:justify-between [&_header]:gap-2 [&_h3]:font-semibold [&_header>span]:text-xs [&_header>span]:text-muted-foreground',
    chunkSource: 'mb-4 break-all text-xs leading-relaxed text-muted-foreground',
    chunkContent: 'whitespace-pre-wrap break-words text-sm leading-7',
} as const
export default styles
