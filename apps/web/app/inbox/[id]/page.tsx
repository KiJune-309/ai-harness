import { TaskWorkspace } from '../../../components/task-workspace'

/**
 * Opens a persisted task at its stable detail address.
 * @param props - Task identifier supplied by the application route.
 * @returns The task goal, frozen assistant, work status, and conversation.
 */
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <TaskWorkspace taskId={id} />
}
