import 'reflect-metadata'
import { createChatRuntime, testModelConnection, type ChatRuntime } from '@ai-harness/chat-runtime'
import { createChatStore, type ChatStore } from '@ai-harness/db'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ChatGuard } from './auth.js'
import { ChatService } from './chat-service.js'
import { ProjectFolderService } from './project-folder-service.js'
import { ProjectFolderController } from './project-folder-controller.js'
import { ChatController } from './controller.js'
import type { ApiConfig } from './config.js'
import { createAgentCatalog } from './agent-catalog.js'
import { AgentService } from './agent-service.js'
import { AgentController } from './agent-controller.js'
import { TaskController } from './task-controller.js'
import { ProjectController } from './project-controller.js'
import { TemplateController } from './template-controller.js'
import { AccountService, type AccountModelTester } from './account-service.js'
import { AccountController } from './account-controller.js'
import { createKnowledgeObjectStore, type KnowledgeObjectStore } from '@ai-harness/chat-runtime/knowledge'
import { KnowledgeController, KnowledgeUploadGuard } from './knowledge-controller.js'
import { KnowledgeService, type KnowledgeProcessor, type KnowledgeWorkerOptions } from './knowledge-service.js'
import { EmbeddingService, type EmbeddingGenerator } from './embedding-service.js'
import { EmbeddingController } from './embedding-controller.js'
import { VectorService, type VectorWorkerOptions } from './vector-service.js'
import { VectorController } from './vector-controller.js'
import { createCollaborationRuntime, type CollaborationRuntime } from '@ai-harness/chat-runtime/collaboration'
import { CollaborationService } from './collaboration-service.js'
import { CollaborationController } from './collaboration-controller.js'
import { CollaborationWorker } from './collaboration-worker.js'
import { WorkspaceService } from './workspace-service.js'
import { WorkspaceController } from './workspace-controller.js'
import { WorkflowTemplateService } from './workflow-template-service.js'
import { WorkflowTemplateController, TemplateCatalogController } from './workflow-template-controller.js'
import { SkillService } from './skill-service.js'
import { SkillController } from './skill-controller.js'

export interface ApiResources {
    collaborationRuntime?: CollaborationRuntime
    collaborationWorkerOptions?: { intervalMs?: number; leaseMs?: number; enabled?: boolean }
    embeddingGenerator?: EmbeddingGenerator
    vectorWorkerOptions?: VectorWorkerOptions
    knowledgeObjectStore?: KnowledgeObjectStore
    knowledgeProcessor?: KnowledgeProcessor
    knowledgeWorkerOptions?: KnowledgeWorkerOptions
    store?: ChatStore
    runtime?: ChatRuntime
    logger?: false
    testAccountModel?: AccountModelTester
}

/**
 * Initialize one Nest application and its shared Cordis and database resources.
 * @param config - Trusted startup configuration.
 * @param resources - Optional explicit resources for integration tests.
 * @returns An initialized app whose close method releases all shared resources.
 * @throws Error when initialization fails, after releasing already-opened resources.
 */
export async function createApiApp(config: ApiConfig, resources: ApiResources = {}): Promise<NestExpressApplication> {
    const store = resources.store ?? (await createChatStore({ databaseUrl: config.databaseUrl }))
    let runtime = resources.runtime
    let knowledgeObjects = resources.knowledgeObjectStore
    let knowledge: KnowledgeService | undefined
    let vectors: VectorService | undefined
    let collaborationWorker: CollaborationWorker | undefined
    let durableRuntime = resources.collaborationRuntime
    try {
        if (!knowledgeObjects && config.knowledgeObjectStorage)
            knowledgeObjects = await createKnowledgeObjectStore(config.knowledgeObjectStorage)
        if (!runtime)
            runtime = await createChatRuntime({
                apiKey: config.apiKey,
                baseUrl: config.baseUrl,
                model: config.model,
                systemPrompt: config.systemPrompt,
                maxTokens: config.maxTokens,
                timeoutMs: config.timeoutMs,
                allowedLocalOrigins: config.allowedLocalOrigins,
            })
        const accounts = new AccountService(
            store.accounts,
            config,
            resources.testAccountModel ??
                ((connection, signal) => testModelConnection(connection, { allowedLocalOrigins: config.allowedLocalOrigins, signal })),
            store.workspaces
        )
        const skills = new SkillService(store.skills)
        const workspaces = new WorkspaceService(store.workspaces)
        const agents = new AgentService(store.agents, createAgentCatalog(config, Boolean(config.apiKey)), accounts, store.skills)
        const embeddings = new EmbeddingService(store.embeddings, config, accounts, resources.embeddingGenerator)
        vectors = new VectorService(store.embeddings, embeddings, resources.vectorWorkerOptions)
        const folders = new ProjectFolderService(store)
        const collaboration = new CollaborationService(store, accounts, agents, config)
        if (store.collaboration && resources.collaborationWorkerOptions?.enabled !== false && !durableRuntime)
            durableRuntime = await createCollaborationRuntime({
                apiKey: config.apiKey,
                baseUrl: config.baseUrl,
                model: config.model,
                systemPrompt: config.systemPrompt,
                maxTokens: config.maxTokens,
                timeoutMs: config.timeoutMs,
                allowedLocalOrigins: config.allowedLocalOrigins,
            })
        collaborationWorker = new CollaborationWorker(
            collaboration,
            durableRuntime,
            resources.collaborationWorkerOptions?.intervalMs ?? config.collaborationPollMs,
            resources.collaborationWorkerOptions?.leaseMs ?? config.collaborationLeaseMs,
            config.collaborationWaitMs,
            folders
        )
        const service = new ChatService(
            store,
            runtime,
            config,
            agents,
            accounts,
            collaboration,
            () => collaborationWorker!.close(),
            folders,
            Boolean(durableRuntime && store.collaboration)
        )
        const workflowTemplates = new WorkflowTemplateService(collaboration, service)
        knowledge = new KnowledgeService(
            store.knowledge,
            knowledgeObjects,
            resources.knowledgeProcessor,
            resources.knowledgeWorkerOptions,
            store.projectFolders
        )
        @Module({
            controllers: [
                ChatController,
                ProjectFolderController,
                AgentController,
                SkillController,
                TaskController,
                ProjectController,
                TemplateController,
                WorkflowTemplateController,
                TemplateCatalogController,
                AccountController,
                WorkspaceController,
                KnowledgeController,
                EmbeddingController,
                VectorController,
                CollaborationController,
            ],
            providers: [
                { provide: WorkflowTemplateService, useValue: workflowTemplates },
                { provide: CollaborationService, useValue: collaboration },
                { provide: CollaborationWorker, useValue: collaborationWorker },
                { provide: EmbeddingService, useValue: embeddings },
                { provide: VectorService, useValue: vectors },
                { provide: KnowledgeService, useValue: knowledge },
                KnowledgeUploadGuard,
                { provide: ChatService, useValue: service },
                { provide: ProjectFolderService, useValue: folders },
                { provide: AgentService, useValue: agents },
                { provide: SkillService, useValue: skills },
                { provide: AccountService, useValue: accounts },
                { provide: WorkspaceService, useValue: workspaces },
                { provide: 'ACCOUNT_CONFIG', useValue: config },
            ],
        })
        class ApiModule {}
        const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
            bodyParser: false,
            logger: resources.logger,
            abortOnError: false,
        })
        app.useGlobalGuards(new ChatGuard(config, accounts, workspaces))
        // Shared text artifacts allow 128,000 Unicode characters; byte limits include UTF-8 and JSON escaping.
        app.useBodyParser('json', { limit: '1mb' })
        app.setGlobalPrefix('api')
        app.enableShutdownHooks()
        // Nest destroys knowledge workers before ChatService closes the shared pool in application shutdown.
        await app.init()
        return app
    } catch (error) {
        await collaborationWorker?.close()
        if (!collaborationWorker) await durableRuntime?.dispose()
        await vectors?.close()
        if (knowledge) await knowledge.close()
        else await knowledgeObjects?.close()
        await runtime?.dispose()
        await store.close()
        throw error
    }
}
