import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        globals: false,
        include: ['{apps,packages}/**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'],
        passWithNoTests: true,
        silent: false,
    },
})
