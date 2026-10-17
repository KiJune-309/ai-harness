import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateTask, PersonalTask, UpdateTaskStatus } from '@ai-harness/contracts'
import { requestChatResponse, streamChatRequest } from '../../lib/chat-client'
import {
    cancelTask,
    createTask,
    getTask,
    listTasks,
    startTask,
    streamTaskMessage,
    updateTaskStatus,
    updateTaskProject,
    type TaskStreamEvent,
} from '../../lib/task-client'

vi.mock('../../lib/chat-client', () => ({ streamChatRequest: vi.fn(), requestChatResponse: vi.fn() }))

const id = 'a77f40d3-4147-4161-a4a9-d65cb2a7a5bf'
const requestId = '42b715b8-4aad-4c9f-9f41-9c90a9b9814b'
const createdAt = '2026-10-17T08:00:00.000Z'
const input: CreateTask = { requestId: id, title: '比较三个候选方案', goal: '比较成本与维护难度，给出选择依据。' }
const task: PersonalTask = {
    id,
    title: input.title,
    task: { goal: input.goal, status: 'not-started', started: false },
    agent: {
        id: 'f55e9ba7-d97b-4c6d-9000-6048a1839f54',
        name: '通用助手',
        description: '',
        modelId: 'deepseek-flash',
        systemPrompt: '清楚、准确地回答。',
        toolIds: [],
        openingMessages: [],
        createdAt,
        updatedAt: createdAt,
    },
    messages: [],
    createdAt,
    updatedAt: createdAt,
}

beforeEach(() => {
    vi.mocked(streamChatRequest).mockReset()
    vi.mocked(requestChatResponse)
        .mockReset()
        .mockImplementation(async (path, options) => fetch(`/api/chat${path}`, options))
})
afterEach(() => vi.unstubAllGlobals())

describe('personal task client', () => {
    it('loads only fully validated task records without caching the user collection', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ tasks: [task] }))
        vi.stubGlobal('fetch', fetchMock)
        const signal = new AbortController().signal

        await expect(listTasks(signal)).resolves.toEqual([task])
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/chat/tasks', { cache: 'no-store', signal })
        expect(requestChatResponse).toHaveBeenCalledExactlyOnceWith('/tasks', { cache: 'no-store', signal })
    })

    it('rejects a chat-shaped record without mandatory task metadata or frozen agent', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ tasks: [{ ...task, task: undefined }] }))
            .mockResolvedValueOnce(Response.json({ tasks: [{ ...task, agent: undefined }] }))
        vi.stubGlobal('fetch', fetchMock)

        await expect(listTasks()).rejects.toThrow('无效的数据')
        await expect(listTasks()).rejects.toThrow('无效的数据')
    })

    it('rejects malformed collections instead of showing them as an empty list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ tasks: null })))

        await expect(listTasks()).rejects.toThrow('无效的列表')
    })

    it('encodes an untrusted identifier as one stable URL segment', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(task))
        vi.stubGlobal('fetch', fetchMock)

        await expect(getTask('path/segment?query')).resolves.toEqual(task)
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/chat/tasks/path%2Fsegment%3Fquery', {
            cache: 'no-store',
            signal: undefined,
        })
    })

    it('retains the caller creation request identifier and normalizes title and goal', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(task))
        vi.stubGlobal('fetch', fetchMock)

        await expect(createTask({ ...input, title: ` ${input.title} `, goal: ` ${input.goal} ` })).resolves.toEqual(task)
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/chat/tasks', {
            cache: 'no-store',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal: undefined,
        })
        expect(streamChatRequest).not.toHaveBeenCalled()
    })

    it('rejects invalid names, goals, identifiers, and lengths before creating any resource', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        await expect(createTask({ ...input, title: ' ' })).rejects.toThrow()
        await expect(createTask({ ...input, goal: ' ' })).rejects.toThrow()
        await expect(createTask({ ...input, title: 'a'.repeat(121) })).rejects.toThrow()
        await expect(createTask({ ...input, goal: 'a'.repeat(32001) })).rejects.toThrow()
        await expect(createTask({ ...input, requestId: 'invalid' })).rejects.toThrow()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('saves explicit work status and restore operations without mixing their payloads', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => Response.json(task))
        vi.stubGlobal('fetch', fetchMock)

        await updateTaskStatus(id, { status: 'needs-input' })
        await updateTaskStatus(id, { restore: true })

        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            `/api/chat/tasks/${id}/status`,
            expect.objectContaining({ method: 'PUT', body: JSON.stringify({ status: 'needs-input' }) })
        )
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            `/api/chat/tasks/${id}/status`,
            expect.objectContaining({ method: 'PUT', body: JSON.stringify({ restore: true }) })
        )
    })

    it('rejects conflicting status instructions before attempting a mutation', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        await expect(updateTaskStatus(id, { status: 'completed', restore: true } as UpdateTaskStatus)).rejects.toThrow()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('starts with only a stable request ID so the browser cannot replace the saved goal', async () => {
        vi.mocked(streamChatRequest).mockImplementation(async (_path, _body, onEvent) => {
            onEvent({ type: 'done', conversation: task })
        })
        const events: TaskStreamEvent[] = []
        const signal = new AbortController().signal

        await startTask(id, requestId, event => events.push(event), signal)

        expect(streamChatRequest).toHaveBeenCalledWith(`/tasks/${id}/start`, { requestId }, expect.any(Function), signal)
        expect(events).toEqual([{ type: 'done', conversation: task }])
    })

    it('reuses the shared SSE decoder for follow-ups and preserves reasoning and terminal state', async () => {
        const scripted: TaskStreamEvent[] = [
            { type: 'start', conversationId: id, requestId },
            { type: 'reasoning', text: '先比较目标' },
            { type: 'delta', text: '方案一' },
            { type: 'cancelled', conversation: task },
        ]
        vi.mocked(streamChatRequest).mockImplementation(async (_path, _body, onEvent) => {
            for (const event of scripted) onEvent(event)
        })
        const events: TaskStreamEvent[] = []
        const signal = new AbortController().signal

        await streamTaskMessage(id, ' 继续比较维护成本 ', requestId, event => events.push(event), signal)

        expect(streamChatRequest).toHaveBeenCalledWith(
            `/tasks/${id}/messages`,
            { content: '继续比较维护成本', requestId },
            expect.any(Function),
            signal
        )
        expect(events).toEqual(scripted)
    })

    it('rejects malformed terminal snapshots before they replace task state', async () => {
        vi.mocked(streamChatRequest).mockImplementation(async (_path, _body, onEvent) => {
            onEvent({ type: 'done', conversation: { ...task, task: undefined } })
        })

        await expect(startTask(id, requestId, vi.fn(), new AbortController().signal)).rejects.toThrow('无效的数据')
    })

    it('preserves shared HTTP and truncated-stream failures for the UI recovery path', async () => {
        vi.mocked(streamChatRequest).mockRejectedValue(new Error('连接已中断，回答可能不完整。'))

        await expect(streamTaskMessage(id, '继续', requestId, vi.fn(), new AbortController().signal)).rejects.toThrow('连接已中断')
    })

    it('does not call the stream with blank follow-ups or invalid request identifiers', async () => {
        await expect(streamTaskMessage(id, ' ', requestId, vi.fn(), new AbortController().signal)).rejects.toThrow()
        await expect(startTask(id, 'invalid', vi.fn(), new AbortController().signal)).rejects.toThrow()
        expect(streamChatRequest).not.toHaveBeenCalled()
    })

    it('cancels only the requested task turn and validates its saved partial history', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(task))
        vi.stubGlobal('fetch', fetchMock)

        await expect(cancelTask(id, requestId)).resolves.toEqual(task)
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
            `/api/chat/tasks/${id}/cancel`,
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ requestId }) })
        )
    })

    it('preserves useful conflict messages without changing the returned task snapshot', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(Response.json({ message: '这个任务正在生成回复，请稍后修改状态。' }, { status: 409 }))
        )

        await expect(updateTaskStatus(id, { status: 'completed' })).rejects.toThrow('这个任务正在生成回复')
    })

    it('returns a readable fallback when a proxy sends a non-JSON error page', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>unavailable</html>', { status: 502 })))

        await expect(getTask(id)).rejects.toThrow('任务服务请求失败（502）')
    })

    it('preserves a shared network failure message so creation can recover without a synthetic saved task', async () => {
        const failure = new Error('网络连接失败，请检查网络后重试。')
        vi.mocked(requestChatResponse).mockRejectedValueOnce(failure)

        await expect(createTask(input)).rejects.toBe(failure)
        expect(requestChatResponse).toHaveBeenCalledExactlyOnceWith(
            '/tasks',
            expect.objectContaining({ method: 'POST', body: JSON.stringify(input) })
        )
    })

    it('preserves timeout feedback and reuses the same creation payload when the caller retries', async () => {
        const failure = new Error('请求等待超时，请检查网络后重试。')
        vi.mocked(requestChatResponse).mockRejectedValueOnce(failure).mockResolvedValueOnce(Response.json(task))

        await expect(createTask(input)).rejects.toBe(failure)
        await expect(createTask(input)).resolves.toEqual(task)

        const payloads = vi.mocked(requestChatResponse).mock.calls.map(([, options]) => options?.body)
        expect(payloads).toEqual([JSON.stringify(input), JSON.stringify(input)])
    })

    it('keeps shared timeout and caller-cancellation failures visible for status and load recovery', async () => {
        const timeout = new Error('请求等待超时，请检查网络后重试。')
        const cancelled = new DOMException('The request was aborted', 'AbortError')
        vi.mocked(requestChatResponse).mockRejectedValueOnce(timeout).mockRejectedValueOnce(cancelled)
        const signal = new AbortController().signal

        await expect(updateTaskStatus(id, { status: 'completed' })).rejects.toBe(timeout)
        await expect(getTask(id, signal)).rejects.toBe(cancelled)
        expect(requestChatResponse).toHaveBeenLastCalledWith(`/tasks/${id}`, { cache: 'no-store', signal })
    })
    it('retains initial project creation parameters and returns only server-confirmed membership', async () => {
        const projectId = 'c58ded0f-ddf6-4218-b739-7d719abed2bc'
        const grouped = { ...task, task: { ...task.task, projectId, creationProjectId: projectId } }
        const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(grouped)).mockResolvedValueOnce(Response.json(task))
        vi.stubGlobal('fetch', fetchMock)
        await expect(createTask({ ...input, projectId })).resolves.toEqual(grouped)
        await expect(updateTaskProject(id, { projectId: null })).resolves.toEqual(task)
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            '/api/chat/tasks',
            expect.objectContaining({ body: JSON.stringify({ ...input, projectId }) })
        )
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            `/api/chat/tasks/${id}/project`,
            expect.objectContaining({ method: 'PUT', body: '{"projectId":null}' })
        )
    })

    it('rejects invalid associations and propagates active-generation conflicts', async () => {
        await expect(updateTaskProject(id, { projectId: 'bad' })).rejects.toThrow()
        expect(requestChatResponse).not.toHaveBeenCalled()
        vi.mocked(requestChatResponse).mockResolvedValueOnce(
            Response.json({ message: '这个任务正在处理中，请等待当前操作结束。' }, { status: 409 })
        )
        await expect(updateTaskProject(id, { projectId: requestId })).rejects.toThrow('正在处理中')
    })
})
