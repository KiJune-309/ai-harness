import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    devIndicators: false,
    agentRules: false,
    // Container builds include workspace dependencies without changing local next start usage.
    output: process.env.HARNESS_STANDALONE === 'true' ? 'standalone' : undefined,
    outputFileTracingRoot: path.join(__dirname, '../..'),
}

export default nextConfig
