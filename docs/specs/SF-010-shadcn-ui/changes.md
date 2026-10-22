# SF-010：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-010     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-18 |

## 记录

### 2026-10-18 — 全站默认组件与账户菜单草稿

- **变更内容：**阅读现有17页面、共享布局/账户边界、原生与自制控件和全局样式，核对官方组件来源，编写全站 shadcn/ui 默认迁移与账户 Dropdown Spec，初始化另外三份模板。
- **原因：**用户明确要求所有前端组件使用 shadcn/ui 默认样式，并把更多、账户、退出合并到头像+用户名菜单，桌面/移动一致。
- **关联项：**REQ-001–012、AC-001–014。
- **验证：**已阅读现有实现/规范并核对官方资料；尚未写生产实现或运行本轮验收。所有 AC 为 NOT RUN，Plan/Tasks 未填技术方案。
- **结论：**交独立评测代理审查 Spec，随后由主开发者编写 Plan/Tasks。用户已有阶段代理授权，无需再次人工确认。

### 2026-10-18 — Spec 独立代理审查通过

- **依据：**沿用用户已明确授权产品经理/评测代理全部 SDD 阶段的决定，独立评测核对 REQ-001–012、AC-001–014 与现有17页面和共享组件；无需再次人工确认。
- **审查：**全部实际控件、空/错/忙状态及 `/components` 均在范围，官方默认样式需实际生效；旧全局 reset/焦点/圆角与模块控件样式不能抵消它。具体官方 CLI/默认 preset/primitives 家族由 Plan 固定，不把旧版本名称当通用默认。
- **交互边界：**头像用户名是唯一账户菜单触发；原更多中的组件展示/插件说明/帮助保留，账户和真实退出同菜单。桌面与移动 Sheet 的键盘、关闭顺序、导航清理和退出失败/成功分别可验收。
- **安全重点：**旧 AuthBoundary 的祖先 inert/aria-hidden 不能自动覆盖挂 body 的 Portal。新菜单/弹窗必须同样暂停或关闭、401及身份变化全部卸载；同账户恢复保非秘密草稿，不改变既有会话、幂等和显式计费规则。
- **结论：**Spec 状态 Approved — Proxy Review Passed，允许编写 Plan/Tasks。未改生产代码、未安装依赖、未执行本轮产品验收，全部14项 AC 继续 NOT RUN。

### 2026-10-18 — Plan/Tasks 独立代理审查通过

- **主开发者计划：**统一经核对的官方 CLI 默认 base-nova/Base UI，生成共享组件、默认 token 与 Tailwind 构建基础；不混用 Radix 组合 API。NativeSelect 保留事件/ref/空值，确认与表单 Dialog 改受控状态，清除旧控件皮肤。
- **权限与交互：**共享私有 Portal 挂 AuthBoundary 内部容器，与祖先 inert/aria-hidden 同受控制；不支持内部容器时采用关闭可见层并保草稿的等效安全方案。唯一头像菜单覆盖全部已有入口、移动 Sheet 层级和服务确认退出，需实际 DOM 与浏览器验收。
- **任务覆盖：**五项任务分别为基础、根共享 Shell/导航/展示、账户/Agent、项目/任务/模板/资料、独立验收，覆盖全部12REQ/14AC及17个路由。安装由根串行管理，基础接口稳定后模块并行；评测不改生产实现。
- **代理结论：**Plan 与 Tasks 状态 Approved — Proxy Review Passed，可开始实施。将运行真实菜单/退出/Portal安全测试、代表业务与旧记录只读比对、桌面/390px实际样式与完整工程回归；批准不代表任何 AC 已通过。

### 2026-10-18 — 开始实施与默认来源

- 经Spec及Plan代理批准开始实施。官方CLI4.22.0的defaults为base-nova，已用真实CLI初始化并生成共享控件，components.json确认BaseUI/Neutral；依赖与锁文件统一由根维护。
- 根完成Sidebar/用户菜单、私有Portal容器与暂停层、默认主题和共享展示首轮；代理A迁移账户/Agent，代理B迁移项目/任务/模板/资料；旧CSS皮肤移除而业务状态保持。
- 私有Portal使用内部容器，未就绪及复验/故障期间不渲染浮层层，保留父表单状态；独立DOM首轮2套17项通过，真实浏览器及完整工程验收仍待执行。全部AC保持NOT RUN直到终审。
- 改前原资料与真实向量四表只读基线已记录，不调用用户模型或改密钥。

### 2026-10-18 — 完成实现、实际交互与最终工程回归

- **实现：**17路由及共享导航/账户边界均使用真实官方默认组件。统一移除旧控件CSS/modules与主题覆盖；账户、Agent、项目、任务、模板、资料/分片/向量和组件展示完成迁移。共享菜单归并账户设置、组件展示、插件与能力、帮助和真实退出。
- **浏览器：**桌面1280与移动390共35份逐页DOM快照，全部无页面/主内容横溢出或嵌套button/a；菜单键盘/Esc逐层关闭、帮助衔接、表单校验/取消、展示页Tabs/日期/分页/进度及资料来源已实测。真实PG创建明确标识的验收模板→项目→1个未开始任务；未执行模型。
- **发现与修复：**隔离浏览器发现同账户断线恢复时，仅卸载Portal会使重新显示的菜单焦点留在body，Esc失效。现同步暂停primitive root并保留请求open状态，恢复由Base UI正常聚焦；Dialog/Sheet/Menu实际复验均焦点在浮层内且立即Esc可关闭，草稿保留。回调保留原details和isCanceled取消语义，独立真实Dialog测试通过。此前头像Unicode fallback也已按完整code point修正。
- **权限与退出：**合成账户、实际前端与受控本地HTTP API复验503/401；故障时浮层为0，正文inert/aria-hidden，恢复保非秘密草稿；401及成功退出/跨标签身份变化后私有根和浮层均为0。退出先失败保身份且可重试，再2500ms延迟成功，期间禁用并显示忙碌；最终两标签都到登录页。该故障fixture不使用生产PG或真实密钥，stub为2次退出/0次provider请求。
- **最终工程：**全量144套2009项通过、无skip（31.68s），其中7套43项实际组件DOM测试含独立4套22项；Web/API类型、Web/API生产构建、全仓lint/format均通过。最终全量与Web构建包含恢复焦点和取消语义修复；旧资料/分片/索引/向量只读摘要一致，源码与生产产物无测试suite。
- **证据：**本机私有`.local/sf010-ui-report.json`、`sf010-page-audits.json`、`sf010-existing-data-independent.json`与真实截图；工程日志`/tmp/ai-harness-sf010-full-tests-final.log`、`final-lint.log`、`final-format.log`、`final-types.log`、`final-api-types.log`、`web-build-final.log`（同前缀）、`api-build.log`。不将早期2008项或首轮测试数用作最终结果。
- **交接：**独立评测代理据上述实际证据逐项判定14AC后更新下表和最终状态；主开发者不提前宣布验收通过。原有未提交变更和真实模型配置保持，本轮未提交Git。

### 2026-10-18 — 独立终审通过与隔离资源清理

- **依据：**独立评测再次核对已批准的 Spec/Plan、实际组件与样式、最终工程日志、私有 `.local/sf010-ui-report.json` 和页面审计，并直接复看桌面/移动菜单、Gallery、资料上传/分片、项目/模板及故障恢复截图。早期批准、未执行状态和发现修复记录均保留为历史，不以最终状态改写过去。
- **独立实证：**4套22项 DOM 测试最终通过，覆盖真实 UserMenu、AuthBoundary、共享 Menu/Dialog/Sheet、真实 Workspace 移动组合及资料上传/来源；恢复断言明确要求焦点在浮层内且立即 Esc 能关闭，另验证 uncontrolled Dialog 的原始 KeyboardEvent/details.cancel() 阻止关闭。其余账户/Agent9、项目/模板7、任务5项合计为7套43项，均已包含在144套2009项全量内，不重复累加。
- **旧数据与覆盖：**评测以强制只读连接独立核对原真实云资料的文档/片/索引/向量全部行摘要，1/3/1/3条与基线精确相同，未选择凭据或返回向量原值。独立归一页面审计为390px与1280px各17条完整路由，共35份快照；生产 CSS 含默认主题、variant 和焦点样式，业务组件无遗留原生控件/原生dialog/details/旧moduleCSS，生产产物未混入验收suite。
- **故障验收界限：**真实浏览器使用复制的实际前端与合成会话、本地受控HTTP账户服务，验证503/恢复/401及双标签退出；该站不连接生产数据库或模型，不将 `storage: postgres` 契约fixture冒充真实PG。主站业务正例是真实保存模板→项目与未开始任务；本轮没有为迁移发起用户云调用、重存真实key或重建旧索引。
- **清理：**浏览器验收结束后先核对命令、父子关系与cwd，仅停止本轮QA stub45327、Next launcher45426及其child45428；3310/3311均无监听，保留主站、PG/S3及私有报告。macOS未配置127.0.0.2，曾返回EADDRNOTAVAIL，因此测试使用与主站127.0.0.1 cookie隔离的localhost，不改系统网络。
- **裁决：**AC-001–014全部 PASS，五项任务全部 DONE，最终 Accepted；没有本轮必需的失败或未执行项。

## 验收矩阵

| 验收标准 | 状态 | 证据（命令、结果或观察）                                                                                                                                                                                                                                                                                                                               | 备注                                                                               |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| AC-001   | PASS | 实读官方CLI4.22.0初始化/生成日志、`components.json` 的 base-nova/neutral 与 Base UI 组件来源。真实浏览器 computed：primary `oklch(0.205 0 0)`、radius token0.625rem、Button/Input/NativeSelect圆角10px/边框1px/高32px；键盘焦点ring3px、disabled发送opacity0.5。旧reset/主题及控件皮肤已移除，生产CSS包含对应规则。见 UI report、CLI日志和独立UI审计。 | 默认样式实际生效；必要注释、受控状态、私有Portal适配不复刻旧皮肤。                 |
| AC-002   | PASS | 实读全部17个page路由与共享组件，源码审计业务components无遗留 button/input/textarea/select/dialog/details/summary、自制GalleryButton或旧CSS模块。390/1280各17路由全部观察共享官方data-slot，35份逐页快照；列表/详情/编辑/启动与认证、边界、Gallery均有覆盖。见 `.local/sf010-page-audits.json`、独立UI审计及下方迁移清单。                              | 保留语义HTML、Next Link、Markdown及真实file能力；`/chat`兼容重定向到首页。         |
| AC-003   | PASS | 真实桌面截图仅头像+用户名触发一个Dropdown，完整保留账户设置/组件展示/插件与能力/帮助/退出。独立UserMenu用例验证完整长名称、真实链接、Unicode头像、已验证改名后重新渲染、无旧三个独立入口；Enter/Space/Home/End/方向键及选择均通过。                                                                                                                    | 头像按完整code point取fallback，未实现能力仍显示说明。                             |
| AC-004   | PASS | 实际390px菜单/Sheet Esc逐层关闭，先回头像再回“打开导航”，最终0浮层、Portal不在私有边界外；帮助转Dialog无残Sheet/Menu。独立真实Workspace使用实际mobile hook/Sidebar/UserMenu复测，任务模板仍在完整导航，底栏保留五项顺序。见 UI report、移动截图和独立DOM日志。                                                                                         | 菜单未裁切，宽度与scrollWidth均390；DOM测试不冒充布局测量。                        |
| AC-005   | PASS | 真实合成账户浏览器：首次退出延迟后503，账户保留且Alert可重试；第二次2500ms延迟200，trigger禁用且“正在退出…”，确认后两真实标签分别到 `/login` 和带changed原因登录页，privateRoot/popups各0。stub仅2次logout/0provider；独立DOM另证同步防重复及成功前不clear。                                                                                           | 使用真实前端/账户代理与受控服务，不操作主KiJune会话或冒充真实PG登出。              |
| AC-006   | PASS | 账户/Agent的9项实际DOM覆盖AuthForm/Agent首错焦点、用户名保存、聊天/embedding空key保留及零自动测试、删除默认取消焦点、busy Esc不闭和异步失败留框。类型/autocomplete/label/ref与只写key源码核对通过，既有账户客户端/代理/权限全量保持；浏览器登录注册/账户页面和错误焦点可用。                                                                           | 密钥不回显、不入URL/持久浏览器存储；测试fixture仅非秘密假值。                      |
| AC-007   | PASS | 项目/模板7项与任务5项实际DOM通过：稳定任务/Agent ID、Checkbox完成恢复、归组空值/失败、状态/折叠/停止requestId、创建失败同UUID/忙碌禁关、排序/版本冲突/明确放弃、启动重开保字段/动作。真实浏览器创建标识清楚的模板→项目→1个未开始任务，未触发模型。                                                                                                     | 加上Agent选择/工具/开场排序及不同submitter用例，冻结/幂等/草稿语义保留。           |
| AC-008   | PASS | 独立RAG3项使用真实官方Input/file/数字值，验证首错、保文件和200/40参数、失败同UUID重试、关闭归焦；来源 `?chunk=21` 页2/精确位置/焦点、HTML文字惰性、分页和下载失败保原文。浏览器原140/192/133字符分片与来源仍可读，聊天Markdown/历史/推理/输入界面正常；既有聊天SSE/取消、真实PG/S3解析与索引/来源回归全部通过。                                        | 本轮浏览器只操作上传表单和旧来源，未重新上传/索引/云查询；模型流程用既有隔离回归。 |
| AC-009   | PASS | 实际浏览器Dialog/Sheet/Menu逐个503：等待/故障时私有根inert及aria-hidden、0浮层，真实重新连接后草稿保留、三类focusInPopup均true且立即Esc关闭。对应独立DOM恢复断言通过；新增真实uncontrolled Dialog原KeyboardEvent/details.cancel()阻止关闭，解除后Esc正常。见故障/修复截图、UI report及独立日志。                                                       | 已修复首次浏览器发现的恢复焦点/Esc缺陷；不能仅以Portal重挂认定完成。               |
| AC-010   | PASS | 真实Dialog/Sheet触发401后到登录页、privateRoot/popups0；真实双标签成功退出与storage/BroadcastChannel通知均清私有UI。独立AuthBoundary另覆盖三类未授权卸载、真实storage epoch、复验不同ID拒混入及pageshow.persisted先丢旧快照再查cookie。                                                                                                                | 首次未验证不挂私有树；401/身份变化不保留原表单或Portal，业务授权未放宽。           |
| AC-011   | PASS | 评测归一35份真实页面快照，390与1280各17路由均page/content scrollWidth≤可用宽，nestedInteractive=0。真实菜单键盘与表单首错/取消/来源聚焦、长正文和局部表格滚动通过；标准控件label/角色与disabled有DOM验证，最终主站console为空、viewport已恢复。                                                                                                        | 故障站503/401是受控预期；必要代码/表格局部滚动保留，不要求所有内容禁止横滚。       |
| AC-012   | PASS | 实读新Gallery直接消费共享官方组件；实际浏览器操作默认variants/表单校验和样例保存、Tabs、Dialog取消、Calendar Popover、表格页2及进度40→60；截图可见默认焦点/disabled。旧GalleryButton/控件皮肤移除，UI规范已同步Base Nova/Neutral和768断点及历史要求替代。                                                                                              | 展示明确为本地demo，不声称新增后端或自动调用模型。                                 |
| AC-013   | PASS | 评测强制只读PG独立核对原1文档/3片/1索引任务/3向量全部行摘要与基线精确一致，未选凭据或返回向量原值；源码与完整业务/客户端/代理/权限回归保持，主站仍为原KiJune会话。视觉迁移未重存真实key或操作旧索引，受控浏览器stub providerRequests0。                                                                                                                | 原账户与配置逻辑未重写；真实模板正例只新增标识明确的未执行工作内容。               |
| AC-014   | PASS | 最终全量回归（`pnpm exec vitest run --maxWorkers=2`）144套2009项PASS/0跳过；7套43项组件DOM（含独立4套22项）是其中子集。最终Web/API类型、Web/API生产构建、`pnpm lint`、`pnpm format:check` 与diff检查通过。产物含默认主题/控件CSS，无生产tests/suite，测试均在同级tests。                                                                               | 最终全量/Web构建包含焦点和取消修复；早期2008项及尚未加强的测试只作历史。           |

## 逐页面迁移清单

| 路由/共享区域                                     | 实际共享组件与保留的业务交互                                                                                                    | 实证                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `/`、`/chat`                                      | Sidebar/UserMenu、Dialog、Collapsible、Card、Textarea、NativeSelect、Button、Alert/Badge；聊天输入/历史/停止与兼容重定向保留。  | 双尺寸路由快照、最终主站菜单/聊天截图、真实Workspace测试及原聊天回归。 |
| `/agents`                                         | Card/Input/Textarea/Label、NativeSelect、Checkbox、Tooltip、AlertDialog；稳定模型/工具ID、开场消息排序/预览/保存及切换草稿。    | 账户/Agent9项DOM与双尺寸快照。                                         |
| `/rag`、`/rag/[id]`、`/rag/search`                | 官方file/number/text控件、Card/Badge/Alert、Pagination/Progress/NativeSelect；上传、状态、下载、分片、手动索引/查询与来源。     | RAG3项DOM、真实原来源/表单与分页/索引客户端及真PG/S3回归。             |
| `/projects`、`/projects/[id]`                     | Card、Dialog、Input/Textarea、NativeSelect、Button/Badge/Alert；新建编辑、稳定任务归入/移出与确认状态。                         | 项目/模板7项DOM、真实新项目/任务与双尺寸快照。                         |
| `/inbox`、`/inbox/[id]`                           | Dialog、Input/Textarea、NativeSelect、Checkbox、Collapsible、Card/Badge/Alert；创建、完成恢复、归属、目标/冻结快照、停止/续聊。 | 任务5项DOM与真实未开始任务页及既有执行回归。                           |
| `/templates`、`/templates/new`、`/templates/[id]` | Card、Dialog/AlertDialog、Input/Textarea、NativeSelect、Button/Badge/Alert；排序、版本/草稿/重读、预览和确认生成。              | 项目/模板7项DOM、真实模板保存→预览→项目正例及双尺寸快照。              |
| `/login`、`/register`、`/account`                 | Card、Label/Input、Button、Alert、AlertDialog；认证、资料/安全及聊天/embedding连接的只写秘密与确认操作。                        | 账户/Agent DOM、账户客户端/代理与权限回归、实际两种尺寸/首错。         |
| `/components`                                     | 真实共享官方variants、表单、Tabs、Menu/Dialog/Tooltip、表格/分页、Calendar/Popover、折叠/进度/加载示例。                        | Gallery实际操作、桌面截图与双尺寸路由快照。                            |
| Workspace/AuthBoundary                            | 官方Sidebar/Sheet/UserMenu及加载/恢复按钮，私有Portal容器和Root状态暂停，保持主站会话边界。                                     | 独立22项中的菜单/Portal/组合测试与真实503/401/双标签浏览器验收。       |

## 最终证据索引与适用范围

- 完整浏览器与默认样式：私有 `.local/sf010-ui-report.json`、`.local/sf010-page-audits.json`，独立归一/生产CSS核对 `.local/sf010-independent-ui-audit.json`；相关截图由评测直接检查。
- 独立DOM：`/tmp/ai-harness-sf010-independent-dom-acceptance.log`，4套22项PASS；其余组件DOM分别见 `account-agent-tests.log`、`project-template-tests.log`、`task-tests.log`（均使用 `/tmp/ai-harness-sf010-` 前缀）。
- 最终全量：`/tmp/ai-harness-sf010-full-tests-final.log`，144套2009项PASS、0跳过，包含最终恢复焦点与取消断言。旧库缺失source map及jsdom不实现location导航的提示不影响测试通过，不将jsdom结果冒充真实导航。
- 类型与构建：同前缀 `final-types.log`、`final-api-types.log`、`web-build-final.log`、`api-build.log`；后端无本轮UI修复改动，API构建沿用已通过结果。
- 工程检查：同前缀 `final-lint.log`、`final-format.log`；终审文档定向Prettier和 `git diff --check` 通过，生产产物无测试扫描通过。文档变更后主开发者再做全仓格式/差异收尾，不需要重复已通过业务测试。
- 旧资料保全：`.local/sf010-existing-data-independent.json`、`/tmp/ai-harness-sf010-old-data-independent.log`；只返回计数/摘要，不输出私有连接、密钥、原始向量或重写原记录。

## 最终结论

- **验收日期：**2026-10-18。
- **结果：**Accepted，14 PASS / 0 FAIL / 0 NOT RUN。
- **任务：**T-001–005全部DONE，评测依用户既有阶段代理授权完成终审，无需再次人工确认。
- **未通过或未执行项：**无本轮必需项。
- **后续行动：**无阻断项。隔离验收服务已停止、主站恢复；保留明确标识的业务正例与私有证据供复查，不以本轮验收声称新增模型/检索能力。
