export default {
    extends: ['@commitlint/config-conventional'],
    prompt: {
        messages: {
            type: '选择提交类型：',
            scope: '选择模块（可留空）：',
            subject: '输入简短描述：',
            confirmCommit: '确认提交以上信息？',
        },
        types: [
            { value: 'feat', name: 'feat:     新功能' },
            { value: 'fix', name: 'fix:      缺陷修复' },
            { value: 'docs', name: 'docs:     文档修改' },
            { value: 'refactor', name: 'refactor: 代码重构' },
            { value: 'perf', name: 'perf:     性能改进' },
            { value: 'test', name: 'test:     测试改动' },
            { value: 'build', name: 'build:    构建或依赖改动' },
            { value: 'ci', name: 'ci:       CI 配置改动' },
            { value: 'chore', name: 'chore:    其他维护工作' },
            { value: 'style', name: 'style:    代码格式改动' },
            { value: 'revert', name: 'revert:   撤销提交' },
        ],
        scopes: ['web', 'api', 'core', 'ai-runtime', 'db', 'contracts', 'infra', 'repo'],
    },
}
