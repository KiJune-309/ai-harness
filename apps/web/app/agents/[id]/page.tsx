import { AgentEditor } from '../../../components/agent-editor'

/**
 * Opens a saved Agent at its stable detail address.
 * @param props - Agent identifier provided by the application route.
 * @returns The independently loaded Agent details and explicit editing controls.
 */
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <AgentEditor key={id} agentId={id} />
}
