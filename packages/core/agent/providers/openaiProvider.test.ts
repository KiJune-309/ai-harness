import { afterEach, expect, test, vi, describe } from 'vitest'
import { OpenAIProvider } from './openaiProvider.ts'

describe('OpenAIProvider request testing', () => {
    const apiKey = process?.env?.VITE_OPENAI_API_KEY
    const model = process?.env?.VITE_OPENAI_MODEL
    const baseUrl = process?.env?.VITE_OPENAI_BASE_URL

    if (!apiKey || !model || !baseUrl) {
        throw new Error(`
      Testing OpenAIProvider requires an \`apiKey\` and \`model\ and \`baseUrl\`
      apiKey: ${apiKey}
      model: ${model}
      baseUrl: ${baseUrl}
    `)
    }
    test('stream sends a simple chat request', async () => {
        const provider = new OpenAIProvider({ apiKey, model, baseUrl })

        // Consume the generator to trigger the request.
        const stream = provider.stream([{ role: 'user', content: 'Hello' }])
        for await (const item of stream) {
            console.log('item', item.choices[0]?.delta)
        }
    })

    test('chat sends a simple chat request', async () => {
        const provider = new OpenAIProvider({ apiKey, model, baseUrl })

        const chat = await provider.chat([{ role: 'user', content: 'Hello' }])

        const content = chat.choices[0].message

        console.log(content)
    })
})
