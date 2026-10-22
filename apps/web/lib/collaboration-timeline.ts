import type { ChatMessage, CollaborationDispatch } from '@ai-harness/contracts'

/**
 * Places a saved dispatch receipt beside its business message or original draft stage.
 * @param draft - Persisted dispatch, including any exact delivered-message identity.
 * @param messages - Visible messages in their saved conversation order.
 * @returns The owning message identifier, or null while its exact message is not visible.
 */
export function collaborationDispatchAnchor(draft: CollaborationDispatch, messages: readonly ChatMessage[]): string | null {
    if (draft.result?.messageId) return messages.find(message => message.id === draft.result?.messageId)?.id ?? null
    if (draft.result?.eventId) {
        const eventMessage = messages.find(message => message.id === draft.result?.eventId)
        if (eventMessage) return eventMessage.id
    }
    // Historical/cancelled drafts have no public trigger ID. Their immutable creation time bounds the original stage.
    const createdAt = Date.parse(draft.createdAt)
    if (!Number.isFinite(createdAt)) return null
    const nextInput = messages.findIndex(message => message.role === 'user' && Date.parse(message.createdAt) > createdAt)
    const stage = nextInput === -1 ? messages : messages.slice(0, nextInput)
    const reply = stage.find(message => message.role === 'assistant' && !message.kind && Date.parse(message.createdAt) >= createdAt)
    return reply?.id ?? stage.findLast(message => Date.parse(message.createdAt) <= createdAt)?.id ?? null
}
