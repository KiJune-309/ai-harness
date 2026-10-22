import { readApiConfig, type ApiConfig } from '../src/config.js'

/**
 * Supplies explicit non-secret persistent settings for tests that inject isolated stores.
 * @param env - Scenario-specific configuration overrides.
 * @returns Valid API settings with no environment-enabled memory behavior.
 */
export function readTestApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
    return readApiConfig({ DATABASE_URL: 'postgresql://fixture.invalid/isolated', ACCOUNT_ENCRYPTION_KEY: 'a'.repeat(64), ...env })
}
