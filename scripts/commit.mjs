import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath, URL } from 'node:url'
import config from '../commitlint.config.mjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const { messages, types, scopes } = config.prompt

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
    if (result.error) throw result.error
    return result.status ?? 1
}

async function select(rl, message, options, optional = false) {
    process.stdout.write(`\n${message}\n`)
    options.forEach((option, index) => process.stdout.write(`  ${index + 1}. ${option.name}\n`))
    if (optional) process.stdout.write('  0. 不填写模块（直接回车）\n')

    while (true) {
        const answer = (await rl.question('选择编号或名称：')).trim()
        if (optional && (answer === '' || answer === '0')) return ''
        const choice = options.find((option, index) => answer === String(index + 1) || answer === option.value)
        if (choice) return choice.value
        process.stdout.write('无效选项，请重新选择。\n')
    }
}

async function main() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('请在交互式终端中运行 pnpm commit。')

    const staged = run('git', ['diff', '--cached', '--quiet', '--exit-code'])
    if (staged === 0) throw new Error('没有暂存的改动，请先使用 git add 暂存要提交的文件。')
    if (staged !== 1) {
        process.exitCode = staged
        return
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.on('SIGINT', () => {
        process.stdout.write('\n已取消提交。\n')
        rl.close()
        process.exit(130)
    })

    try {
        const type = await select(rl, messages.type, types)
        const scope = await select(
            rl,
            messages.scope,
            scopes.map(value => ({ value, name: value })),
            true
        )
        let message
        while (true) {
            const subject = (await rl.question(messages.subject)).trim()
            if (!subject) {
                process.stdout.write('描述不能为空。\n')
                continue
            }
            message = `${type}${scope ? `(${scope})` : ''}: ${subject}`
            const valid = run(process.execPath, [require.resolve('@commitlint/cli/cli.js')], {
                input: `${message}\n`,
                stdio: ['pipe', 'inherit', 'inherit'],
            })
            if (valid === 0) break
            process.stdout.write('提交信息未通过校验，请重新输入描述。\n')
        }

        process.stdout.write(`\n提交信息：${message}\n`)
        const confirmed = (await rl.question(`${messages.confirmCommit} [y/N] `)).trim().toLowerCase()
        if (!['y', 'yes'].includes(confirmed)) {
            process.stdout.write('已取消提交。\n')
            return
        }
        rl.close()
        process.exitCode = run('git', ['commit', '-m', message])
    } finally {
        rl.close()
    }
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
})
