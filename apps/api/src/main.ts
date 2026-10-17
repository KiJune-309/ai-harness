import { createApiApp } from './app.js'
import { readApiConfig } from './config.js'

/**
 * Start the HTTP API with process-owned Cordis services and server-only secrets.
 * @returns After the server is listening; resources remain owned by Nest shutdown.
 * @throws Error for invalid configuration or unavailable dependencies.
 */
async function main(): Promise<void> {
    const config = readApiConfig()
    const app = await createApiApp(config)
    try {
        await app.listen(config.port, config.host)
    } catch (error) {
        await app.close()
        throw error
    }
    console.log(`Chat API listening on http://${config.host}:${config.port}`)
    if (!config.apiKey) console.log('DeepSeek is not configured. Set DEEPSEEK_API_KEY and restart the server.')
    if (!config.databaseUrl) console.log('Chat history uses temporary memory storage for this development session.')
}

void main().catch(() => {
    console.error('API startup failed. Check the server environment and database connection.')
    process.exitCode = 1
})
