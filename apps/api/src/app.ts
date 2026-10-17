import 'reflect-metadata'
import { createChatRuntime, type ChatRuntime } from '@ai-harness/chat-runtime'
import { createChatStore, type ChatStore } from '@ai-harness/db'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ChatGuard } from './auth.js'
import { ChatService } from './chat-service.js'
import { ChatController } from './controller.js'
import type { ApiConfig } from './config.js'
import { createAgentCatalog } from './agent-catalog.js'
import { AgentService } from './agent-service.js'
import { AgentController } from './agent-controller.js'
import { TaskController } from './task-controller.js'
import { ProjectController } from './project-controller.js'
import { TemplateController } from './template-controller.js'

export interface ApiResources {
    store?: ChatStore
    runtime?: ChatRuntime
    logger?: false
}

/**
 * Initialize one Nest application and its shared Cordis and database resources.
 * @param config - Trusted startup configuration.
 * @param resources - Optional explicit resources for integration tests.
 * @returns An initialized app whose close method releases all shared resources.
 * @throws Error when initialization fails, after releasing already-opened resources.
 */
export async function createApiApp(config: ApiConfig, resources: ApiResources = {}): Promise<NestExpressApplication> {
    const store = resources.store ?? (await createChatStore({ databaseUrl: config.databaseUrl, allowMemory: config.allowMemory }))
    let runtime = resources.runtime
    try {
        if (!runtime && config.apiKey)
            runtime = await createChatRuntime({
                apiKey: config.apiKey,
                baseUrl: config.baseUrl,
                model: config.model,
                systemPrompt: config.systemPrompt,
                maxTokens: config.maxTokens,
                timeoutMs: config.timeoutMs,
            })
        const agents = new AgentService(store.agents, createAgentCatalog(config, Boolean(runtime)))
        const service = new ChatService(store, runtime, config, agents)
        @Module({
            controllers: [ChatController, AgentController, TaskController, ProjectController, TemplateController],
            providers: [
                { provide: ChatService, useValue: service },
                { provide: AgentService, useValue: agents },
            ],
        })
        class ApiModule {}
        const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
            bodyParser: false,
            logger: resources.logger,
            abortOnError: false,
        })
        app.useGlobalGuards(new ChatGuard(config))
        app.useBodyParser('json', { limit: '256kb' })
        app.setGlobalPrefix('api')
        app.enableShutdownHooks()
        const close = app.close.bind(app)
        let closing: Promise<void> | undefined
        /**
         * Drain chats before closing HTTP connections and process resources.
         * @returns A shared promise so repeated shutdown signals are safe.
         */
        app.close = (): Promise<void> => {
            closing ??= service.close().finally(() => close())
            return closing
        }
        await app.init()
        return app
    } catch (error) {
        await runtime?.dispose()
        await store.close()
        throw error
    }
}
