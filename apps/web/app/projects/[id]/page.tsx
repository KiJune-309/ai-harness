import { ProjectWorkspace } from '../../../components/project-workspace'

/**
 * Opens a project at its stable address without creating or executing tasks.
 * @param props - Project identifier supplied by the application route.
 * @returns Saved project information and every associated personal task.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <ProjectWorkspace projectId={id} />
}
