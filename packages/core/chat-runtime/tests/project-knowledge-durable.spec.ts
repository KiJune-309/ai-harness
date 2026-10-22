import type { HumanRequest, HumanWaitInput } from '@ai-harness/contracts'
import { expect, it } from 'vitest'
import {
    createCollaborationRuntime,
    type CollaborationJournalPort,
    type CollaborationJournalSnapshot,
    type CollaborationRunInput,
    type HumanLoopPort,
    type SessionEvent,
} from '../src/collaboration.ts'

/** Explicit test-only private journal, retaining canonical records across runtime disposal. */
class DurableProjectJournal implements CollaborationJournalPort {
    value: CollaborationJournalSnapshot | undefined

    /**
     * Reads detached private canonical records through the injected persistence boundary.
     * @returns The current stored session, or undefined before its initial creation.
     */
    async read(): Promise<CollaborationJournalSnapshot | undefined> {
        return structuredClone(this.value)
    }

    /**
     * Creates exactly one session with the actual core-generated immutable header.
     * @param header - Canonical session identity and metadata.
     * @param inheritedEventCount - Exact inherited event prefix.
     * @returns After the isolated persistence fixture owns the header.
     * @throws Error when a second session attempts to replace it.
     */
    async create(header: CollaborationJournalSnapshot['header'], inheritedEventCount: number): Promise<void> {
        if (this.value) throw new Error('The fixture session already exists.')
        this.value = { header: structuredClone(header), events: [], inheritedEventCount }
    }

    /**
     * Commits only contiguous canonical batches emitted by the actual Cordis loop.
     * @param events - Actual owner session events awaiting durable acknowledgement.
     * @returns After all records have been copied into isolated persistent fixture state.
     * @throws Error for a missing session or discontinuous sequence.
     */
    async append(events: readonly SessionEvent[]): Promise<void> {
        if (!this.value || events[0]?.seq !== this.value.events.length) throw new Error('Noncontiguous project journal.')
        this.value.events = [...this.value.events, ...structuredClone(events)]
    }

    /**
     * Represents a retained lease in the explicit journal fixture.
     * @returns Nothing while the test worker owns its session.
     */
    async assertOwnership(): Promise<void> {}
}

/** Explicit test-only human-intervention port, rejecting any unexpected request or effect. */
class NoProjectApproval implements HumanLoopPort {
    waits = 0
    effects = 0

    /**
     * Reads the empty actual-request set without creating an approval.
     * @returns No pending or completed human intervention requests.
     */
    async read(): Promise<readonly HumanRequest[]> {
        return []
    }

    /**
     * Refuses an unexpected human question or generic approval for project reference reads.
     * @param _input - Attempted human request, which this test never authorizes.
     * @returns Never.
     * @throws Error for every call, making an accidental pause observable.
     */
    async wait(_input: HumanWaitInput): Promise<HumanRequest> {
        this.waits += 1
        throw new Error('Project reference reads must not request human approval or wait.')
    }

    /**
     * Refuses an effect claim because project file access is classified as read-only.
     * @param _id - Attempted human operation identity.
     * @param _version - Attempted reviewed operation version.
     * @returns Never.
     * @throws Error for every unexpected effect claim.
     */
    async beginEffect(_id: string, _version: number): Promise<HumanRequest> {
        this.effects += 1
        throw new Error('Project reference reads must not claim approved effects.')
    }

    /**
     * Refuses effect completion because no project reference operation needs approval.
     * @param _id - Attempted human operation identity.
     * @param _version - Attempted reviewed operation version.
     * @param _outcome - Unexpected effect completion projection.
     * @returns Never.
     * @throws Error for every unexpected effect completion.
     */
    async finishEffect(
        _id: string,
        _version: number,
        _outcome: { status: 'succeeded' | 'failed' | 'unknown'; result: string }
    ): Promise<HumanRequest> {
        this.effects += 1
        throw new Error('Project reference reads must not finish approved effects.')
    }
}

interface ProviderRequest {
    model: string
    tools: { function: { name: string } }[]
    messages: { role: string; content: string; tool_call_id?: string }[]
}

/**
 * Encodes one provider-native tool call or final answer for the actual streaming adapter.
 * @param value - Exact selected tool invocation or plain final text.
 * @returns A real SSE Response parsed by the runtime provider adapter.
 */
function providerResponse(value: { name: string; id: string; arguments: Record<string, unknown> } | string): Response {
    const delta =
        typeof value === 'string'
            ? { content: value }
            : {
                  tool_calls: [
                      {
                          index: 0,
                          id: value.id,
                          type: 'function',
                          function: { name: value.name, arguments: JSON.stringify(value.arguments) },
                      },
                  ],
              }
    return new Response(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: typeof value === 'string' ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } }
    )
}

it('automatically lists, searches and reads project references through the durable loop with a human-intervention port, then replays canonical results', async () => {
    const journal = new DurableProjectJournal()
    const humanLoop = new NoProjectApproval()
    const documentId = '123e4567-e89b-42d3-a456-426614174000'
    const sourceUrl = `/rag/${documentId}?projectFolderId=123e4567-e89b-42d3-a456-426614174001&chunk=1`
    const portCalls: string[] = []
    let requests = 0
    let forbiddenActions = 0
    const input: CollaborationRunInput = {
        scope: { workspaceId: 'private-workspace', userId: 'private-owner' },
        sourceId: 'project-conversation',
        sessionId: 'project-durable-session',
        triggerId: 'project-human-trigger',
        runId: 'project-execution-attempt',
        messageId: 'project-owner-message',
        content: '请查阅项目资料，告诉我需求文档里的暗号，并标明来源。',
        connection: { apiKey: 'private-owner-provider-key', baseUrl: 'https://example.com/v1', model: 'owner-model-route' },
        journal,
        humanLoop,
        actions: {
            slots: [],
            /**
             * Reads an empty business-effect ledger for this ordinary private project chat.
             * @returns No collaboration effects.
             */
            async readCommitted() {
                return []
            },
            /**
             * Rejects unexpected outgoing business actions during document lookup.
             * @returns Never.
             * @throws Error for any attempted external or collaboration effect.
             */
            async execute() {
                forbiddenActions += 1
                throw new Error('No outgoing action is authorized for project reference lookup.')
            },
        },
        projectKnowledge: {
            /**
             * Lists the one owner-authorized project document through an explicit isolated read port.
             * @param page - Actual model-requested file page.
             * @returns Safe project-only metadata.
             */
            async list(page) {
                expect(page).toBe(1)
                portCalls.push('list')
                return { referenceOnly: true, hasMore: false, documents: [{ documentId, fileName: '需求资料.md', status: 'ready' }] }
            },
            /**
             * Searches only the pre-authorized project through an explicit isolated read port.
             * @param query - Actual model keyword.
             * @param page - Actual bounded discovery page.
             * @returns One source match and its actual citation URL.
             */
            async search(query, page) {
                expect(query).toBe('暗号')
                expect(page).toBe(1)
                portCalls.push('search')
                return { referenceOnly: true, hasMore: false, matches: [{ documentId, fileName: '需求资料.md', sourceUrl }] }
            },
            /**
             * Reads exact material text from the authorized project fixture.
             * @param id - Source obtained from the actual prior search result.
             * @param page - Actual model-requested chunk page.
             * @returns Inert material text with source metadata.
             */
            async read(id, page) {
                expect(id).toBe(documentId)
                expect(page).toBe(1)
                portCalls.push('read')
                return { referenceOnly: true, fileName: '需求资料.md', chunks: [{ content: '本项目需求暗号是水杉-742。', sourceUrl }] }
            },
        },
        signal: new AbortController().signal,
    }
    const runtime = await createCollaborationRuntime({
        /**
         * Drives real provider parsing and classified tool execution through four native rounds.
         * @param _url - Validated private provider URL.
         * @param init - Actual model request including tool results.
         * @returns The next native function call or sourced final answer.
         */
        fetch: async (_url, init) => {
            const request = JSON.parse(String(init?.body)) as ProviderRequest
            requests += 1
            expect(request.model).toBe('owner-model-route')
            expect(request.tools.map(tool => tool.function.name)).toEqual(
                expect.arrayContaining(['ask-human', 'project-knowledge-list', 'project-knowledge-search', 'project-knowledge-read'])
            )
            if (requests === 1) return providerResponse({ name: 'project-knowledge-list', id: 'project-list-call', arguments: { page: 1 } })
            if (requests === 2) {
                const listed = JSON.parse(request.messages.find(item => item.tool_call_id === 'project-list-call')!.content)
                expect(listed.documents[0].documentId).toBe(documentId)
                return providerResponse({
                    name: 'project-knowledge-search',
                    id: 'project-search-call',
                    arguments: { query: '暗号', page: 1 },
                })
            }
            if (requests === 3) {
                const searched = JSON.parse(request.messages.find(item => item.tool_call_id === 'project-search-call')!.content)
                expect(searched.matches[0].documentId).toBe(documentId)
                return providerResponse({ name: 'project-knowledge-read', id: 'project-read-call', arguments: { documentId, page: 1 } })
            }
            expect(requests).toBe(4)
            const read = JSON.parse(request.messages.find(item => item.tool_call_id === 'project-read-call')!.content)
            expect(read.chunks[0].content).toContain('水杉-742')
            return providerResponse(`项目暗号是水杉-742。[${read.fileName}](${read.chunks[0].sourceUrl})`)
        },
    })
    try {
        const result = await runtime.run(input)
        expect(result).toMatchObject({ status: 'complete', replayed: false })
        expect(result.content).toBe(`项目暗号是水杉-742。[需求资料.md](${sourceUrl})`)
        expect(portCalls).toEqual(['list', 'search', 'read'])
        expect(requests).toBe(4)
        expect(humanLoop.waits).toBe(0)
        expect(humanLoop.effects).toBe(0)
        expect(forbiddenActions).toBe(0)
        expect(journal.value?.events.filter(event => event.type === 'tool/call')).toHaveLength(3)
        expect(journal.value?.events.filter(event => event.type === 'tool/result')).toHaveLength(3)
        expect(JSON.stringify(journal.value)).not.toContain('private-owner-provider-key')
        expect(JSON.stringify(journal.value)).not.toContain('"humanLoopState":"pending"')
    } finally {
        await runtime.dispose()
    }
    const restarted = await createCollaborationRuntime({
        /**
         * Rejects model I/O when restoring a canonically completed delivery.
         * @returns Never.
         * @throws Error if terminal replay incorrectly invokes a provider.
         */
        fetch: async () => {
            throw new Error('Completed project lookup must replay without provider I/O.')
        },
    })
    try {
        expect(await restarted.run(input)).toMatchObject({
            status: 'complete',
            replayed: true,
            content: `项目暗号是水杉-742。[需求资料.md](${sourceUrl})`,
        })
        expect(portCalls).toEqual(['list', 'search', 'read'])
        expect(humanLoop.waits).toBe(0)
    } finally {
        await restarted.dispose()
    }
})
