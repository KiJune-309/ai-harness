import { TaskWorkspace } from '../../../components/task-workspace'

/**
 * Opens a persisted task at its stable detail address.
 * @param props - Task identifier supplied by the application route.
 * @returns The task goal, frozen assistant, work status, and conversation.
 */
export default async function TaskPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>
    searchParams?: Promise<{ event?: string }>
}) {
    const { id } = await params
    const query = await searchParams
    return <TaskWorkspace taskId={id} eventId={query?.event} />
}
