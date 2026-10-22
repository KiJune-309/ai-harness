# SF-010：实施计划

| 字段 | 值                                                 |
| ---- | -------------------------------------------------- |
| 状态 | Approved — Proxy Review Passed                     |
| Spec | [spec.md](spec.md)，Approved — Proxy Review Passed |
| 日期 | 2026-10-18                                         |

## 技术方案

1. 官方 `shadcn@4.22.0` CLI 已通过 `init --help` 核对当前 `--defaults` 为 `base-nova`。统一 Base UI primitives、neutral 默认 token 和官方 variants，不混用 Radix `asChild`。既有 Next.js 添加 Tailwind v4/PostCSS、`@/*` alias、components.json 和 cn；CLI 生成实际使用的 components/ui。保留官方 class/token，只适配导入、JSDoc、安全 Portal container。锁文件记录实际版本。来源：[安装](https://ui.shadcn.com/docs/installation/next)、[CLI](https://ui.shadcn.com/docs/cli)、[默认主题](https://ui.shadcn.com/docs/theming)。
2. 统一 Button、Input、Textarea、Label、NativeSelect/Option、Checkbox、Card、Badge、Alert、Dialog/AlertDialog、Sheet、DropdownMenu、Avatar、Sidebar、Collapsible、Tabs、Separator、Tooltip、Table、Pagination、Progress、Skeleton 等现用组件。原 select 优先 NativeSelect，保留空值、稳定ID、原 onChange/ref；链接通过 BaseUI render 组合。确认框和表单 Dialog 迁受控状态，保留取消/失败草稿/焦点。展示组件仅按实际示例增加。
3. 移除旧全局控件 reset/theme 及 module 的按钮/输入/状态/卡片皮肤；module 转 Tailwind 布局映射或直接 utility，Card/Alert/Badge 消费共享组件。全局只保留官方主题/base及布局、Markdown内容排版，不用宽泛后代规则覆盖默认边框/圆角/颜色/焦点。长方形上传和内容结构保留，旧自制几何不优先于用户最新要求。
4. Workspace 使用官方 SidebarProvider/Sidebar 和移动 Sheet。底部唯一头像+用户名 Dropdown，直接列账户、组件展示、插件说明、帮助、退出并分组；旧3独立控件删除。导航关闭 mobile Sheet，菜单转帮助先收菜单/Sheet再开 Dialog；Esc按层关闭并恢复焦点。保留五项移动底栏、任务模板入口和桌面隐藏共享顶栏。长名截断但完整可访问。
5. 共享私有 Portal context 为 AuthBoundary 现有 inert/aria-hidden 容器提供内部挂载点；所有 Dialog/Sheet/Menu/Tooltip 等实际 Portal 使用它，避免 body 逃逸。首次验证前不挂私有树；复验/故障同祖先暂停且保留表单；401/跨身份变化沿原逻辑卸载正文和全部 Portal。公开认证可用 body。若底层 modal 不支持内部挂载，以等效关闭浮层层且保留父草稿修复，不能放宽边界。
6. 退出仍走现有服务，pending 同步 guard 防重复，失败保账户并反馈可重试；服务成功后才清账户、取消当前聊天并回登录。其余 hooks/字段校验/autocomplete/动作UUID/模型显式触发/来源/取消保持。无后端、契约、数据迁移或真实key改动；展示页明确演示，不冒充后端新增能力。

## 分工与接口

- 根：依赖/lock/PostCSS/alias/components.json、components/ui/Portal context、Workspace/用户菜单/AuthBoundary、globals/home布局、组件展示、UI规范。
- 代理A：auth-form、account-workspace/account-models/embedding-models、agent-editor 与对应模块样式。
- 代理B：project/task/template-workspace、library-workspace、knowledge-index/search 与对应模块样式。
- 独立评测：apps/web/tests/components 下真实DOM交互测试及本轮验收文档；不写生产实现。
- 所有安装由根串行执行，根稳定公共组件接口后模块并行。新增命名函数含多行JSDoc，tests不进入生产。

## 风险与兼容

| 风险                       | 缓解                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| 旧CSS覆盖默认组件          | 移除控件皮肤/宽泛reset，浏览器检查computed token、默认/焦点/禁用。             |
| 事件/ref改变，Dialog丢草稿 | NativeSelect保DOM语义；checkbox显式onCheckedChange，受控Dialog；类型+真实DOM。 |
| 私有Portal逃逸/层叠锁死    | 统一内部容器；真实AuthBoundary复验/401与移动菜单Esc/focus验证。                |
| 漏页或业务倒退             | 17路由控件清单、残余审计、代表性完整流程和既有全量回归，不能只编译。           |
| 小屏和长内容溢出           | min-w-0/换行；代码表格局部滚动；390px逐主要页面/浮层。                         |

无数据迁移。旧资料/分片/索引/向量改前后强制只读摘要一致；公开账户/配置只读核对。创建回归使用隔离数据库/受控provider，真实浏览器仅非敏感验收数据。UI加载/保存不得隐式调用用户模型或保存key。

## 验证策略

| AC               | 实际方法/通过标准                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001–004、011–012 | 版本/registry来源、17路由控件覆盖；桌面/390px截图及computed/DOM。菜单鼠标/Enter/Space/箭头/Home/End/Esc焦点、Sheet导航/帮助无残层，展示实际共享组件。                             |
| 005、009–010     | testing-library/react + user-event + jsdom：真实菜单及AuthBoundary，退出延迟/重复/失败/成功、复验等待/故障/恢复、401/跨标签/恢复；私有Portal同祖先暂停及卸载。DOM测试不冒充布局。 |
| 006–008、013     | 既有客户端/代理/账户/Agent/项目/任务/模板/资料/向量回归，代表表单提交/失败草稿、选择/checkbox/确认取消、无隐式provider及旧数据只读。                                              |
| 014              | Web类型、API/Web生产构建、全量Vitest（隔离PG/S3）、全仓lint/format/diff及tests/产物检查；逐AC真实证据。                                                                           |

## 顺序与计划记录

T001基础 → T002/T003/T004并行迁移 → T005独立验证修复 → 逐14AC代理终审。用户既有代理授权替代人工确认，实施前等待代理Plan批准，不提前PASS。

2026-10-18：主开发者依据已批准Spec编写默认base-nova、Portal、分工及验证计划；生产尚未修改。

2026-10-18：独立评测 agent 依据用户既有阶段代理授权批准本 Plan/Tasks。已核对官方当前 CLI/default 来源、统一 Base UI 及 render/NativeSelect 事件兼容、旧控件皮肤清理、17路由分工、唯一头像菜单与真实退出、AuthBoundary 内部 Portal 容器、桌面/390px和真实 DOM/旧数据/工程验证。五项任务均有对应需求/验收、依赖及可检查完成标准；可按顺序开始实施。底层 modal 与内部容器须以真实交互检验，不能仅凭类型通过认定安全；全部14项 AC 仍待实证。

2026-10-18实施分工调整：T004范围不变，实际由任务代理负责task、产品代理负责project/template、根负责library/knowledge-index/search；修正完成代理消息未触发新回合的问题，使用明确followup启动，各文件边界不交叉。
