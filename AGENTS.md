## 目录职责

| 路径                 | 职责                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | React + Next.js 界面，包括聊天、知识库和插件配置页面。                                                                       |
| `apps/api`           | NestJS HTTP API，处理身份验证、权限、文件上传、管理接口，并调用 AI runtime。后续可在同一应用包中增加独立的 worker 进程入口。 |
| `packages/core`      | 与 NestJS 解耦的 AI 执行包。负责模型调用、知识检索、文档处理和插件执行；可直接连接 PostgreSQL、Redis 和 Neo4j。              |
| `packages/db`        | PostgreSQL 表结构、迁移和共享数据库访问基础。                                                                                |
| `packages/contracts` | Web、API 和 runtime 共享的请求、响应、事件类型及校验规则；不要放服务端数据库客户端。                                         |
| `infra`              | 本地服务编排及未来的部署配置，例如 PostgreSQL、Redis、Neo4j 和对象存储。不要放业务代码。                                     |
| `docs`               | 架构与开发文档。                                                                                                             |

## 依赖方向

- `web` 只依赖 `contracts`，不直接导入服务端包。
- `api` 可以依赖 `core`、`db` 和 `contracts`。
- `core` 可以依赖 `db` 和 `contracts`；不要依赖 `apps/api` 或 NestJS 模块。
- `db` 和 `contracts` 不依赖任何应用包。跨包引用使用 workspace 包名，不跨目录导入其他包的 `src` 内部文件。

## 数据与权限边界

- PostgreSQL 是用户、团队、会话、文档元数据、插件配置及检索索引的主记录。Redis 用于队列与短期状态；Neo4j 保存实体关系等派生图谱数据。原始上传文件放在对象存储中，数据库保存文件引用。
- `api` 先验证身份与权限，再把可信的用户和工作空间上下文传给 `core`。runtime 虽可直接访问数据库，所有读写和检索仍须按工作空间范围过滤。
- 插件的配置与授权由 `api` 管理，调用由 `core` 执行。凭据仅保存在服务端，不进入 `web` 或共享的公开响应类型。
- AI runtime 对外提供少量稳定入口，例如聊天执行、文档入库和索引删除；数据库连接与模型实现保留在包内部，并在进程启动时初始化，不在每次请求中重新建立。

## 开发约定

- Web 界面的视觉变量、组件用法与交互验收参照 `docs/ui-design-spec.md`；保留其中现有实现与待落地要求的区分，修改公共 UI 模式时同步更新规范。
- 使用 pnpm workspace 管理应用和包。新增可运行应用时，再添加真实依赖、脚本和入口；不要保留会误导使用者的占位运行命令。
- 测试统一放在各模块与 `src` 同级的 `tests` 目录，不放入生产源码目录；`apps/web` 没有 `src`，测试放在包根目录 `tests`，按 `lib`、`server` 等原模块分组。生产构建只编译源码，不输出测试文件。
- 根目录使用 Prettier 统一格式，使用 ESLint flat config 检查 JavaScript/TypeScript；Next.js 专用规则仅用于 `apps/web`。提交前运行 `pnpm format:check` 和 `pnpm lint`。
- 每个函数都须编写标准的函数注释，使用 JSDoc/TSDoc 格式说明函数用途、参数和返回值；如有副作用或可能抛出的异常，也须说明。
- 函数注释必须使用多行 `/** ... */` 块，紧贴函数声明上方：`/**` 和 `*/` 各占一行，中间每行以 ` *` 开头；用途说明与每个 `@param`、`@returns`、`@throws` 标签分别独占一行。禁止将函数注释压缩成单行，即使注释内容较短也须保持多行格式。示例：

    ```ts
    /**
     * Checks immutable host definitions without evaluating getters.
     * @param value - Candidate tool.
     * @returns Nothing, narrowing valid tools.
     * @throws InvalidToolDefinitionError for mutable or malformed metadata.
     */
    ```

- 当变量名无法清楚表达变量含义时，须在变量声明处添加注释，说明其含义和用途。
- Git 提交信息遵循 `docs/commit-convention.md`；优先使用与改动模块对应的 scope。提交钩子会用 commitlint 校验提交信息。
- 优先在现有模块内扩展职责，只有出现明确的部署或复用需求时再拆新服务或共享包。
- 配置通过环境变量提供，提交示例配置，不提交密钥或真实连接串。
- 修改模块边界或数据所有权时，同步更新本文件。
- `packages/core/tools` 已实现工具标准、Zod 输入输出校验、注册管理与模型描述导出；`packages/core/LLM` 负责模型调用及 provider 协议转换，并在模块内独立定义模型侧工具描述与调用的类型和 schema，不导入 tools 模块。工具模块不依赖 provider，调用方负责把可执行工具适配为模型侧描述；API 层仍负责身份、工作空间权限和插件授权，工具结果回填与后续模型请求由调用方管理。
