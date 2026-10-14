# Tools 定义与 ToolRegistry 软件设计文档

日期：2026-10-14  
状态：待评审  
模块：`packages/core/tools`  
实现状态：尚未开始

本模块为服务端工具提供统一定义方式，并通过 `ToolRegistry` 管理工具的注册、列举、查询和删除。第一版围绕工具定义与集合管理展开，注册表的公开方法按需求命名为 `registry`、`list`、`get` 和 `delete`。

## 需求与范围

### 已确认需求

| 编号 | 需求                             | 验收结果                                                                                    |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| R1   | 提供统一的 tool 定义方式         | 工具作者通过 `defineTool` 定义名称、描述、参数、输出和执行函数，参数及结果类型由 Zod 推导。 |
| R2   | `ToolRegistry.registry` 注册工具 | 支持将宿主提供的单个工具或一组工具加入同一个注册表。                                        |
| R3   | `ToolRegistry.list` 列举工具     | 返回当前实例的全部工具，调用方可读取工具定义与执行入口。                                    |
| R4   | `ToolRegistry.get` 查询工具      | 根据工具名称返回对应工具；名称不存在时返回 `undefined`。                                    |
| R5   | `ToolRegistry.delete` 删除工具   | 根据工具名称移除注册项，返回是否成功删除。                                                  |

以上方法的具体返回值、批量注册行为和错误语义采用下文的设计方案，随本 SDD 一起评审。

### 第一版配套设计

统一定义方式包含名称唯一性、定义校验、参数与输出校验，以及模型描述和执行函数的分离。这些规则保证注册后的工具可以安全地被宿主查找和调用。

`ToolRegistry` 在第一版管理工具集合。宿主通过 `get` 获取工具并调用其执行入口；模型调用解析、统一执行结果、调度、超时和重试属于后续功能。工具结果回填与下一次模型请求由调用方负责。

## 当前项目与参考实现

`packages/core/tools` 当前为空。`packages/core/LLM/schemas.ts` 已引用该模块的 `toolSchema` 和 `toolCallSchema`；LLM 入口和 provider 测试也已引用模型侧 `ToolDefinition` 和 `ToolCall`，但 `LLM/types.ts` 尚未导出这两个类型。

现有根目录 `AGENTS.md` 与 `packages/core/LLM/AGENTS.md` 已描述工具执行职责。实现第一版时需要将其中尚未实现的注册表执行、`schemas()` 调用等内容标为后续能力，保证文档与实际入口一致。工具执行仍归属 tools 模块，模型协议转换归属 LLM 模块，这一职责划分保持不变。

DeepSeek Harness 使用 `defineTool` 声明工具，通过 `ToolRuntime.register` 管理注册，并通过 `schemas` 导出模型可见描述。其定义采用自定义 schema DSL，注册运行时还包含作用域、策略钩子和执行流水线。本项目借鉴定义与注册分离的结构，沿用已有 Zod 依赖。

参考来源：

- [DeepSeek Harness tools 模块说明](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/tools)
- [DeepSeek defineTool 源码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/schema.ts)
- [DeepSeek 注册与执行运行时源码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts)
- [Zod JSON Schema 文档](https://zod.dev/json-schema)

## 架构与职责

工具作者将定义交给 `defineTool`。该函数生成模型可见描述并包装参数、输出校验，返回标准工具对象。宿主创建 `ToolRegistry` 实例，将这些对象注册进去，然后使用集合管理方法查询或移除它们。

```text
工具作者的 Zod 定义和执行函数
              │
          defineTool
              │
         标准 Tool 对象
              │
    ToolRegistry.registry
              │
        实例内部的 Map
              │
     list / get / delete
```

- 工具定义和注册表位于现有 `@ai-harness/core` 包内，沿用同包相对导入。
- tools 模块不依赖 LLM provider、NestJS 或 `apps/api`。
- API 验证身份、工作空间权限和插件授权，再将可信执行上下文交给工具调用方。注册成功不代表当前用户获得操作授权。
- 工具实现按工作空间范围读写数据，凭据由服务端闭包或依赖注入提供。
- 每个注册表实例持有独立的进程内集合。宿主按生命周期复用实例，并为每次执行传递当前上下文；不使用模块级全局单例或数据库持久化注册表。

## 工具标准

### 模型可见描述

`ToolSchema` 包含以下字段：

| 字段          | 类型             | 说明                                        |
| ------------- | ---------------- | ------------------------------------------- |
| `name`        | `string`         | 注册与模型调用使用的工具标识。              |
| `description` | `string`         | 向模型说明工具用途及使用条件。              |
| `parameters`  | JSON Schema 对象 | 从参数的 Zod schema 生成，根类型为 object。 |

`ToolSchema` 不包含执行函数、Zod 对象、执行上下文或凭据。`toolSchema` 是校验上述描述结构的 Zod schema；具体参数的运行时校验使用工具作者提供的 Zod schema。

名称区分大小写，采用 1 至 64 个 ASCII 字母、数字、下划线或连字符，建议使用 `snake_case`。名称不执行自动 trim 或大小写转换；不符合规则时直接拒绝。描述必须包含非空白内容。

### 工具定义入口

`defineTool` 接收以下配置：

| 字段          | 要求 | 说明                                                                   |
| ------------- | ---- | ---------------------------------------------------------------------- |
| `name`        | 必填 | 满足统一名称规则。                                                     |
| `description` | 必填 | 说明用途、参数语义及调用限制。                                         |
| `parameters`  | 必填 | 严格 object 根类型的 Zod schema，拒绝未声明的根参数。                  |
| `output`      | 必填 | 输出的 Zod schema，支持可表示为 JSON 的值。                            |
| `execute`     | 必填 | 接收推导后的参数和可信上下文，返回声明的输出；可返回普通值或 Promise。 |

`defineTool` 返回 `Tool`：包含 `ToolSchema` 的三个描述字段及包装后的 `execute` 入口。参数与输出的原始 Zod schema 由包装器保留在内部，输出声明暂不加入 provider 的模型描述。

工具作者使用 `z.strictObject` 或等价的严格对象 schema 定义参数根对象。`defineTool` 拒绝默认剥离未知字段的 `z.object`、允许额外字段的对象及根级 catchall，不自动改变作者提供的 schema。嵌套对象遵循各自声明的未知字段规则。

定义阶段校验名称、描述、schema 与执行函数，并生成 JSON Schema。参数按输入形式生成 JSON Schema；输出按输出形式检查其 JSON 表达能力。第一版支持可转换的基础 JSON 类型、枚举、对象、数组及组合，拒绝 Date、函数和无法表达的转换等定义。不通过忽略转换错误的方式生成不准确的模型描述。自定义 refinement 可能提供 JSON Schema 无法表达的额外约束，运行时仍按原始 Zod schema 执行这些校验；工具描述应说明调用方需要了解的业务条件。

返回的工具描述为不可变快照，调用方修改原配置不能改变已定义工具的名称或参数描述。执行函数可持有服务端依赖；冻结定义对象不冻结这些依赖的内部状态。

包装后的 `execute` 接收待校验参数及 `ToolExecutionContext`，按以下顺序执行：

1. 使用参数的 Zod schema 校验输入，校验失败时不调用工具实现。
2. 将校验后的参数与可信上下文交给工具实现。
3. 使用输出的 Zod schema 校验返回值，成功后返回校验后的输出。

参数及输出校验使用异步解析，允许异步校验规则。校验后的参数和输出均须可无损表示为 JSON：拒绝 undefined 值、非有限数、BigInt、循环引用等；对象中未出现的可选字段允许省略。入口统一返回 Promise；定义错误在定义阶段抛出，参数错误、输出错误和工具自身异常通过 Promise 拒绝向宿主传播。第一版不封装成功或失败结果对象。

`ToolExecutionContext` 包含可信的 `userId`、`workspaceId` 和可选 `signal: AbortSignal`。这些字段由服务端宿主提供，不能来自模型参数。包装器在输入校验前及工具实现调用前检查取消信号，包含等待异步参数校验时发生的取消；信号已取消时拒绝执行。运行中的异步工作由工具实现观察或转发 signal，不采用提前结束 Promise 的方式假定工作已停止。

### 工具调用协议

为兼容当前 LLM，`ToolCall` 与 `toolCallSchema` 继续使用以下形状：

```ts
type ToolCall = {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}
```

`arguments` 保存模型返回的原始 JSON 字符串。第一版的注册表方法不解析此协议；调用方解析参数后再调用从 `get` 得到的工具。

## ToolRegistry 接口

`new ToolRegistry()` 创建空注册表，内部使用 `Map<string, Tool>` 保存工具。全部管理方法都是同步方法，不触发工具执行或网络请求。

| 方法       | 参数                             | 返回值              | 行为                                                |
| ---------- | -------------------------------- | ------------------- | --------------------------------------------------- |
| `registry` | 单个 `Tool` 或 `readonly Tool[]` | `void`              | 注册一个或一组工具，全部成功后修改集合。            |
| `list`     | 无                               | `readonly Tool[]`   | 按注册顺序返回全部工具的新数组。                    |
| `get`      | `name: string`                   | `Tool \| undefined` | 精确匹配名称，返回已注册工具。                      |
| `delete`   | `name: string`                   | `boolean`           | 移除命中项，已删除返回 `true`，不存在返回 `false`。 |

### 注册规则

- 仅登记宿主显式传入的工具，第一版不扫描文件目录或动态加载插件。
- 批量注册先校验整个批次，再写入集合；遇到无效定义或重复名称时，整个批次失败，已有注册项与顺序保持不变。
- 同一批次内重名、与已有工具重名，以及重复注册同一个对象，均抛出带工具名称的 `DuplicateToolError`，不覆盖已有定义。
- 空数组注册成功且不修改集合。
- 注册边界检查描述结构、执行入口及不可变性，避免 JavaScript 调用方绕过 TypeScript 后污染集合。接受符合标准的工具对象，不依赖私有品牌标记；不满足标准时抛出 `InvalidToolDefinitionError`。
- 不可变性指工具对象及其 JSON Schema 描述均不可变。注册表保留工具引用；允许同一工具对象被不同注册表实例登记。

第一方工具通过 `defineTool` 创建。宿主提供外部工具时，其执行入口也须遵守参数与输出校验契约；注册边界验证结构，不通过执行工具来检验其行为。

### 列举与查询规则

空注册表的 `list()` 返回空数组。返回数组与内部集合分离，调用方修改数组不能改变注册表；其中的工具引用与 `get(name)` 返回的引用一致。

列表顺序为当前工具的注册顺序；批量注册遵循数组顺序。查询名称使用精确字符串匹配，不执行归一化。不存在、空字符串或格式不匹配的名称均视为未命中，返回 `undefined`。

### 删除与生命周期

删除不存在的名称返回 `false`，重复删除具有相同行为。删除后，`get` 不再命中，`list` 不再包含该工具；再次注册同名工具允许成功，并排列在当前集合末尾。

`delete` 移除注册项。此前由宿主获得的工具引用仍然有效，已经启动的执行继续由调用方管理。删除注册项不能作为权限撤销机制；操作权限在每次调用时由 API 与工具实现验证。

### 错误规则

| 错误                         | code                                              | 信息                                     |
| ---------------------------- | ------------------------------------------------- | ---------------------------------------- |
| `InvalidToolDefinitionError` | `INVALID_TOOL_DEFINITION`                         | 定义违规原因；工具名称可识别时提供名称。 |
| `DuplicateToolError`         | `DUPLICATE_TOOL`                                  | 冲突的工具名称。                         |
| `ToolValidationError`        | `INVALID_TOOL_ARGUMENTS` 或 `INVALID_TOOL_OUTPUT` | 工具名称、校验阶段和包含路径的 issues。  |

`get` 与 `delete` 的未命中属于正常结果。定义及注册阶段发生错误时，注册表保持原状态。包装器将自身参数及输出校验失败转换为 `ToolValidationError`，保留 Zod 路径信息和原始 cause；工具实现主动抛出的异常保持原样，包括工具内部的 ZodError，避免与包装器校验混淆。错误消息不包含执行上下文或凭据。

## 文件与兼容性

| 文件                                | 职责                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| `packages/core/tools/schemas.ts`    | `toolSchema`、`toolCallSchema` 及相关结构校验。              |
| `packages/core/tools/types.ts`      | `ToolSchema`、`ToolCall`、`Tool`、定义配置与执行上下文类型。 |
| `packages/core/tools/defineTool.ts` | 类型推导、定义校验、JSON Schema 生成和参数及输出校验包装。   |
| `packages/core/tools/registry.ts`   | `ToolRegistry` 与四个集合管理方法。                          |
| `packages/core/tools/errors.ts`     | 定义错误、重复名称错误及带阶段信息的校验错误。               |
| `packages/core/tools/index.ts`      | 公共类型、schema、定义入口、注册表与错误导出。               |
| `packages/core/tools/*.test.ts`     | 工具定义及注册表的行为测试。                                 |

LLM 的 `ToolDefinition` 保留为模型描述 `ToolSchema` 的兼容别名，可执行工具统一命名为 `Tool`，避免同名概念混淆。实现时补齐 `LLM/types.ts` 中的 `ToolDefinition` 和 `ToolCall` 导出，使已有引用可解析；provider 的请求转换继续消费现有三个模型描述字段。

第一版的 `list()` 返回服务端工具对象，包含执行函数。调用方需要传给 LLM 时显式提取 `name`、`description`、`parameters`；传入 provider 或公开 API 响应的对象必须满足 `ToolSchema`。模型侧 JSON Schema 格式使用当前 provider 可接收的 object 描述，具体 provider 转换留在 LLM 内。

函数与公开方法按仓库要求编写 JSDoc/TSDoc，说明用途、参数、返回值、副作用和异常。实现完成时同步更新根目录及 LLM 的协作文档，保留已实现与后续能力的区分。

## 验收与验证

| 场景                              | 预期结果                                                 |
| --------------------------------- | -------------------------------------------------------- |
| 定义有效工具                      | 得到模型描述与可调用的标准工具，参数和返回值类型可推导。 |
| 名称、描述或 schema 无效          | 定义阶段失败，不产生可注册对象。                         |
| 输入缺少必填项或包含未声明参数    | 包装执行拒绝，工具实现未被调用。                         |
| 输出不符合声明或工具抛出异常      | 包装执行拒绝，宿主可区分校验失败与工具异常。             |
| 输入 signal 已取消                | 工具实现未被调用。                                       |
| 异步参数校验期间取消              | 校验后不调用工具实现。                                   |
| 注册单个或一组工具                | `get` 和 `list` 可读取全部注册项，顺序稳定。             |
| 批次末尾存在重复项或无效项        | 整个批次失败，前面的新工具也未加入。                     |
| 使用空批次                        | 注册表状态不变。                                         |
| 修改原定义或返回列表              | 已登记工具的描述及注册表成员不变。                       |
| 未命中查询或删除                  | 分别得到 `undefined` 和 `false`。                        |
| 删除后重新注册                    | 工具恢复可查询，出现在列表末尾。                         |
| 创建两个注册表                    | 注册、删除及列表互不影响。                               |
| LLM 兼容导出与 mock provider 用例 | 现有工具描述、调用协议及 provider 转换保持兼容。         |

实现阶段使用本地工具与模拟响应验证，不需要真实模型凭据。类型检查覆盖定义入口的参数推导、输出类型及异构工具集合的管理，不以强制类型断言替代这些契约。

仓库检查包括 core 类型检查、tools 测试、现有 mock provider 测试，以及 `pnpm format:check` 和 `pnpm lint`。这份 SDD 的交付检查包括需求覆盖、接口一致性、范围审阅和 Markdown 格式检查。

## 建议的后续功能

以下功能单独评审，不作为第一版验收条件：

| 优先级 | 功能                      | 用途                                                                       |
| ------ | ------------------------- | -------------------------------------------------------------------------- |
| 高     | `schemas()`               | 集中导出模型描述，减少调用方反复提取字段，也避免混入执行入口。             |
| 高     | 统一单次执行入口          | 集中解析 `ToolCall`、处理未知工具、校验参数，并返回一致的成功或失败结果。  |
| 中     | `has(name)` 与只读 `size` | 简化存在性检查和工具数量展示；当前可由 `get` 与 `list` 实现。              |
| 中     | 按可信上下文过滤可用工具  | 为不同工作空间或授权范围生成合适的工具集合，并在执行入口采用同一过滤规则。 |
| 后续   | 超时、执行事件和并发分类  | 在形成统一执行入口后支持生命周期观测及调度策略。                           |

建议下一步优先补充 `schemas()`；统一执行入口可随后设计。`clear()`、覆盖式注册、自动发现和持久化注册表暂不增加，已有四个方法足以支撑第一版工具集合管理。
