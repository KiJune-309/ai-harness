# Tools 定义与 ToolRegistry 执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 实现统一的 `defineTool`，以及 `ToolRegistry` 的 `registry`、`list`、`get`、`delete`、`schemas` 五个方法，覆盖 SDD 的 R1 至 R6。

**Architecture:** tools 在现有 core 包内独立定义类型与校验规则；`defineTool` 负责定义校验和单个工具的执行包装，注册表通过实例内的 Map 管理不可变工具。`schemas()` 生成独立的纯 JSON 描述快照，由调用方适配到 LLM 自身的协议。

**Tech Stack:** TypeScript 5.9、现有 Zod 4.6.5、Vitest 5、pnpm workspace；沿用 NodeNext、ES2022 与 `.ts` 相对导入，不新增依赖。

**Spec:** [Tools 定义与 ToolRegistry 软件设计文档](../specs/2026-10-14-tools-registry-design.md)

状态：五项任务已完成；整体审阅发现已修复并通过回归验收。执行采用当前会话顺序实现，测试按任务逐项验证失败与通过。

## Review Focus

1. 批次末尾出现重名或无效定义时，前面的新工具也不能写入；任务 3 验证。
2. 循环引用、稀疏数组、undefined、非有限数和非 JSON 对象不能在序列化时悄悄改变含义；任务 1、2 验证。
3. 异步参数校验期间取消时，工具实现仍不能启动；运行中取消由工具实现配合并完成自身工作；任务 2 验证。
4. 工具自身抛出的 ZodError 与包装器输入、输出校验失败须可区分，原始异常保持身份；任务 2 验证。
5. 修改导出描述的嵌套参数不能影响注册表或下次导出，删除后旧快照仍有效；任务 4 验证。

## 实现文件与任务关系

| 文件                                | 职责                                 | 所属任务 |
| ----------------------------------- | ------------------------------------ | -------- |
| `packages/core/tools/schemas.ts`    | 模型描述结构及名称、描述规则         | 1        |
| `packages/core/tools/types.ts`      | 工具、定义配置与上下文类型           | 1        |
| `packages/core/tools/errors.ts`     | 定义、重名和分阶段校验错误           | 1        |
| `packages/core/tools/json.ts`       | 内部 JSON 值检查、克隆与冻结辅助函数 | 1        |
| `packages/core/tools/defineTool.ts` | 定义入口、JSON Schema 生成与执行包装 | 2        |
| `packages/core/tools/registry.ts`   | 注册表的五个方法                     | 3、4     |
| `packages/core/tools/index.ts`      | 公共导出                             | 5        |
| `packages/core/tools/AGENTS.md`     | 模块职责、用法及验证要求             | 5        |
| `AGENTS.md`、SDD、本计划            | 更新实现状态、勾选验收结果           | 5        |

任务按 1 → 2 → 3 → 4 → 5 执行。测试文件、用途、用例和运行命令统一列在文末“测试与验收”；执行时仍按各任务对应的测试组先验证失败，再实现并验证通过。内部 JSON 辅助函数不通过公共入口导出。

### Task 1 工具标准与基础校验

**Files:** 创建 `packages/core/tools/schemas.ts`、`types.ts`、`errors.ts`、`json.ts`。

**Interfaces:**

- Consumes: 现有 `zod`，不消费其他业务模块。
- Produces: `toolSchema`；`ToolSchema = Readonly<z.infer<typeof toolSchema>>`；下列工具类型、错误和内部辅助函数。

```ts
type ToolExecutionContext = Readonly<{ userId: string; workspaceId: string; signal?: AbortSignal }>
type Tool<TResult = unknown> = ToolSchema & {
    readonly execute: (args: unknown, context: ToolExecutionContext) => Promise<TResult>
}
type DefineToolOptions<P extends z.ZodType<Record<string, unknown>>, O extends z.ZodType> = {
    readonly name: string
    readonly description: string
    readonly parameters: P
    readonly output: O
    readonly execute: (args: z.output<P>, context: ToolExecutionContext) => z.input<NoInfer<O>> | Promise<z.input<NoInfer<O>>>
}
type ToolValidationIssue = Readonly<{ code: string; path: readonly PropertyKey[]; message: string }>
```

参数泛型以 object 输出的 `ZodType` 约束，允许严格对象及 refinement 保留推导；严格对象身份在任务 2 定义阶段检查。`NoInfer` 防止不匹配的执行返回值反向拓宽输出 schema 类型。

| 入口                         | 精确签名与契约                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `InvalidToolDefinitionError` | 构造参数 `(message: string, toolName?: string, options?: ErrorOptions)`；code 为 `INVALID_TOOL_DEFINITION`                                                                                 |
| `DuplicateToolError`         | 构造参数 `(toolName: string)`；code 为 `DUPLICATE_TOOL`                                                                                                                                    |
| `ToolValidationError`        | 构造参数 `(toolName: string, stage: 'arguments' \| 'output', issues: readonly ToolValidationIssue[], options?: ErrorOptions)`；code 分别为 `INVALID_TOOL_ARGUMENTS`、`INVALID_TOOL_OUTPUT` |
| `getJsonIssues`              | `(value: unknown): readonly ToolValidationIssue[]`；有效 JSON 返回空数组，违规包含路径                                                                                                     |
| `cloneJson`                  | `<T>(value: T): T`；仅接收已验证 JSON，返回深拷贝                                                                                                                                          |
| `freezeJson`                 | `<T>(value: T): Readonly<T>`；仅接收已验证 JSON，递归冻结对象及数组，返回原引用                                                                                                            |
| `isFrozenJson`               | `(value: unknown): boolean`；在 JSON 已通过验证的前提下检查全部容器是否被冻结                                                                                                              |

- [x] **Step 1 实现标准和辅助函数**

在 `schemas.ts` 定义名称正则 `^[A-Za-z0-9_-]{1,64}$`，描述使用非空白校验且保持原文本；参数检查 object 根、JSON 描述与无损值。`toolSchema` 仅定义三个描述字段。

在 `json.ts` 检查普通对象或 null prototype 对象、连续数组及有限 JSON 标量；拒绝会丢失信息的 symbol 键、访问器和数组额外属性。使用当前祖先集合区分循环与重复引用，检查过程不调用 getter。`cloneJson` 使用原生 `structuredClone`，冻结仅处理 JSON 容器。错误类保留 `ErrorOptions.cause`，不在消息中输出上下文或原始参数。

- [x] **Step 2 完成测试 T1 的通过验证**

执行文末测试 T1 的验证命令，确认对应行为和类型检查全部通过，再提交任务。

### Task 2 defineTool 与单个工具执行包装

**Files:** 创建 `packages/core/tools/defineTool.ts`。

**Interfaces:**

- Consumes: 任务 1 的 `DefineToolOptions`、`Tool`、上下文、错误及 JSON 辅助函数。
- Produces: `defineTool<P extends z.ZodType<Record<string, unknown>>, O extends z.ZodType>(options: DefineToolOptions<P, O>): Tool<z.output<O>>`。

- [x] **Step 1 实现 defineTool**

先校验配置，再以 `z.toJSONSchema(parameters, { target: 'draft-07', io: 'input', unrepresentable: 'throw' })` 生成参数描述；确认参数是 ZodObject，转换结果根为 object 且 additionalProperties 为 false。输出使用同一 target、`io: 'output'` 检查表达能力。捕获转换错误并归一化为定义错误，保留 cause，不使用输出模式判断参数是否严格。

捕获执行函数和 schema，克隆并冻结模型描述，返回冻结的 Tool。包装入口依次检查取消、输入 JSON 与异步参数解析、解析后 JSON、再次检查取消、调用实现、异步输出解析、解析后 JSON。仅包装自身校验失败；实现主动抛出的异常原样传播。用内部函数组合上述步骤，不引入注册表执行入口，也不冻结执行依赖或提前放弃运行中的 Promise。

- [x] **Step 2 完成测试 T2 的通过验证**

执行文末测试 T2 的验证命令，确认对应行为和类型检查全部通过，再提交任务。

### Task 3 注册表集合管理

**Files:** 创建 `packages/core/tools/registry.ts`。

**Interfaces:**

- Consumes: 任务 1 的 Tool、描述 schema、定义及重名错误、JSON 冻结检查。
- Produces: `new ToolRegistry()`；`registry(toolOrTools: Tool | readonly Tool[]): void`；`list(): readonly Tool[]`；`get(name: string): Tool | undefined`；`delete(name: string): boolean`。

- [x] **Step 1 实现四个管理方法**

采用私有实例 Map。注册时完整验证描述、JSON、工具对象及参数深度冻结、执行入口与名称冲突，再按输入顺序统一写入；验证过程不调用 execute、不改写定义。返回新的列表数组，保留冻结工具引用。`get` 精确查找，`delete` 使用 Map 的布尔结果。

- [x] **Step 2 完成测试 T3 的通过验证**

执行文末测试 T3 的验证命令，确认对应行为和类型检查全部通过，再提交任务。

### Task 4 schemas 描述导出

**Files:** 修改 `packages/core/tools/registry.ts`。

**Interfaces:**

- Consumes: 任务 3 注册表、任务 1 `ToolSchema` 与 `cloneJson`。
- Produces: `ToolRegistry.schemas(): readonly ToolSchema[]`。

- [x] **Step 1 实现 schemas**

读取当前 Map，按顺序显式构造 `{ name, description, parameters: cloneJson(tool.parameters) }`。每次新建数组和描述对象，保留纯 JSON 参数结构；不使用工具对象展开、不缓存共享快照、不导入 LLM。

- [x] **Step 2 完成测试 T4 的通过验证**

执行文末测试 T4 的验证命令，确认对应行为和类型检查全部通过，再提交任务。

### Task 5 公共入口与调用方集成

**Files:** 创建 `packages/core/tools/index.ts`、`packages/core/tools/AGENTS.md`；修改根 `AGENTS.md`、SDD 和本计划的实现状态。

**Interfaces:**

- Consumes: 前四个任务的接口，以及保持独立的 LLM 公共入口。
- Produces: tools 公共导出 `defineTool`、`ToolRegistry`、`toolSchema`、三种错误、`ToolSchema`、`Tool`、`DefineToolOptions`、`ToolExecutionContext`、`ToolValidationIssue`；类型使用 `export type`。

- [x] **Step 1 完成入口与文档**

按 Interfaces 白名单导出公共 API。新增 tools 协作文档，包含五个方法、输入输出校验、上下文与授权边界、取消语义及验证命令。根 AGENTS 将 tools 的职责描述与实际实现同步，保持 LLM 的本地协议及其协作文档中的独立边界；实现状态在测试 T5 的最终验收通过后更新。

- [x] **Step 2 完成测试 T5 的通过验证**

执行文末测试 T5 的验证命令，确认对应行为和类型检查全部通过，再提交任务。

## 需求覆盖与执行方式

| SDD 需求        | 实现任务 |
| --------------- | -------- |
| R1 统一工具定义 | 1、2、5  |
| R2 注册工具     | 3        |
| R3 列举工具     | 3        |
| R4 查询工具     | 3        |
| R5 删除工具     | 3        |
| R6 导出模型描述 | 4、5     |

五个任务依次依赖前一个任务的接口，建议由当前会话顺序实现，结束后独立审阅整体改动。也可选择每个任务由子代理实现并分别审阅。执行方式在计划评审时确定，评审前不开始产品代码实现。

## 测试与验收

测试文件及其用途集中如下。各测试组与实现任务一一对应；测试代码中的公共类型导入使用 `import type`，测试辅助函数遵循 JSDoc/TSDoc 约定。

| 测试文件                                       | 用途                                   | 对应任务 |
| ---------------------------------------------- | -------------------------------------- | -------- |
| `packages/core/tools/schemas.test.ts`          | 描述与错误契约测试                     | 1        |
| `packages/core/tools/json.test.ts`             | JSON 无损检查与快照辅助函数测试        | 1        |
| `packages/core/tools/defineTool.test.ts`       | 输入、输出、异常与取消测试             | 2        |
| `packages/core/tools/defineTool.typecheck.ts`  | 参数和输出推导、异构工具集合的编译断言 | 2        |
| `packages/core/tools/registry.test.ts`         | 集合管理与批量原子性测试               | 3        |
| `packages/core/tools/registry.schemas.test.ts` | 描述白名单和快照隔离测试               | 4        |
| `packages/core/tools.integration.test.ts`      | 调用方适配 tools 与 LLM 的集成测试     | 5        |

### 测试 T1 工具标准与基础校验

- [x] **编写失败用例**

在两个测试文件中按下表实现测试。描述 fixture 为 `{ name: 'echo', description: 'Return text', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }`。

| 测试名                                                      | 关键输入和断言                                                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accepts valid model descriptors`                           | `expect(toolSchema.parse(descriptor)).toEqual(descriptor)`                                                                                                                     |
| `enforces exact tool names without normalization`           | `'a'.repeat(64)` 有效；空串、65 字符、`' echo'`、`'echo.'`、中文无效；`'Echo'` 保持原值                                                                                        |
| `rejects blank descriptions and non-object parameter roots` | 空白描述、参数数组、`{ type: 'string' }` 均 `safeParse(...).success === false`                                                                                                 |
| `rejects lossy JSON with issue paths`                       | undefined、NaN、Infinity、BigInt、Symbol、函数、Date、稀疏数组、symbol 键、访问器及数组额外属性均产生 issues；`{ nested: undefined }` 的路径为 `['nested']`；getter 从未被调用 |
| `rejects cycles while accepting repeated references`        | 自引用对象无效；`{ a: shared, b: shared }` 在 shared 为普通 JSON 对象时有效                                                                                                    |
| `clones and freezes nested JSON`                            | 克隆后嵌套对象不共享引用；修改克隆不改变源；冻结后每层对象及数组满足 `Object.isFrozen(...) === true`                                                                           |
| `preserves structured error identity`                       | 三种错误的 code、toolName、stage、issues 与 cause 符合接口表；`name` 与错误类名称一致                                                                                          |

- [x] **运行并确认失败原因**

Run: `pnpm exec vitest run packages/core/tools/schemas.test.ts packages/core/tools/json.test.ts`

Expected: 用例因标准或辅助函数尚未实现而失败；路径、依赖或语法错误先修正，不能当作行为验证。

- [x] **验证测试与类型通过**

Run: 本节失败验证命令和 `pnpm --filter @ai-harness/core typecheck`。

Expected: 两个测试文件全部通过，类型检查退出码 0。

### 测试 T2 defineTool 与单个工具执行包装

- [x] **编写定义、执行与类型断言**

基础工具使用严格参数 `{ text: z.string() }`、输出 `z.string()`，工具实现返回 `args.text`；上下文为 `{ userId: 'user_test', workspaceId: 'workspace_test' }`。

| 测试名                                                      | 关键输入和断言                                                                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `defines immutable model descriptions`                      | `parameters` 的 type 为 object、required 为 `['text']`、additionalProperties 为 false；工具和参数描述深度冻结，原 options 变化不改变它们 |
| `accepts equivalent strict object schemas`                  | `z.strictObject`、`z.object(...).strict()`、`catchall(z.never())` 均可定义；普通、loose、允许未知字段的 catchall 被拒绝                  |
| `rejects invalid or unrepresentable definitions`            | 无效名称、空白描述、非函数 execute、非对象参数根、Date 或不可表达转换 schema 产生 `INVALID_TOOL_DEFINITION`                              |
| `supports JSON roots and nested schema constraints`         | 输出依次覆盖 string、number、boolean、null、array、object；嵌套枚举、数组、联合、可选字段及 refinement 按声明校验                        |
| `validates before invoking the tool body`                   | 缺少 text、额外根字段、非 JSON 参数均产生 `INVALID_TOOL_ARGUMENTS`；实现调用次数为 0                                                     |
| `returns asynchronously parsed output`                      | 同步及异步实现均返回 Promise；异步 refinement 执行；默认值按 schema 生效，缺省可选字段可省略                                             |
| `distinguishes wrapper failures from body exceptions`       | 不匹配输出与非 JSON 解析结果产生 `INVALID_TOOL_OUTPUT`；内部主动抛出的 Error 或 ZodError 使用 `.rejects.toBe(original)` 验证身份         |
| `does not start a pre-aborted call`                         | signal 已取消时实现调用次数为 0，拒绝值为 signal 的原始 reason                                                                           |
| `does not start after cancellation during input validation` | 用可手动释放的 Promise 挂起 refinement；取消后释放校验，实现调用次数仍为 0                                                               |
| `forwards context and cooperative cancellation`             | 实现接收原上下文与原 signal；运行中取消由实现观察，返回的 Promise 在实现清理结束后才完成                                                 |

在 `.typecheck.ts` 中使用 `expectTypeOf` 固定 `args.text: string`、输出 `Promise<string>`、object 输出推导，以及 `Tool<string>` 与 `Tool<{ value: number }>` 可加入同一个 `readonly Tool[]`。使用 `@ts-expect-error` 标记错误输出类型、缺少执行上下文和非对象参数 schema；不使用 `any` 或强制断言放宽接口。

- [x] **验证失败**

Run: `pnpm exec vitest run packages/core/tools/defineTool.test.ts` 和 `pnpm --filter @ai-harness/core typecheck`。

Expected: 尚未实现的定义、包装与类型推导行为被识别；取消用例采用可控 Promise，不依赖固定等待时间。

- [x] **验证通过**

Run: `pnpm exec vitest run packages/core/tools` 和 `pnpm --filter @ai-harness/core typecheck`。

Expected: 已完成的标准、JSON 与 defineTool 用例全部通过，类型断言有效。

### 测试 T3 注册表集合管理

- [x] **编写集合管理用例**

fixture 使用不同名称的 echo 工具，统一通过 `defineTool` 创建；测试外部标准工具时提供冻结对象和深度冻结的参数描述。

| 测试名                                                | 关键断言                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `starts empty and registers one or many tools`        | 空表 list 为 `[]`；注册 `[a, b]` 后 `expect(registry.list()).toEqual([a, b])`，`get(a.name)` 与 a 为同一引用 |
| `rejects duplicate names without replacement`         | 重复对象、另一个同名对象、批次内重名均抛出 `DUPLICATE_TOOL`，原引用不变                                      |
| `rejects the entire invalid batch`                    | 已有 a，注册 `[b, a]` 或 `[b, invalid]` 失败后 list 仍为 `[a]`，get(b.name) 为 undefined                     |
| `accepts empty batches and external standard objects` | 空批次为 no-op；符合结构和冻结契约的外部工具可注册，无需私有标记                                             |
| `rejects invalid or mutable external definitions`     | 可变对象、只冻结外层的参数、缺少 execute、非 JSON 描述均抛出 `INVALID_TOOL_DEFINITION`，不执行入口           |
| `isolates returned arrays and registry instances`     | 修改 list 数组不改变成员；两个实例注册或删除互不影响                                                         |
| `uses exact names including prototype-like strings`   | `'echo'` 与 `'Echo'` 可并存；`'__proto__'`、`'constructor'` 可查询；空串及未命中名称返回 undefined           |
| `deletes idempotently and appends re-registrations`   | delete 命中 true，重复删除 false；删除 a 后重新注册，顺序为 `[b, a]`；旧 a 引用仍可执行                      |

- [x] **验证失败**

Run: `pnpm exec vitest run packages/core/tools/registry.test.ts`。

Expected: 集合管理行为尚未实现，用例失败；断言覆盖批次末尾失败后的完整注册表状态。

- [x] **验证通过**

Run: `pnpm exec vitest run packages/core/tools` 和 `pnpm --filter @ai-harness/core typecheck`。

Expected: 注册表及此前任务测试全部通过，异构工具实例满足统一 Tool 类型。

### 测试 T4 schemas 描述导出

- [x] **编写描述导出用例**

fixture 包含名称不同的工具，以及一个带额外宿主字段的冻结标准工具，用来验证字段白名单。

| 测试名                                             | 关键断言                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `exports only ordered model descriptor fields`     | `Object.keys(descriptor).sort()` 为 `['description', 'name', 'parameters']`；工具名称顺序与 list 一致；export 不调用 execute                  |
| `returns independent nested snapshots`             | 两次调用的数组、描述对象、parameters 及嵌套 properties 均 `.not.toBe(...)`；修改第一次的 description 或嵌套字段后，get 与第二次导出仍保持原值 |
| `exports empty registries`                         | `expect(new ToolRegistry().schemas()).toEqual([])`                                                                                            |
| `reflects changes without rewriting old snapshots` | 保存 `[a, b]` 快照，删除 a 后新快照为 `[b]`；再注册 a 后为 `[b, a]`，旧快照仍为 `[a, b]`                                                      |
| `serializes cleanly as JSON`                       | `JSON.parse(JSON.stringify(schemas))` 与 schemas 内容一致，不含函数、Zod 对象或额外宿主字段                                                   |

使用 `Reflect.set` 修改返回快照以跨过只读数组或未知嵌套类型的编译限制；不通过克隆返回值来代替实际快照隔离测试。

- [x] **验证失败**

Run: `pnpm exec vitest run packages/core/tools/registry.schemas.test.ts`。

Expected: 缺少 schemas 或尚未正确处理白名单及深拷贝的行为失败。

- [x] **验证通过**

Run: `pnpm exec vitest run packages/core/tools` 和 `pnpm --filter @ai-harness/core typecheck`。

Expected: 导出与集合生命周期、冻结定义、类型检查均通过。

### 测试 T5 公共入口与调用方集成

- [x] **编写公共入口与适配用例**

集成测试放在 core 根目录，作为调用方同时消费 tools 与 LLM；不放在 tools 内部，不修改 LLM 实现或现有 provider 测试。

| 测试名                                               | 关键断言                                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `uses the public tools entry end to end`             | 通过 index 创建工具、批量注册、查询、执行、删除和导出，结果与前四任务的契约一致                                                     |
| `adapts descriptors to the independent LLM protocol` | `chatOptionsSchema.parse({ tools: registry.schemas() }).tools` 与导出描述内容一致；toolDefinitionSchema 无需导入 tools              |
| `sends generated descriptors through mock providers` | OpenAI 请求的 function 与导出描述一致；Anthropic 的 name、description、input_schema 分别对应导出字段；工具 execute 未被模型请求调用 |

请求只使用 `https://example.invalid/v1`、`test-key` 和模拟 fetch。OpenAI 返回最小 assistant 文本响应；Anthropic fixture 参照现有 `anthropicProvider.tools.test.ts` 的 `nativeResponse` 形状，包含模型、文本、stop_reason 和 usage。测试结束恢复 fetch。

- [x] **验证失败**

Run: `pnpm exec vitest run packages/core/tools.integration.test.ts`。

Expected: 未完成的公共导出或适配行为失败；现有 LLM 代码不成为 tools 实现依赖。

- [x] **完成最终验收**

```sh
pnpm --filter @ai-harness/core typecheck
pnpm exec vitest run packages/core/tools packages/core/tools.integration.test.ts packages/core/LLM/providers/anthropicProvider.test.ts packages/core/LLM/providers/openaiProvider.tools.test.ts packages/core/LLM/providers/anthropicProvider.tools.test.ts
pnpm format:check
pnpm lint
pnpm exec node --experimental-strip-types --input-type=module -e 'await import("./packages/core/tools/index.ts"); await import("./packages/core/LLM/index.ts"); console.log("Public entries loaded")'
```

Expected: 类型、选定的全部本地测试、格式、lint 退出码 0；公共入口打印 `Public entries loaded`。这些命令涵盖 tools 与现有 34 个 mock provider 用例。

扫描生产代码的跨模块导入：LLM 中的 `../tools`、tools 中的 `../LLM` 及 provider 引用均应无匹配；core 根目录的集成测试允许同时消费两个入口。`openaiProvider.test.ts` 是真实服务测试，不属于本次本地验收命令，不注入真实凭据或运行它。

### 整体审阅与回归验收

独立审阅发现的两处行为问题已通过先失败、后通过的测试修复：

- `rejects metadata that masks a non-strict parameter policy`：普通 object、loose object 和允许额外字段的 catchall 即使声明 `additionalProperties: false` 元数据，也必须在定义阶段拒绝。
- `rejects custom array prototypes without calling inherited accessors`：数组子类及自定义原型数组均产生 JSON 错误，不调用继承 getter。
- `rejects custom array serialization at the %s boundary`：参数与输出两端分别拒绝能改变序列化含义的数组。

最终本地验收为 9 个测试文件、100 个用例全部通过；core 类型检查、格式、lint 和两个入口独立加载通过。新增的多行函数注释要求已同步落实，并检查了 14 个 TypeScript 文件中的 113 个函数体的注释结构和参数、返回值标签。
