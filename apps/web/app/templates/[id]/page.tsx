import { TemplateWorkspace } from '../../../components/template-workspace'

/**
 * Discovers a saved workflow editor or explains an unchanged historical personal record.
 * @param props - Template identifier supplied by the application route.
 * @returns The authorized workflow editor or a safe return to the workflow catalog.
 */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <TemplateWorkspace editing templateId={id} />
}
