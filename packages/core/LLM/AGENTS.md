# LLM 模块协作说明

## 模块职责

`packages/core/LLM` 是 `@ai-harness/core` 内的服务端模型调用与工具协议转换模块。它根据配置创建模型 provider，为上层提供普通聊天和流式聊天，并封装不同模型服务的请求格式、鉴权、超时与响应处理。模型侧工具描述与调用协议的类型和 schema 在本模块内独立定义；可执行工具的定义、注册和执行由调用方管理。

当前支持 `openai` 和 `anthropic`，通过原生 `fetch` 调用模型 HTTP API。模块保持与 NestJS 解耦，尚未接入 Web 聊天界面。

## 文件职责

| 文件                             | 职责                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                       | 对外导出入口；`LLMFactory` 根据配置直接返回 provider 实例，提供 `chat` 和 `stream`。                                   |
| `providerFactory.ts`             | 校验 provider 名称及配置，选择并创建对应的 provider。                                                                  |
| `schemas.ts`                     | 使用 Zod 定义 provider、配置、消息、Anthropic 内容块、调用选项、LLM 创建参数及模型侧工具描述与调用协议的 schema。      |
| `types.ts`                       | 从 schema 推导输入类型，定义共享响应和 Anthropic 原生类型，并导出模型侧工具描述与调用类型。                            |
| `providers/baseProvider.ts`      | 定义 `LLMProvider` 抽象类及普通、流式聊天方法契约。                                                                    |
| `providers/openaiProvider.ts`    | 调用 `/chat/completions`，序列化消息及 function tools，返回 JSON 响应或解析后的 SSE 数据，以 `[DONE]` 结束流。         |
| `providers/anthropicProvider.ts` | 调用 `/messages`，提取 system 消息，转换普通聊天的工具协议和响应，并将文本流转换为共享格式，以 `message_stop` 结束流。 |
| `providers/*.test.ts`            | provider 的请求、响应转换与流式处理测试；不同测试的外部依赖见下文。                                                    |

## 调用与配置

- `LLMFactory(config)` 直接返回对应的 `LLMProvider`；`providerFactory(provider, config)` 也可单独创建 provider。
- `chat(messages, options?)` 返回 `Promise<ChatResponse>`；`stream(messages, options?)` 返回 `AsyncIterable<StreamResponse>`，由调用方逐段消费。
- 创建 LLM provider 需要 `provider`、`apiKey` 和 `model`；创建参数类型为 `CreateLLMOptions`，对应 `createLLMOptionsSchema`。可选配置包括 `baseUrl`、`maxTokens`、`temperature` 和 `timeoutMs`。
- 每次调用由上层传入消息历史。消息支持 `system`、`user`、`assistant` 和 `tool`；普通聊天可通过 `options.tools` 传入模型可见工具描述，并返回 assistant 的 `tool_calls`。单次 `chat` 不执行工具；调用方负责准备描述、处理返回调用、执行工具、回填结果和发起下一次请求。
- `ToolDefinition` 从本模块的 `toolDefinitionSchema` 推导，只包含 `name`、`description` 和 `parameters`；`ToolCall` 从本模块的 `toolCallSchema` 推导，保留模型返回的函数名称及 JSON 参数字符串。可执行工具适配为模型侧描述时，只传入上述描述字段，不传执行函数、上下文或凭据。
- `baseUrl` 是包含 API 版本路径的 HTTP(S) API 根地址，provider 会追加接口路径；工厂校验会拒绝带有用户名、密码、查询参数或片段的地址。
- 每次请求默认超时为 60 秒；调用方可通过 `options.signal` 取消请求。流式调用结束、异常或被提前终止时，需要取消 reader 并释放锁。
- Anthropic 默认 `max_tokens` 为 4096；OpenAI 仅在配置提供时发送 `max_completion_tokens`。
- 工厂会执行配置的运行时校验；直接调用 provider 构造函数不会执行该校验。消息和调用选项虽有 schema，当前聊天方法没有调用它们进行运行时校验。

## 当前能力边界

- 本模块负责单次模型请求与响应，不执行工具，不管理会话历史，也不自动回填工具结果或发起后续请求。
- 当前支持文本消息和非流式工具调用协议，尚未实现多模态输入、知识检索、文档入库、插件配置与授权、重试或 provider 自动切换。
- OpenAI 普通和流式请求均可携带工具定义；流式事件直接透传，不会聚合工具调用参数。Anthropic 的工具定义仅用于普通聊天，流式请求尚未发送 `options.tools`，流式输出也不转换工具事件。
- OpenAI 响应当前直接返回解析后的 JSON，没有响应 schema 校验；共享 TypeScript 类型不保证上游实际返回全部字段。
- Anthropic 普通响应拼接文本块，将 `tool_use` 转为 `tool_calls`，并通过 assistant 的 `providerContent` 保留原生内容块及签名，供后续工具轮次回传；流式响应只转换消息开始和文本事件，不输出最终 token 用量或结束原因。
- Anthropic 共享响应中的敏感标记、推理 token 数和字符计数等部分字段使用占位值，不能作为真实审核或统计结果。
- 本目录尚无身份验证、权限检查、数据库访问或任务队列实现。

## 开发约定

- 本文件适用于本目录及子目录，同时遵循仓库根目录 `AGENTS.md` 的依赖与数据边界。
- API 层负责验证身份和权限；本模块只接收服务端提供的配置与调用参数。凭据由服务端从环境变量等配置来源注入，不进入 Web、公开响应、日志或测试输出。
- 不引入 `apps/api` 或 NestJS 依赖；跨包调用遵循 workspace 包名及项目依赖方向。
- 新增 provider 时，同步更新 `providerSchema`、工厂分支、入口导出和测试，并实现 `LLMProvider` 的两种调用方式。
- provider 特有的请求及协议转换保留在对应实现中；上层统一通过共享接口调用。修改消息或响应契约时，核对两个 provider 的兼容性。
- 修改 SSE 解析时，保持对网络分块、UTF-8 分块、多个事件合并、换行差异、无末尾空行和提前取消的处理，并补充相应测试。
- 本模块只定义模型侧工具协议，不导入可执行工具模块；调用方负责可执行工具与模型侧描述之间的适配。修改模块职责时，明确工作空间权限边界并同步更新本文件；不要将规划中的能力写成已实现。

## 验证

在仓库根目录执行：

```sh
pnpm --filter @ai-harness/core typecheck
pnpm exec vitest run packages/core/LLM/providers/anthropicProvider.test.ts packages/core/LLM/providers/openaiProvider.tools.test.ts packages/core/LLM/providers/anthropicProvider.tools.test.ts
pnpm format:check
pnpm lint
```

`anthropicProvider.test.ts` 和两个 `*.tools.test.ts` 通过模拟 `fetch` 和流数据运行，均无需真实模型凭据。`openaiProvider.test.ts` 会访问真实模型服务，依赖进程环境中的 `VITE_OPENAI_API_KEY`、`VITE_OPENAI_MODEL` 和 `VITE_OPENAI_BASE_URL`；运行前确认测试环境配置，避免输出真实密钥。新增协议测试优先使用模拟响应。
