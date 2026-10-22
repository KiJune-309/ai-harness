import { describe, expect, it } from 'vitest'
import type { ChatMessage, CollaborationDispatch } from '@ai-harness/contracts'
import { collaborationDispatchAnchor } from '../../lib/collaboration-timeline'

const draft: CollaborationDispatch = {
    id: 'da74c95e-ae36-4b36-8018-6fedeb019b1c',
    version: 1,
    source: { kind: 'conversation', id: 'c4c42662-a9dc-489b-82a7-501f4bc8b7c0' },
    kind: 'message',
    recipientId: 'c5f1ec31-dacd-4eae-9661-7abdf84b6e95',
    recipientName: '张三',
    content: '已核对的完整正文。',
    status: 'sent',
    createdAt: '2026-10-22T06:00:01.000Z',
    updatedAt: '2026-10-22T06:00:05.000Z',
}

/**
 * Builds a visible ordinary message at an explicit point in the saved timeline.
 * @param id - Immutable saved message identity.
 * @param second - Timestamp offset within the fixture minute.
 * @param role - Real speaker role.
 * @returns A complete ordinary message with content independent of dispatch matching.
 */
function message(id: string, second: number, role: ChatMessage['role'] = 'assistant'): ChatMessage {
    return {
        id,
        role,
        content: '相同正文不作为关联依据。',
        status: 'complete',
        createdAt: `2026-10-22T06:00:${String(second).padStart(2, '0')}.000Z`,
    }
}

describe('saved dispatch positions in ordinary chat', () => {
    it('uses the exact delivered business identity despite duplicate content, newer replies and changed receipt timestamps', () => {
        const sent: CollaborationDispatch = {
            ...draft,
            result: { requestId: draft.id, messageId: 'sent-message', dispatchStatus: 'sent' },
        }
        const messages = [
            message('prompt', 0, 'user'),
            message('preview', 2),
            { ...message('sent-message', 5), kind: 'relay' as const },
            message('new-prompt', 6, 'user'),
            message('new-answer', 7),
        ]
        expect(collaborationDispatchAnchor(sent, messages)).toBe('sent-message')
        expect(collaborationDispatchAnchor({ ...sent, updatedAt: '2026-10-22T07:00:00.000Z' }, messages)).toBe('sent-message')
    })

    it('waits for an exact delivered message to enter history instead of placing its receipt under an unrelated latest reply', () => {
        const sent: CollaborationDispatch = { ...draft, result: { requestId: draft.id, messageId: 'not-loaded', dispatchStatus: 'sent' } }
        expect(collaborationDispatchAnchor(sent, [message('unrelated', 20)])).toBeNull()
    })

    it('keeps historical receipts in their draft stage when new exchanges and incoming relays are appended', () => {
        const original = [message('prompt', 0, 'user'), { ...message('incoming', 2), kind: 'relay' as const }, message('preview', 3)]
        expect(collaborationDispatchAnchor(draft, original)).toBe('preview')
        expect(collaborationDispatchAnchor(draft, [...original, message('next-prompt', 6, 'user'), message('next-reply', 7)])).toBe(
            'preview'
        )
    })

    it('does not cross the next user input while locating cancelled drafts with no saved assistant reply', () => {
        const messages = [message('prompt', 0, 'user'), message('next-prompt', 2, 'user'), message('next-reply', 3)]
        expect(collaborationDispatchAnchor({ ...draft, status: 'cancelled' }, messages)).toBe('prompt')
    })

    it('maps a historical communication event by exact identity when the event itself is a chat message', () => {
        const historical: CollaborationDispatch = { ...draft, result: { requestId: draft.id, eventId: 'event-message' } }
        expect(collaborationDispatchAnchor(historical, [message('event-message', 3), message('later', 9)])).toBe('event-message')
    })
})
