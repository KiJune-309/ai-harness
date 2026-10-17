import type { AgentCatalog } from '@ai-harness/contracts'
import type { ApiConfig } from './config.js'

/**
 * Describe server-configured model routes and executable built-in capabilities.
 * @param config - Trusted DeepSeek connection settings.
 * @param configured - Whether the shared runtime is available.
 * @returns A public catalog containing no credentials or arbitrary endpoints.
 */
export function createAgentCatalog(config: ApiConfig, configured: boolean): AgentCatalog {
    const labels: Record<string, string> = { 'deepseek-flash': 'DeepSeek Flash', 'deepseek-v4-pro': 'DeepSeek V4 Pro' }
    const models = [...new Set([config.model, ...(config.agentModels ?? ['deepseek-flash', 'deepseek-v4-pro'])])]
    return {
        defaultModelId: config.model,
        models: models.map(id => ({ id, label: labels[id] ?? id, provider: 'DeepSeek', available: configured })),
        tools: [
            { id: 'calculator', label: '计算器', description: '准确计算算术表达式，支持括号、加减乘除与取余。' },
            { id: 'current-time', label: '当前时间', description: '查询当前日期与时间，支持指定时区。' },
        ],
    }
}
