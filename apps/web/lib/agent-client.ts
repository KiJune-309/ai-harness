import type { AgentCatalog, AgentDefinition, AgentInput } from '@ai-harness/contracts'
import { agentCatalogSchema, agentDefinitionSchema, agentInputSchema } from '@ai-harness/contracts'
import { requestChatResponse } from './chat-client'

const agentPath = '/agents'

/**
 * Validates agent responses before they enter browser state.
 * @param value - Untrusted JSON returned by the API.
 * @param schema - Shared validator for the requested resource.
 * @returns The validated public resource.
 * @throws Error when the response does not match the public contract.
 */
function parseResponse<T>(value: unknown, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error('Agent 服务返回了无效的数据，请重新载入。')
    return parsed.data
}

/**
 * Requests an agent resource through the same-origin API proxy.
 * @param path - Resource path relative to the agent API.
 * @param options - HTTP options, including an optional cancellation signal.
 * @returns The untrusted JSON body to validate at the call site.
 * @throws Error when the request fails, preserving a useful server message.
 */
async function requestJson(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await requestChatResponse(`${agentPath}${path}`, { cache: 'no-store', ...options })
    if (!response.ok) {
        let message = `Agent 服务请求失败（${response.status}），请稍后重试。`
        try {
            const body: unknown = await response.json()
            if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message.trim()) {
                message = body.message
            }
        } catch {
            // Connection failures can return a non-JSON proxy response.
        }
        throw new Error(message)
    }
    return response.json()
}

/**
 * Loads models and tools available to the authenticated browser session.
 * @param signal - Optional cancellation signal for the request.
 * @returns Available agent capabilities without model credentials.
 * @throws Error when the catalog cannot be loaded or is invalid.
 */
export async function getAgentCatalog(signal?: AbortSignal): Promise<AgentCatalog> {
    return parseResponse(await requestJson('/catalog', { signal }), agentCatalogSchema)
}

/**
 * Loads agents owned by the current browser session.
 * @param signal - Optional cancellation signal for the request.
 * @returns Saved agents in the order returned by the server.
 * @throws Error when the server rejects the request or returns an invalid list.
 */
export async function listAgents(signal?: AbortSignal): Promise<AgentDefinition[]> {
    const result = await requestJson('', { signal })
    if (!result || typeof result !== 'object' || !('agents' in result)) throw new Error('Agent 服务返回了无效的列表。')
    return parseResponse(result.agents, agentDefinitionSchema.array())
}

/**
 * Loads a saved agent for the chat selector or editor.
 * @param id - Agent identifier supplied by the server.
 * @param signal - Optional cancellation signal for the request.
 * @returns The validated saved agent definition.
 * @throws Error when the agent is unavailable or its response is invalid.
 */
export async function getAgent(id: string, signal?: AbortSignal): Promise<AgentDefinition> {
    return parseResponse(await requestJson(`/${encodeURIComponent(id)}`, { signal }), agentDefinitionSchema)
}

/**
 * Validates and creates an agent in the current server session.
 * @param input - Editable agent settings, excluding server-owned metadata.
 * @param signal - Optional cancellation signal for the request.
 * @returns The saved agent with its server identifier and timestamps.
 * @throws Error when input validation or persistence fails.
 */
export async function createAgent(input: AgentInput, signal?: AbortSignal): Promise<AgentDefinition> {
    const result = await requestJson('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentInputSchema.parse(input)),
        signal,
    })
    return parseResponse(result, agentDefinitionSchema)
}

/**
 * Validates and replaces an existing agent's editable settings.
 * @param id - Identifier of the agent being edited.
 * @param input - Complete editable settings for the agent.
 * @param signal - Optional cancellation signal for the request.
 * @returns The saved agent with updated server metadata.
 * @throws Error when validation, authorization, or persistence fails.
 */
export async function updateAgent(id: string, input: AgentInput, signal?: AbortSignal): Promise<AgentDefinition> {
    const result = await requestJson(`/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentInputSchema.parse(input)),
        signal,
    })
    return parseResponse(result, agentDefinitionSchema)
}
