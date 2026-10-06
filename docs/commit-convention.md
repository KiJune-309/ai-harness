# Git 提交规范

项目使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 格式。每次提交的第一行写成：

```text
<type>(<scope>): <description>
```

`scope` 可省略；提交涉及单一模块时建议填写。`type` 和 `scope` 使用小写英文，描述可以用中文或英文，简洁说明这次改动。第一行不超过 100 个字符。

## 类型

| 类型       | 用途                     |
| ---------- | ------------------------ |
| `feat`     | 新功能                   |
| `fix`      | 缺陷修复                 |
| `docs`     | 只修改文档               |
| `refactor` | 不改变外部行为的重构     |
| `perf`     | 性能改进                 |
| `test`     | 测试相关改动             |
| `build`    | 构建系统或依赖改动       |
| `ci`       | CI 配置改动              |
| `chore`    | 其他维护工作             |
| `style`    | 不影响逻辑的代码格式改动 |
| `revert`   | 撤销提交                 |

## 推荐 scope

`web`、`api`、`ai-runtime`、`db`、`contracts`、`infra`、`repo`。跨多个模块的改动可以省略 scope；以后新增模块时可直接使用新的 scope。

## 示例

```text
feat(chat): 支持流式回复
fix(knowledge): 避免重复导入同一文档
build(repo): 添加提交信息校验
docs: 说明本地开发流程
```

不兼容改动在冒号前加 `!`，并在正文或页脚说明迁移影响：

```text
feat(api)!: 调整聊天接口的响应结构

BREAKING CHANGE: 客户端需要改为读取 events 字段。
```

需要解释原因时，在标题下空一行写正文。一次提交尽量只包含一个目的，正文说明改动背景和影响。

## 交互式提交

先使用 `git add` 暂存要提交的文件，再运行：

```sh
pnpm commit
```

命令依次提示选择提交类型（如 `feat`、`fix`）、选择模块（直接回车可留空）、输入简短描述，最后预览并确认提交信息。输入选项编号或名称，按回车确认。描述会先通过 commitlint 校验，确认后执行 Git 提交，仍会运行 `pre-commit` 和 `commit-msg` 检查。命令不会自动暂存文件；按 Ctrl+C 或在确认时选择取消可退出。

需要填写正文或不兼容改动时，可以直接使用 `git commit`，按上面的格式编写完整提交信息。

## 本地校验

安装依赖后，`prepare` 脚本会配置 Husky。提交时的 `pre-commit` 钩子先运行 lint-staged，使用 Prettier 自动格式化暂存文件，并把格式化结果更新到暂存区。部分暂存文件的未暂存改动会临时隐藏，处理后恢复，避免一起进入提交。Prettier 不支持的文件以及 `.prettierignore` 中的文件会跳过。

随后依次运行 `pnpm format:check` 和 `pnpm lint`，任一检查失败都会阻止提交。这两项仍检查整个项目，因此未暂存文件的格式或代码问题也可能阻止提交；可以运行 `pnpm format` 或 `pnpm lint:fix` 修复问题后重新提交。

`commit-msg` 钩子运行 commitlint；也可以手动检查一条消息：

```sh
printf '%s\n' 'feat(chat): 支持流式回复' | pnpm exec commitlint
```
