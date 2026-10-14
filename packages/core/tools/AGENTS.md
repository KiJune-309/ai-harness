# Tools 模块协作说明

## 模块职责

本模块提供 `defineTool` 和 `ToolRegistry`，管理宿主显式提供的服务端工具，并导出模型可见描述。模块不导入 LLM、provider、NestJS 或应用包，LLM 继续独立定义其协议，由调用方完成描述适配。

## 定义与执行

- `defineTool({ name, description, parameters, output, execute })` 使用已有 Zod 定义。参数须为严格 object 根，原始未知字段策略与生成描述都须拒绝额外字段；执行函数的参数与返回值由 schema 推导。
- 名称采用 1 至 64 个 ASCII 字母、数字、下划线或连字符，区分大小写；描述包含非空白内容。
- 定义阶段生成 JSON Schema 并冻结描述快照，过滤 Zod 的非枚举运行时适配信息；不改变作者的 schema 或冻结其执行依赖。
- `tool.execute(args, context)` 异步校验参数，调用实现，再校验输出。校验后的值须能无损表示为 JSON，数组仅接受普通连续数组，拒绝能继承自定义序列化行为的数组原型。
- `context` 包含可信的 `userId`、`workspaceId` 和可选 `signal`。API 管理授权，工具实现按工作空间过滤数据，凭据仅保留在服务端闭包或依赖中。
- 输入与输出失败为带阶段、issues 和 cause 的 `ToolValidationError`；工具实现自身异常原样传播。定义错误为 `InvalidToolDefinitionError`，重名为 `DuplicateToolError`。
- 包装器在校验前及执行前检查取消；运行中的工具须观察或转发 signal，并完成自身清理后结束，包装器不提前放弃其 Promise。

## 注册表接口

| 方法                    | 返回值                  | 行为                                                                               |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `registry(toolOrTools)` | `void`                  | 注册单个或数组，先验证完整批次；重名或无效定义使整个批次失败。                     |
| `list()`                | `readonly Tool[]`       | 注册顺序的新数组，元素为原冻结工具引用。                                           |
| `get(name)`             | `Tool` 或 `undefined`   | 精确查找名称。                                                                     |
| `delete(name)`          | `boolean`               | 移除注册项；旧引用与已启动执行仍然有效。                                           |
| `schemas()`             | `readonly ToolSchema[]` | 仅导出 name、description、parameters，每次深拷贝参数；返回对象可独立用于模型请求。 |

注册表实例互相独立。外部工具必须提供冻结的自身数据字段和深度冻结的 JSON 描述，不依赖私有品牌；宿主负责其执行入口遵守校验契约。`schemas()` 不执行权限过滤，宿主在向模型提供描述前确定当前授权可用工具集合。

## 文件与验证

`schemas.ts` 与 `types.ts` 定义标准，`errors.ts` 定义可路由错误，`json.ts` 提供内部 JSON 检查、克隆与冻结，`defineTool.ts` 实现包装，`registry.ts` 管理集合，`index.ts` 提供公共入口。内部 JSON 辅助函数不公开导出。

遵守根 AGENTS 的函数注释与依赖约定。测试文件用途与用例集中在执行计划末尾的测试章节。

```sh
pnpm --filter @ai-harness/core typecheck
pnpm exec vitest run packages/core/tools packages/core/tools.integration.test.ts packages/core/LLM/providers/anthropicProvider.test.ts packages/core/LLM/providers/openaiProvider.tools.test.ts packages/core/LLM/providers/anthropicProvider.tools.test.ts
pnpm format:check
pnpm lint
```

上述验证使用本地工具和模拟 HTTP，不需要模型凭据。`packages/core/tools.integration.test.ts` 位于 core 根目录，模拟调用方同时消费 tools 和 LLM 两个独立入口。
