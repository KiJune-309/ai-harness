/** Layout and content typography shared by account and authentication pages. */
const styles = {
    page: 'workspace-page flex flex-col gap-6',
    pageHeading: 'workspace-page-header space-y-2 [&_p]:max-w-2xl [&_p]:text-sm [&_p]:text-muted-foreground',
    sectionNav:
        'grid grid-cols-2 gap-x-2 gap-y-1 border-b pb-3 sm:flex sm:flex-wrap [&_a]:justify-start [&_a]:text-muted-foreground [&_a:hover]:text-foreground',
    section: 'min-w-0 scroll-mt-6 border-b pb-6 last:border-0',
    sectionLayout: 'grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-8',
    sectionIntro:
        'min-w-0 space-y-2 [&_h2]:text-[15px] [&_h2]:font-semibold [&_p]:max-w-md [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground',
    settingsForm: 'grid min-w-0 max-w-xl gap-4 [&>button]:justify-self-start',
    fields: 'm-0 grid min-w-0 gap-4 border-0 p-0',
    field: 'grid min-w-0 gap-2',
    hint: 'flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground [&_svg]:mt-1 [&_svg]:shrink-0',
    error: 'text-sm text-error-foreground',
    optional: 'text-xs font-normal text-muted-foreground',
    securityForms:
        'grid min-w-0 max-w-xl gap-6 [&>form+form]:border-t [&>form+form]:pt-6 [&_h3]:mb-4 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-2 [&_h3]:text-sm [&_h3]:font-medium',
    modelArea: 'min-w-0 max-w-2xl space-y-6',
    modelList: 'grid min-w-0 gap-0 [&>article]:border-b',
    listHeading: 'mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground',
    modelCard: 'min-w-0 py-4 first:pt-0',
    modelCardContent: 'space-y-3 [&>h3]:text-sm [&>h3]:font-medium',
    modelTitle: 'flex min-w-0 flex-wrap items-center gap-2 [&_strong]:break-all',
    modelCode: 'break-all font-mono text-sm',
    modelUrl: 'break-all text-xs text-muted-foreground',
    cardActions: 'flex flex-wrap items-center gap-2',
    modelForm: 'grid min-w-0 gap-4 border-t pt-6',
    editorHeading: 'flex flex-wrap items-center justify-between gap-2 [&_h3]:text-[15px] [&_h3]:font-semibold',
    empty: 'text-sm text-muted-foreground',
} as const

export default styles
