# SF-015：变更记录

## 元信息

| 字段     | 值                            |
| -------- | ----------------------------- |
| ID       | SF-015                        |
| 状态     | Accepted — 用户反馈修订已验收 |
| 最近更新 | 2026-10-20                    |

## 记录

### 2026-10-20 — 产品经理提出第一项 Workspace 需求

- **变更内容：**创建 Spec 和参考记录，明确侧栏位置、管理页、创建切换、两级角色、站内邀请、退出移除及兼容默认空间；初始化 Plan/Tasks，未修改业务实现。
- **原因：**用户要求按 Workspace → Project → 上下游 → 任务模板 → Skills → 看板顺序，每项产品经理出需求、主 agent 实现、测试 agent 验收。现有部署范围无法让用户主动组建团队。
- **授权：**本轮用户已明确授权上述循环，沿用用户要求直接交主 agent 实施；sdd-spec 的额外逐文档审批门由本轮明确授权覆盖，不新增确认阻塞。
- **关联项：**REQ-001–REQ-013、AC-001–AC-016。
- **验证：**已读取 AGENTS、UI 规范、账户/协作实现与现有 Spec；完整读取官方 Workspace 页面及快速开始，业务与界面验收均尚未运行。
- **结论：**需求可实施，待主 agent 规划并实现；本期通过独立测试后再编写第二项 Project。

## 验收矩阵

| 验收标准 | 状态 | 证据（命令、结果或观察）                                                                                                                                                                                                                                                       | 备注                                                  |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| AC-001   | PASS | V-SF015 的 API 真实请求覆盖空白、60/61字名称、500/501字说明；真实PG创建稳定ID及唯一owner。组件实测校验定位/失败保稿/创建重试，B-UI实测桌面及390px Sheet入口、创建后清草稿回首页。                                                                                              | 61/501边界由自动请求/组件验证，未冒充手工浏览器输入。 |
| AC-002   | PASS | DB双独立pool并发同requestId创建返回同一team、单owner；同ID不同内容拒绝。production子进程重启后同动作重试仍返回原team。组件模拟丢响应复用原requestId，switch失败只重试进入。                                                                                                    | 所有幂等记录为真实PostgreSQL。                        |
| AC-003   | PASS | HTTP无真实session的伪造user header为401；未接受者与第三人读取/切换team为403；成员目录不含团队外人员，业务旧ID统一404。                                                                                                                                                         | 非成员与不存在不泄露私有内容。                        |
| AC-004   | PASS | HTTP规范化大小写/前后空白邮箱；自邀、未注册、已成员、重复pending均409；pending时成员仍1人。真实移动邀请卡显示完整说明/邀请人/有效期，并说明站内邀请不发邮件。                                                                                                                  | 未接受不产生成员。                                    |
| AC-005   | PASS | 非收件人处理为403；双pool及HTTP并发接受仅产生一个成员；首次及移除后重邀接受均仍保留原默认空间。B-UI真实接受后“进入工作空间”持续可用，进入后team成为当前空间。                                                                                                                  | 已修复目录刷新后进入按钮消失。                        |
| AC-006   | PASS | 双pool接受/撤销竞争只一个成功终态；数据库时间到期后接受/撤销旧请求均拒绝；拒绝后不能改接受、终结可重新邀请；原收件人改邮箱、他人占旧邮箱仍只原ID能处理，同recipient新邮箱不能重复pending。                                                                                     | 邀请身份不随邮箱转移。                                |
| AC-007   | PASS | HTTP owner编辑后回读保持；member编辑/邀请/撤销/移除为403，owner退出/自移除为409；member detail无发出邀请。组件和真实390px成员页面无owner操作。                                                                                                                                 | 两级角色按真实会话仲裁。                              |
| AC-008   | PASS | HTTP在默认空间真实保存聊天、Agent、任务、项目、模板、个人模型、embedding连接、资料；切team列表为空、旧ID及资料index为404；回默认全部恢复，team新记录不出现在默认。PG向量与资料worker失权测试及原向量回归通过。                                                                 | 测试对象源为显式注入，不调用外部文件或云模型。        |
| AC-009   | PASS | AuthBoundary三项真实组件交互覆盖重验inert、同user新workspace卸载、context响应marker、远端storage事件、旧account/model迟到不混入。B-UI真实同session双tab：取消保draft，确认后两页回默认首页且旧textarea为空；HTTP新登录默认、旧session保team，独立进程重启保持活动空间。        | 自动竞态与实际双标签页共同取证。                      |
| AC-010   | PASS | HTTP/PG owner退出自删拒绝、member退出回默认失去访问、重邀后原私有聊天可读且接受仍默认。组件退出取消/失败不假跳转；B-UI实际取消焦点、Escape回触发器、确认后首页默认空间。                                                                                                       | 已修复残留session选择在重新加入后暗中恢复team。       |
| AC-011   | PASS | PG移除后目录不含该人，人工投递拒绝；新旧draft不能确认，runningjob取消、heartbeat/assertLease/settle失效，重新加入同requestId不重启。资料/向量旧lease不能heartbeat/complete/saveBatch，非成员queued源不被claim。HTTP旧context409和me默认回退。                                  | 已提交私有历史仍保留。                                |
| AC-012   | PASS | HTTP同team互读私有chat/删除他人model为404、member个人model空；PG真实人工审稿消息进入收件人普通chat且保留真实来源，第三人投递拒绝；Agent确认draft被拒，移除及重入不复活旧draft。原协作回归通过。                                                                                | 组队不授予私有所有权或模型发送确认权。                |
| AC-013   | PASS | 新账户仅默认空间；默认无团队管理，真实旧默认页面保持可用；新team无复制个人模型，member无个人连接仍取得系统模型Agent。返回默认原模型/资源完整恢复，既有账户持久化3tests通过。                                                                                                   | 未改变原workspace/user或加密范围。                    |
| AC-014   | PASS | workspace-process实际运行built main.js三次独立启动，原session/current/owner/member/pendinginvite及创建重试恢复。HTTP受控将workspace表暂改名时目录与私有请求均503，恢复后原两空间完整返回。                                                                                     | 非空数组伪成功，无内存降级。                          |
| AC-015   | PASS | 组件实际操作创建/接受/邀请/移除/退出/切换的失败保输入、防重复、取消默认焦点、长名可访问标签；B-UI桌面与390px实际流程和键盘Escape/回焦点，document/body scrollWidth均390，截图复核无横溢。focus及手动刷新邀请、卸载监听清理通过。                                               | 不以jsdom设宽度替代真实布局验证。                     |
| AC-016   | PASS | V-SF015同次6files/19tests、通用API/contracts29files/201tests、既有真实PG协作/知识/向量6files/42tests均通过；server build、db/api/web类型检查及root lint/format通过。仓库外相同Web源码副本的Next生产构建成功，生成16静态页及/workspaces，详见下方构建记录；生产lib无tests目录。 | T-001–T-005均DONE，无未完成必需任务。                 |

## 最终结论

- **结果：**Accepted，2026-10-20，AC-001–AC-016全部PASS。
- **未通过或未执行项：**无必需验收项遗留。边界值通过真实API/组件执行，390px布局与双标签页通过真实浏览器执行，未混用证据。
- **后续行动：**第一项 Workspace 本轮验收完成，可由产品经理按用户指定顺序提出第二项 Project。

### 2026-10-20 — 进入本轮实施

- 主agent读取完整spec与stage文档，补全Plan/Tasks；按用户预先授权的三步轮转进入实现。
- 已启动contracts/DB/API和Web/协作适配的文件分工；保留全部既有未提交变更。
- 任务T-001–004进行中，验收保持NOT RUN，下一项Project须等独立测试后再提出。

### 2026-10-20 — 独立测试及真实界面验收

- **V-SF015：**通过私有本地连接向环境传入 `TEST_DATABASE_URL`，未打印秘密，运行 `node node_modules/vitest/vitest.mjs run packages/db/tests/workspaces.integration.test.ts apps/api/tests/workspace-api.integration.test.ts apps/api/tests/workspace-process.integration.test.ts packages/db/tests/accounts-persistence.integration.test.ts apps/web/tests/components/team-workspaces.test.tsx apps/web/tests/components/workspace-switch-acceptance.test.tsx`。最终同次执行6files/19tests全部通过（3.94s），包含移除重入保持默认、角色权限、真实production进程恢复及focus/手动刷新新增回归。新数据库测试均使用可清理的随机隔离schema，未触碰用户业务记录。
- **独立测试文件：**[workspace DB](../../../packages/db/tests/workspaces.integration.test.ts)、[workspace HTTP](../../../apps/api/tests/workspace-api.integration.test.ts)、[production进程恢复](../../../apps/api/tests/workspace-process.integration.test.ts)、[真实表单组件](../../../apps/web/tests/components/team-workspaces.test.tsx)、[AuthBoundary竞态](../../../apps/web/tests/components/workspace-switch-acceptance.test.tsx)。维护旧账户初始化精确表清单，以包含已经真实初始化的协作8表及工作空间4表。
- **发现并修复：**接受后刷新pending目录丢失进入按钮；移除/退出后残留session选择使重新接受自动回team。两项均已加独立回归；创建requestId、邀请recipient ID、终态及旧job取消不复活均实际验证。
- **B-UI：**Web实施agent在独立 `localhost:3100` fixture完成真实桌面/390px和同session双tab操作，未修改用户原有账号；测试agent另实际查看桌面团队页、390px成员页及双tab清空截图。390px实测 `innerWidth/documentElement.scrollWidth/body.scrollWidth=390/390/390`。截图：[desktop-team](/private/tmp/sf015-visual/desktop-team.jpg)、[mobile-sidebar](/private/tmp/sf015-visual/mobile-sidebar.jpg)、[mobile-switch](/private/tmp/sf015-visual/mobile-switch.jpg)、[two-tabs-cleared](/private/tmp/sf015-visual/two-tabs-cleared.jpg)、[mobile-invitation](/private/tmp/sf015-visual/mobile-invitation.jpg)、[mobile-member](/private/tmp/sf015-visual/mobile-member.jpg)、[mobile-exited-default](/private/tmp/sf015-visual/mobile-exited-default.jpg)。截图在临时目录，不含真实密钥。
- **工程证据：**主agent回传通用API/contracts29files/201tests、既有真实PG协作/知识/向量6files/42tests通过；独立测试agent运行Web类型检查通过，新测试文件ESLint及Prettier通过。项目AGENTS工作空间数据所有权段及UI规范SF-015段已同步复核。

### 2026-10-20 — 最终生产构建与验收收口

- **生产构建：**为保持用户原开发服务可用，在 `/private/tmp/ai-harness-sf015-web` 使用相同完整Web源码副本、链接现有依赖且不安装，执行 `node /Users/kijune/Documents/code/ai-harness/apps/web/node_modules/next/dist/bin/next build --webpack`，退出0。该临时副本保留原 `devIndicators/agentRules` 配置，只对本次副本关闭webpack缓存，规避嵌套副本文件系统缓存路径的内部RangeError；正式仓库的 `apps/web/next.config.ts` 未修改。
- **实际结果：**独立测试agent亲自读取 [生产构建日志](/private/tmp/sf015-web-build.log) 与临时 `.next/BUILD_ID`；编译、TypeScript、16静态页生成及build traces完成，路由列表含 `/workspaces`。复核 `apps/api/lib`、`packages/db/lib`、`packages/contracts/lib` 无tests产物。
- **最终工程门：**`pnpm --config.verify-deps-before-run=false lint`、`pnpm --config.verify-deps-before-run=false format:check`、server build及db/api/web类型检查均通过；上述flag仅避免包管理器在现有依赖下自动重装。
- **任务一致性：**Spec为Accepted，Plan/Tasks为Complete，T-001–T-005全部DONE，总5项完成5项。
- **结论：**AC-001–AC-016均有实际观察证据，本项Accepted；不将后续Project、上下游体验、拖拽模板、Skills、看板记作本期已交付。

### 2026-10-20 — 用户反馈修订：邀请卡、只读信息与创建后留在原空间

- **用户要求：**收到邀请只需邀请卡片，卡上接受/拒绝两个 icon，无邀请不显示空栏目；基本信息只读，无编辑/保存；创建成功不自动跳转或切换，保留当前范围和页面供本人手动进入。
- **变更内容：**当前操作流程同步上述要求，追加 REQ-014–REQ-016、AC-017–AC-019；共同创建 Dialog（管理页/Sidebar/移动 Sheet）统一只读成功结果和“完成”，目录刷新不选中新详情、不丢草稿、不触发 scope 变更。Plan/Tasks 追加本次修订，原五项完成及原16AC证据完整保留。
- **授权及边界：**这是用户直接提出的修订，不新增审批；本次只收紧基本信息界面，不宣称撤销原后端 owner 接口，邀请/成员/切换的服务端协议与权限保持。
- **只读核对：**已检查当前 `team-workspaces.tsx` 的共同 CreateWorkspaceDialog、WorkspaceSelector、IncomingInvitations、TeamWorkspaceDetails 和管理页选中详情路径；产品经理未修改业务或 UI 规范。
- **验证：**本次仅文档规格和格式检查；新增功能验收由根实现后交独立测试，不提前标 PASS。

## 用户反馈修订验收（初版证据保持不变）

| 验收标准 | 状态 | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 备注                                                                                              |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| AC-017   | PASS | T-FEEDBACK真实组件验证无邀请时无region/标题/空文案；图标空text、aria-label明确，实际Tab聚焦打开完整Tooltip；接受/拒绝处理中两按钮原生disabled、重复动作无额外POST；拒绝失败保卡可重试，最后卡消失，接受后保留手动进入且可取消。B-FEEDBACK真实2pending卡各Check/X、44×44，键盘Tooltip；接受产品邀请不切scope/URL，进入只弹确认后取消；拒绝另一工程卡消失，reload后0region/0空文案。                                                                                                               | 测试发现TooltipTrigger.disabled只禁止提示，未禁原生Button；补render Button.disabled后复验PASS。   |
| AC-018   | PASS | owner基本信息Card真实名称/说明、无form/input/textarea/保存，不调用update；member同样只读，默认空间无成员管理。新组件同时点击合法撤销并验证精确API、刷新移除旧邀请；既有邀请规范化/失败保稿、移除确认、退出失败重试和显式切换仍PASS。实际owner/member DOMeditableControls均0，桌面及390只读截图核实。                                                                                                                                                                                             | 仅移除信息编辑UI，原后端owner授权未撤销；成员流程仍按原角色。                                     |
| AC-019   | PASS | 管理页与Sidebar共同Dialog仅create+GET目录刷新，no switch/notify/onNavigate，URL/未提交草稿保持。失败相同字段重试同requestId、pending防重复；成功只读server名称/说明、标题focus、人工完成后关闭；重开空表单且相同字段的新一次创建用新requestId。目录刷新失败仍保确认成功，只重读目录、不再create，原默认详情保持。真实管理页创建新team后default/URL/workspaces及已选设计详情不变、目录新增1；390从原home/Sheet创建第二team并完成，URL/current scope和完整textarea草稿保持，后续进入仍须本人确认。 | 创建失败/不确定响应及目录故障由传输mock控制，原PG创建幂等协议不变；实际成功使用隔离PG/API浏览器。 |

## 本次修订结论

- **结果：**Accepted，新增AC-017–AC-019全部PASS；初版AC-001–AC-016及其原始证据完整保留，有冲突的旧界面行为以本次最新规格为准。
- **任务与状态：**Spec/Changes Accepted，Plan/Tasks Complete，历史T-001–T-005与本次T-006–T-007共7项全部DONE。
- **遗留项：**本次三项需求无必需验收项遗留，未新增后端接口或改变成员、幂等及显式切换授权。

### 2026-10-20 — 用户反馈修订独立测试与复验

- **独立文件：**只修改`apps/web/tests/components/team-workspaces.test.tsx`，旧7项更新并增至11项。组件使用真实React、共同Dialog/Tooltip/AlertDialog和实际用户事件，mock仅API传输/账户上下文与jsdom缺少的浏览器API；不以该测试冒称真实服务端或390几何。
- **发现与修复：**TooltipTrigger的`disabled`仅禁Tooltip，不透传原生按钮；首轮两项在pending按钮仍可点击处失败。根agent为render的Button显式加disabled，复测原生disabled和重复动作均通过。官方既有Tooltip.Popup不输出`role=tooltip`，测试改为真实Tab焦点后验证实际popup的`data-slot=tooltip-content`、`data-open`及完整文案，未替换组件或伪造Tooltip。
- **T-FEEDBACK最终命令：**`node node_modules/vitest/vitest.mjs run apps/web/tests/components/team-workspaces.test.tsx apps/web/tests/components/workspace-switch-acceptance.test.tsx apps/web/tests/components/workspace-mobile-shadcn-acceptance.test.tsx apps/web/tests/components/workspace-new-chat.test.tsx apps/web/tests/lib/workspace-client.test.ts apps/web/tests/lib/workspace-context.test.ts apps/web/tests/server/workspace-proxy.test.ts`，同次7files/35tests全部PASS，8.92s，无skip。涵盖本次11项、原AuthBoundary竞态、移动导航、新聊天入口、范围marker/client/BFF。
- **本次工程：**独立Web`tsc --noEmit`exit0、新测试文件ESLint/Prettier exit0。根最后Web types、根format:check/lint（54328）全部exit0；最终Web production（7060）exit0，日志`/private/tmp/sf015-feedback-web-build.log`。使用完整源码外部隔离副本和现有依赖，根确认最终源与生产副本逐字节一致。无API/DB/core业务变动，不把初版服务端测试冒称本次重跑。

### 2026-10-20 — 用户反馈修订真实页面验收与清理

- **B-FEEDBACK实际环境：**主agent使用CUA IAB，独立真实PostgreSQL/API和合成测试账户，workers关闭、无模型调用；1280×720、855×827及390×844实际渲染。独立测试agent读取`/private/tmp/sf015-feedback-visual/evidence.json`，并实际目视最终邀请、创建成功、owner/member只读、移动无邀请及移动成功截图。
- **真实邀请：**2份pending卡只有右上接受/拒绝图标，实测44×44，Tab出现“接受邀请”提示；接受产品邀请保留default和原URL，本人点进入弹原确认并取消；拒绝独立工程邀请后卡消失，刷新后无空邀请region/占位，非伪造本地接受状态。
- **真实只读：**owner/member两种身份基本信息editableControls均0，名称/完整说明为文本，原成员区域仍在。390 document宽390，855桌面document宽855；截图未见横溢。
- **真实创建：**管理页先选择“设计协作空间”详情，创建成功后只读名称/说明、标题获焦点，“完成”关闭；仍default、原`/workspaces`和原设计详情，目录仅加入新团队。390从home真实输入“这段未发送的想法应在创建空间后完整保留。”，打开Sheet共同创建第二团队并完成/关闭Sheet，实际DOM `textarea.value`完整、URL仍`/`、当前空间仍default，无自动导航。
- **截图范围：**同目录`desktop-invitations.jpg`、`desktop-855-readonly.jpg`、`desktop-create-success.jpg`、`mobile-invitations.jpg`、`mobile-no-invitations.jpg`、`mobile-readonly-member.jpg`、`mobile-create-success.jpg`为本次可读界面证据。`mobile-preserved-draft.jpg`捕到Sheet/Dialog关闭过渡帧，不作为草稿可见或最终几何证明；草稿保持由主agent实际DOM值/URL/scope观察和独立组件测试取证，未将过渡截图当作不存在的可见正文。
- **清理：**IAB viewport已恢复、临时测试tab关闭；SIGTERM35105正常清理仅测试schema/listeners，ready=false、stoppedAt=2026-10-20T07:45:41.648Z，3100/3101无listener。原用户3000/3001（PID31325/31324）仍运行，未触碰用户真实账户数据。
