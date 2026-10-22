/** Layout and content typography for project lists, forms, and task membership. */
const styles = {
    page: 'workspace-page flex min-w-0 flex-col gap-6',
    heading:
        'workspace-page-header flex min-w-0 flex-wrap items-start justify-between gap-4 [&_h1]:[overflow-wrap:anywhere] [&_p]:mt-2 [&_p]:text-sm [&_p]:text-muted-foreground',
    headingActions: 'flex flex-wrap items-center gap-2',
    toolbar: 'workspace-toolbar flex min-w-0 flex-wrap items-center gap-3 text-sm text-muted-foreground',
    search: 'order-first min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-sm',
    storageNotice: 'text-xs text-muted-foreground',
    feedback: 'workspace-page mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-4 text-center',
    spinner: 'animate-spin motion-reduce:animate-none',
    fields: 'm-0 grid min-w-0 gap-4 border-0 p-0',
    field: 'grid min-w-0 gap-2',
    hint: 'text-xs text-muted-foreground',
    fieldError: 'text-sm text-error-foreground',
    dialogHeader: 'flex flex-row items-start justify-between gap-3',
    dialogForm: 'space-y-4',
    dialogActions: 'mt-6 flex flex-wrap items-center justify-end gap-2',
    projectGrid: 'workspace-collection grid min-w-0',
    projectCard:
        'workspace-item min-w-0 rounded-none border-0 border-b bg-transparent py-4 shadow-none transition-colors duration-(--motion-fast) hover:bg-muted motion-reduce:transition-none',
    projectCardContent: 'flex min-w-0 items-start gap-4 px-0',
    projectLink:
        'grid min-w-0 flex-1 gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring [&_h2]:[overflow-wrap:anywhere] [&_h2]:text-[length:var(--type-subheading)] [&_h2]:font-semibold [&_p]:[overflow-wrap:anywhere] [&_p]:text-sm [&_p]:text-muted-foreground',
    projectIdentity: 'text-xs text-muted-foreground',
    openProject: 'flex items-center gap-2 text-xs text-muted-foreground',
    description: 'max-w-3xl whitespace-pre-wrap [overflow-wrap:anywhere]',
    templateOrigin:
        'space-y-3 px-0 [&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-2 [&_p]:text-sm [&_p]:text-muted-foreground',
    stats: 'grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 border-y py-4 sm:grid-cols-5',
    stat: 'grid gap-1 px-0 [&_strong]:text-xl [&_strong]:font-medium [&_span]:text-xs [&_span]:text-muted-foreground',
    tasksHeading:
        'flex flex-wrap items-center justify-between gap-4 [&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-2 [&_h2]:text-[length:var(--type-subheading)] [&_h2]:font-semibold [&_p]:text-sm [&_p]:text-muted-foreground',
    membershipForm: 'grid min-w-0 gap-3',
    membershipControls: 'flex min-w-0 flex-wrap items-center gap-2',
    selectWrap: 'min-w-0 flex-1',
    moveNotice: 'text-sm text-muted-foreground',
    taskList: 'workspace-collection grid min-w-0',
    taskRow: 'workspace-item min-w-0 rounded-none border-0 border-b bg-transparent py-3 shadow-none',
    taskRowContent: 'flex min-w-0 flex-wrap items-center gap-4 px-0',
    taskLink: 'grid min-w-0 flex-1 gap-2 [&_p]:truncate [&_p]:text-sm [&_p]:text-muted-foreground',
    taskTitle:
        'flex min-w-0 flex-wrap items-center gap-2 [&_h3]:break-words [&_h3]:text-[length:var(--type-subheading)] [&_h3]:font-semibold',
    taskOpen: 'flex items-center gap-2 text-xs text-muted-foreground',
    templateTaskOrder: 'text-xs text-muted-foreground',
} as const

export default styles
