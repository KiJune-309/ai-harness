import type { CreateProjectFolder, ProjectFolder } from '@ai-harness/contracts'
import type { ProjectKnowledgePort } from '@ai-harness/chat-runtime'
import { ProjectFolderAccessError, ProjectFolderConflictError, type ChatScope, type ChatStore } from '@ai-harness/db'
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'

/** Coordinates private project folders and fixed-scope model reference access. */
export class ProjectFolderService {
    /**
     * Retains the application-owned persistent stores.
     * @param store - Shared PostgreSQL storage.
     */
    constructor(private readonly store: ChatStore) {}

    /**
     * Translates storage failures without exposing SQL or private configuration.
     * @param action - Authorized persistent operation.
     * @returns The actual operation result.
     * @throws HttpException for conflicts, absent authorization or unavailable persistence.
     */
    private async persist<T>(action: () => Promise<T>): Promise<T> {
        try {
            if (!this.store.projectFolders) throw new ServiceUnavailableException('项目服务暂时不可用。')
            return await action()
        } catch (error) {
            if (error instanceof ProjectFolderConflictError) throw new ConflictException('此创建操作已用于其他项目名称。')
            if (error instanceof ProjectFolderAccessError) throw new NotFoundException('未找到该项目。')
            if (error instanceof NotFoundException || error instanceof ServiceUnavailableException) throw error
            throw new ServiceUnavailableException('项目服务暂时无法保存或读取，请稍后重试。')
        }
    }

    /**
     * Lists only folders owned in the authenticated workspace.
     * @param scope - Trusted account and workspace.
     * @returns Persistent folders in update order.
     */
    list(scope: ChatScope): Promise<ProjectFolder[]> {
        return this.persist(() => this.store.projectFolders!.list(scope))
    }

    /**
     * Creates or replays one explicitly requested private folder.
     * @param scope - Trusted account and workspace.
     * @param input - Validated name and stable action identifier.
     * @returns The saved folder.
     */
    create(scope: ChatScope, input: CreateProjectFolder): Promise<ProjectFolder> {
        return this.persist(() => this.store.projectFolders!.create(scope, input))
    }

    /**
     * Reads a folder through current owner and workspace authorization.
     * @param scope - Trusted account and workspace.
     * @param id - Folder UUID.
     * @returns The authorized folder.
     * @throws NotFoundException when the folder is missing or inaccessible.
     */
    async get(scope: ChatScope, id: string): Promise<ProjectFolder> {
        const folder = await this.persist(() => this.store.projectFolders!.get(scope, id))
        if (!folder) throw new NotFoundException('未找到该项目。')
        return folder
    }

    /**
     * Resolves a read-only port from the actual saved conversation, never from model arguments.
     * @param scope - Verified owner and workspace.
     * @param conversationId - Actual runtime source conversation.
     * @returns Fixed-scope reference capabilities, or undefined outside a project.
     */
    async knowledgePort(scope: ChatScope, conversationId: string): Promise<ProjectKnowledgePort | undefined> {
        const source = await this.store.get(scope, conversationId)
        if (!source?.projectFolderId) return undefined
        const folderId = source.projectFolderId
        await this.get(scope, folderId)
        const store = this.store
        const folderRepository = this.store.projectFolders!
        /**
         * Revalidates current membership and immutable conversation ownership before each tool operation.
         * @returns The current authorized knowledge store.
         * @throws Error when the source or project is no longer available.
         */
        async function authorize() {
            if (store.workspaces && !(await store.workspaces.access(scope))) throw new NotFoundException('当前项目不可用。')
            const current = await store.get(scope, conversationId)
            if (current?.projectFolderId !== folderId) throw new NotFoundException('当前项目对话不可用。')
            if (!(await folderRepository.get(scope, folderId))) throw new NotFoundException('当前项目不可用。')
            if (!store.knowledge) throw new ServiceUnavailableException('项目资料暂时不可用。')
            return store.knowledge
        }
        /**
         * Produces a same-origin source reference without exposing private object storage.
         * @param documentId - Authorized material identity.
         * @param chunk - One-based chunk index.
         * @returns A navigable project-filtered source URL.
         */
        function sourceUrl(documentId: string, chunk: number): string {
            return `/rag/${encodeURIComponent(documentId)}?projectFolderId=${encodeURIComponent(folderId)}&chunk=${chunk}`
        }
        return {
            /**
             * Enumerates project files independently of how many chunks newer documents contain.
             * @param page - One-based file page.
             * @returns Safe file metadata and exact pagination, including unavailable processing states.
             */
            async list(page) {
                try {
                    const knowledge = await authorize()
                    const result = await knowledge.list(scope, { projectFolderId: folderId, query: '', page, pageSize: 20 })
                    return {
                        referenceOnly: true,
                        page,
                        pageSize: 20,
                        total: result.total,
                        hasMore: page * 20 < result.total,
                        documents: result.documents.map(document => ({
                            documentId: document.id,
                            fileName: document.fileName,
                            status: document.status,
                            chunkCount: document.chunkCount,
                            sourceUrl: sourceUrl(document.id, 1),
                        })),
                    }
                } catch {
                    return { referenceOnly: true, unavailable: true, message: '当前项目资料列表暂时无法读取。' }
                }
            },
            /**
             * Finds bounded ready chunks in this exact private project.
             * @param query - Short literal query, or empty for discovery.
             * @param page - One-based bounded search page.
             * @returns Bounded inert reference snippets and citations.
             */
            async search(query, page = 1) {
                try {
                    const knowledge = await authorize()
                    const matches = await knowledge.searchProjectChunks(scope, folderId, {
                        query: query.trim().slice(0, 180),
                        offset: (page - 1) * 6,
                        limit: 7,
                    })
                    return {
                        referenceOnly: true,
                        page,
                        hasMore: page < 834 && matches.length > 6,
                        ...(page === 834 && matches.length > 6
                            ? { truncated: true, message: '分片搜索已达到分页上限，请用资料列表逐文件读取其余内容。' }
                            : {}),
                        matches: matches.slice(0, 6).map(match => ({
                            documentId: match.documentId,
                            fileName: match.fileName,
                            index: match.chunk.index,
                            excerpt: Array.from(match.chunk.content).slice(0, 1000).join(''),
                            sourceUrl: sourceUrl(match.documentId, match.chunk.index),
                        })),
                        ...(matches.length ? {} : { message: '当前项目没有已处理完成且匹配的资料，可用空查询查看其他可用片段。' }),
                    }
                } catch {
                    return { referenceOnly: true, matches: [], unavailable: true, message: '当前项目资料暂时无法读取，请稍后重试。' }
                }
            },
            /**
             * Reads a bounded page of a ready material from this exact project.
             * @param documentId - UUID previously obtained from reference search.
             * @param page - One-based page, four chunks per page.
             * @returns Reference text and source links, or an honest unavailable result.
             */
            async read(documentId, page) {
                try {
                    const knowledge = await authorize()
                    const record = await knowledge.get(scope, documentId, folderId)
                    if (!record || record.document.status !== 'ready')
                        return { referenceOnly: true, unavailable: true, message: '资料尚未处理完成或不属于当前项目。' }
                    const matches = await knowledge.searchProjectChunks(scope, folderId, {
                        query: '',
                        documentId,
                        offset: (page - 1) * 4,
                        limit: 4,
                    })
                    return {
                        referenceOnly: true,
                        documentId,
                        fileName: record.document.fileName,
                        page,
                        pageSize: 4,
                        total: record.document.chunkCount,
                        chunks: matches.map(match => ({ ...match.chunk, sourceUrl: sourceUrl(documentId, match.chunk.index) })),
                    }
                } catch {
                    return { referenceOnly: true, unavailable: true, message: '当前项目资料暂时无法读取，请稍后重试。' }
                }
            },
        }
    }
}
