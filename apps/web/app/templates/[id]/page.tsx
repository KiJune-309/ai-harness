import { TemplateWorkspace } from '../../../components/template-workspace'

/**
 * Opens an existing template at its stable editor and launch-preview address.
 * @param props - Template identifier supplied by the application route.
 * @returns The saved-version editor and explicit project-creation flow.
 */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <TemplateWorkspace editing templateId={id} />
}
