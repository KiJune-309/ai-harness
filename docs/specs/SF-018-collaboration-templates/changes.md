# SF-018：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-018     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-20 |

## 记录

### 2026-10-20 — 产品经理提出第四项任务模板需求

- **变更内容：**创建协作模板、可视布局、固定处理人、完整人工启动预览及免@精确投递规格；初始化Plan/Tasks，未修改业务代码。
- **原因：**SF-017已Accepted，用户核心缺口为节点拖拽与固定上下游人员。旧个人模板继续保留，不将固定图变成自动外联授权。
- **授权：**按用户已授权的需求→实现→独立测试轮转直接实施，不增加文档审批。
- **关联项：**REQ-001–REQ-012、AC-001–AC-018。
- **验证：**已完整读取官方模板文档、原SF004模板及最新协作/进度代码；本期功能未实施和测试。
- **结论：**可规划实施；第五项Skills在本项独立验收后提出。

## 初版验收矩阵（历史 Accepted 证据）

| 验收标准 | 状态 | 证据（命令、结果或观察）                                                                                                                                                                                                                                                                                                                       | 备注                                                                                   |
| -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| AC-001   | PASS | T-FINAL新组件真实切换个人/协作筛选、同名两卡/稳定编号和名称说明搜索，总数恒2；旧个人模板12项组件及API/service/PG/store回归通过。真实API协作仅本人目录可读，旧personal get/launch明确409，DB kindless旧记录仍为personal，双方同ID不能覆盖。                                                                                                     | 所有模板仍同一入口。                                                                   |
| AC-002   | PASS | 独立contract测试合法2/8节点、总32000、名称120/说明2000；非法1/9、空白/121/2001/8001/总32008、重复含大小写ID、多根、自引用、环、外来上游、NaN/Infinity/越界/非整数布局及未知owner字段全部拒绝。真实HTTP多根400，组件删除父节点保broken引用、保存拒绝，明确修边后成功。                                                                          | 保存整个图，不留部分有效节点。                                                         |
| AC-003   | PASS | 实际desktop pointer将(80,100)拖至(4,0)，保存v2并刷新恢复；390键盘将C的y320移至520，处理人/ID/边均不变。只有明确选上游才改为A(v3)，刷新一致，再明确改回B(v4)。组件pointer/list/keyboard回归通过，B-UI截图及局部几何已实核。                                                                                                                     | 不以jsdom虚拟布局代替实际拖拽持久化。                                                  |
| AC-004   | PASS | PG外空间处理人拒绝，模板成员非编辑者；退出B后旧B ID标inactive，同名新同事不自动取代。实际浏览器显式将本次B替换为C、重新完整预览后启动；真实owner API及原模板页面均验证保存模板仍v1/B失效，未被实例替换覆盖，同人多节点合法。                                                                                                                   | 模板不提供他人私人Agent/密钥。                                                         |
| AC-005   | PASS | T-HTTP/PG服务器冻结每节点完整opening，实际recipient chat首消息Buffer逐字节对比相等，含真实发起人/模板版本/节点ID/上下游/正文换行及来源提醒。组件完整逐节点预览、所有真实成员/共享scope，owner节点明确空chat，确认之前chat数0。                                                                                                                 | 预览无后台附加隐藏正文。                                                               |
| AC-006   | PASS | 已修复B-UI发现的移除B后503：真实team HTTP验证preflight先于model metadata，完全移除及重入旧preview均409、零副作用/解密。实际浏览器409保项目名/映射、自动聚焦反馈并禁用确认；显式重读标B失效，不自动重试。仅本次换C、新完整opening/scope预览后启动成功，保存模板仍v1/B。保存v2后旧preview409及组件缓存回归通过。                                 | 最初503仅缺陷证据，最终真实恢复流程已通过。                                            |
| AC-007   | PASS | HTTP投毒所有个人模型cipher后preview/launch/查看仍零provider调用/解密及jobs，精确3nodes/3独立bound source，header初始NULL、无Task/独立通知。A本人chat空，B/C只assistant opening，无伪user/journal承诺；三人本人输入后各用自己的model/key。                                                                                                      | 接收并不执行。                                                                         |
| AC-008   | PASS | PG同人相邻B→B两个独立chat/source和开场，直接leased Agent ask即便同account仍拒绝；明确fixed-contact合法问回准确父node。分支两B目标歧义无slot，真实“就是设计评审”后只指向该node，不能按person合并或取第一项。                                                                                                                                    | owner可无任何节点，完全没有隐藏根或本人chat链接。                                      |
| AC-009   | PASS | 真PG十条普通/引用/操作讨论输入都有真实human lease但fixedActions=[]；恶意fixed-contact/旧ask/delegate/message逐次实际propose拒绝，0草稿/新node/目标消息。HTTP受控provider故意返回未授权handoff/reply工具调用，普通“开始/分析/确认/知道了”、模板/引用及讨论尾语无外联slot、无发送。                                                              | 本人自我judgment能力与跨人固定外联明确区分。                                           |
| AC-010   | PASS | T-HTTP真实A→B→C不传mentions，明确“交给下游”产生完整实际target草稿，确认前目标无正文；专用确认后分别写B/C原chat，重复确认结果一致且正文仅一条。全过程node/chat/source均3、原goal不改、session_id不变。                                                                                                                                          | 没有delegate复制固定节点。                                                             |
| AC-011   | PASS | B自然“向上游补问”形成真实反向wait，回A原chat；A普通“确认”且恶意reply不答，明确答复后草稿绑定原questionId/v1/全文并由本人确认，答案回B同session。C真实回复后再“回传上游”无pending则仅普通message草稿，不伪造answer/批准。                                                                                                                       | 旧平行问题/跨事项及问题版本由parser和旧协作实测回归。                                  |
| AC-012   | PASS | PG多分支/同人同名不猜目标，澄清仅原candidate；提到实际标题的“帮我分析/解释/目标是什么”无slot，明确“就是设计评审”才准确选择。HTTP叶节点要求交不存在下游仍无能力；parser根无上游、未知实名、引用/假设/普通跟进及原scope澄清负例通过。                                                                                                            | 已修复previous讨论标题命中及fresh讨论尾语误授权。                                      |
| AC-013   | PASS | 新PG逐次验证cancel-dispatch、普通输入supersede、project revoke/re-add、Workspace remove/rejoin、真实target cancel及历史completed状态，旧确认全部拒绝；launch replay不恢复member/node/grant、不补发opening，原私人聊天保留。                                                                                                                    | completed为明确受控历史PGfixture，不冒称新完成UI。                                     |
| AC-014   | PASS | 两pool并发同launch结果一致，一个Project与每node一chat；不同preview复用requestId冲突。插入第2人chat触发真实PG异常后chat/project/action全回滚，同动作重试成功；成功后模板更新/撤成员再重放不回滚实例或补开场。组件网络丢响应、取消关闭重开仍同previewId/requestId。                                                                              | JSONB创建重放键序缺陷有独立保留回归。                                                  |
| AC-015   | PASS | PG成功实例后改模板goal/布局/所有处理人为owner，旧节点的模板版本/原node ID/位置/人员/source保持；旧launch重放原结果，新preview v2全为owner则独立新实例空chat。实际HTTP首次输入各用本人当前加密连接且无模板/项目description注入。                                                                                                                | 已启动映射不随模板漂移。                                                               |
| AC-016   | PASS | T-PROCESS最新built main.js真实三次独立启动：模板图/版本/位置、冻结launch、source session、跨重启pending fixed草稿全部恢复；专用HTTP确认后再重启重放无重复，target原opening及正文各一次，恰好2chat。HTTP模板表不可用catalog503、恢复后原图仍在。                                                                                                | 源草稿由测试进程在真实DB租约中起草；生产子进程完成HTTP启动/读取/确认与重放，如实区分。 |
| AC-017   | PASS | 实际desktop及390完成拖动保存刷新、长名列表/键盘、409保稿反馈焦点、失效人显式替换、逐节点完整opening/scope和Footer确认。390 document=390、Dialog358=scroll358、所有预览p/li/section无局部溢出、3关系li均356=scroll356；Footer确认713..745/取消753..785均可见。启动后A精确进入本人空普通chat，无协作面板；C两独立node，无他人chat/私人模板链接。 | 已目视最终截图；真实browser不由窗口mock冒充。                                          |
| AC-018   | PASS | T-FINAL39files/262tests全部PASS，含SF004/015/016/017及旧协作；最新server build、db/API/Web types、根format:check/lint及外部隔离Web生产build均exit0。已核生产lib包含预检、Web副本与最终源码字节一致且生产输出无测试文件；B-UI最终复验通过。                                                                                                     | provider为受控本地OpenAI兼容SSE，不宣称真实云模型。                                    |

## 初版最终结论（历史）

- **结果：**Accepted，AC-001–AC-018全部PASS，39文件262项测试及真实浏览器、工程检查通过。
- **未通过或未执行项：**无。已发现缺陷均保留具体修复与真实回归证据；受控provider不代表真实云模型质量，历史fixture与实际人工操作范围明确记录。
- **后续行动：**本轮独立验收完成，可按用户授权轮转进入第五项Skills。

### 2026-10-20 — 主agent进入第四轮实施

- 已读取完整四文档并填写Plan/Tasks，按用户预授权轮转实施。后端负责模板/事务/持久意图边界，主agent承担意图与worker集成评审/实现，Web独立图编辑器并行。
- 所有AC在真实独立验收前仍NOT RUN，不提前实现Skills/看板。

### 2026-10-20 — 独立自动化测试与缺陷修复

- **新验收文件：**[真实PG](../../../packages/db/tests/workflow-templates.integration.test.ts)9项、[真实HTTP受控provider](../../../apps/api/tests/workflow-templates.integration.test.ts)2项、[独立生产进程](../../../apps/api/tests/workflow-templates-process.integration.test.ts)1项、[组件交互](../../../apps/web/tests/components/workflow-templates.test.tsx)11项，共23项（API包含新增真实成员失效回归，组件11项）。辅助[HTTP隔离fixture](../../../apps/api/tests/workflow-api-fixture.ts)仅测试使用，不进入生产包。
- **真实隔离：**PostgreSQL随机独立schema、两pool事务/版本竞争；HTTP/provider仅测试自有loopback服务。实际正常API加密个人连接后投毒cipher验证创建/查看不解密，再还原测试记录并让真正Cordis/worker调用各人的不同key/model。测试私有URL通过环境注入，未输出真实秘密、未修改用户业务记录。
- **实际发现修复：**创建重放直接hash JSONB对象键序误报409，改为仅此处按workflow schema重排已存creation再比较，未改旧ledger哈希；旧个人模板接口读workflow新Conflict原500，已统一409并保留故障503。previous澄清仅因正文提到工作标题就续接的缺陷（“帮我分析工程评估/解释工程评估的工作说明”）已修为明确整句选项，真实lease/DB负例保留；fresh“把方案交给下游这件事，请先分析”讨论尾语也已保守阻断。另补同人相邻node直接Agent ask绕过固定intent负例与合法fixed正例。
- **T-FINAL实际执行：**私有`TEST_DATABASE_URL`下运行`node node_modules/vitest/vitest.mjs run --testTimeout=15000`，包含下列39文件，39files/262tests全部PASS（23.94s）。统一15s只提高一般CI调度余量；实际完整provider整链有独立90s上限，没有把未跑用例计为PASS，也不重复累加重试次数。
    - SF018及新增边界：`packages/db/tests/workflow-templates.integration.test.ts`、`apps/api/tests/workflow-templates.integration.test.ts`、`apps/api/tests/workflow-templates-process.integration.test.ts`、`apps/web/tests/components/workflow-templates.test.tsx`、`packages/db/tests/workflow-intent.test.ts`、`apps/web/tests/lib/workflow-template-client.test.ts`、`apps/web/tests/lib/workflow-layout.test.ts`、`apps/web/tests/lib/workflow-origin.test.ts`、`apps/web/tests/server/workflow-template-proxy.test.ts`、`packages/db/tests/accounts-persistence.integration.test.ts`、`apps/api/tests/workflow-template-service.test.ts`。
    - SF017：`packages/db/tests/project-progress.integration.test.ts`、`apps/api/tests/project-progress.integration.test.ts`、`apps/api/tests/project-progress-process.integration.test.ts`、`apps/web/tests/components/project-progress.test.tsx`、`apps/web/tests/lib/project-relations.test.ts`。
    - SF016：`packages/db/tests/team-projects.integration.test.ts`、`apps/api/tests/team-projects.integration.test.ts`、`apps/api/tests/team-projects-process.integration.test.ts`、`apps/web/tests/components/team-projects.test.tsx`。
    - SF015：`packages/db/tests/workspaces.integration.test.ts`、`apps/api/tests/workspace-api.integration.test.ts`、`apps/api/tests/workspace-process.integration.test.ts`、`apps/web/tests/components/team-workspaces.test.tsx`、`apps/web/tests/components/workspace-switch-acceptance.test.tsx`。
    - 旧协作/个人模板等：`packages/db/tests/collaboration-persistence.integration.test.ts`、`packages/db/tests/collaboration-dispatch.integration.test.ts`、`packages/db/tests/collaboration-races.integration.test.ts`、`apps/api/tests/project-api.test.ts`、`apps/api/tests/template-api.test.ts`、`apps/api/tests/template-service.test.ts`、`apps/api/tests/template-persistence.integration.test.ts`、`apps/api/tests/task-api.test.ts`、`apps/api/tests/collaboration-worker.test.ts`、`apps/api/tests/collaboration-default-model.test.ts`、`apps/web/tests/components/collaboration.test.tsx`、`apps/web/tests/components/project-template-shadcn.test.tsx`、`packages/contracts/tests/collaboration.test.ts`、`packages/db/tests/template-store.spec.ts`。
- **T-HTTP范围：**受控provider不只缺省不调用工具，而是对普通/引用/分析/确认强行返回未授权handoff/reply，应用无可用跨人slot且无草稿/目标消息；独立PG同时持真实human-origin job lease直接调用fixed-contact及旧ask/delegate/message，确实被持久边界拒绝。合法链路全部免mentions，完整审稿/专用确认、真实问题版本、原chat/source/session及目标goal不变。它验证应用和模型工具边界，不评价真实云模型的理解质量。
- **T-PROCESS范围：**子进程实际built main.js启动/HTTP保存预览及launch，父测试通过真实PG的owner输入/job lease起草完整fixed草稿；第二个全新生产进程读取并专用HTTP确认，第三次启动重放launch/confirm，正文一次、layout与session保持。没有声称子进程运行了真实云模型；完整Cordis provider执行由独立T-HTTP覆盖。
- **历史与UI边界：**completed节点是明确注入的历史持久fixture；普通target取消、撤权和重入用真实命令。pointer/表单事件在组件中真实执行，但jsdom不会证明屏幕几何，实际拖拽保存刷新、390/键盘/焦点/Footer仍须B-UI最终记录。旧personal组件已适配独立kind目录读取，既有编辑/启动语义未放宽。

- **最后增量及新发现：**fresh讨论尾语修复后，真实PG/HTTP/provider/进程/parser4files/42tests再次PASS（12.78s）。之后真实browser发现预览后完全移除B，启动在准备该同事route时先报503；已新增独立真实team HTTP用例，验证409/全无副作用、重入旧preview失效、投毒cipher与明确替换后新预览正例。在该缺陷修复及复验前AC-006标FAIL、总体Pending，不用前次PG通过掩盖API差异。

- **503修复真实复验：**新增持久preview预检在准备任何模型metadata前核验版本/人员代次，metadata期间失败再次核验，最终launch事务复用同一校验，真正存储故障仍503。独立HTTP2项已PASS（27.85s），实际A/B/C加入team、配置各自模型、冻结preview后投毒团队cipher，再完全移除B启动409；Project/node/chat/source/job/launch/通知/provider均0。B重入后同旧preview仍409；显式替换C的新完整preview启动成功且opening字节一致、原模板仍B；v2编辑使v1预览409且不增加记录。组件最终11项PASS，额外验证冻结缓存随保存v2失效，以及错误反馈聚焦、inactive reread后可改人重审。

- **最终统一回归：**在全部preflight、最后parser和UI缓存/失效人重审修复后，同次39files/262tests全部PASS（23.94s），包含最新生产lib三次进程启动；已实际查看生产`workflow-template-service.js`前置/metadata失败后二次调用`validateWorkflowPreview`及DB编译产物对应方法，未用旧产物代替新实现。新测试最终ESLint、Prettier和Web types通过。

### 2026-10-20 — 最终实际浏览器与工程验收

- **B-UI真实操作：**Web验收agent在隔离schema/loopback服务完成desktop实际pointer拖动(80,100)→(4,0)、保存v2及刷新恢复；390完整列表键盘C y320→520，布局不改人员/节点ID/边，只有显式上游选择才改边并持久化。长名列表li358、字段324..356，无局部裁切。
- **真实异常恢复：**冻结preview后由真实owner API移除B，启动409“预览中的人员资格已变化，请重新核对完整预览”，保留项目名“实际失效补位项目 · SF018”与映射、禁用确认且自动聚焦反馈。显式重读标B失效而不循环请求；本人搜索选择真实C，仅本次替换，逐节点重新核对完整opening与2成员共享scope后人工确认。创建项目`c2bb5b7a-3937-4838-9dab-af9003fcc063`，A的唯一来源`d00c1a03…`进入空普通聊天，C的两个工作仍为两个独立节点，不出现他人私聊链接。真实owner API与原模板页面均再次确认模板`6a534c9e…`仍v1，原B失效且与工程节点处理人不同，未因本次替换改写保存模板。
- **真实390几何与键盘：**document宽390；preview clientWidth/scrollWidth均358，所有p/li/section无局部溢出；3个关系li均356/356。Footer键盘确认按钮713..745、取消753..785均在844视口内可见且可达。已关闭验收tab、恢复viewport，主agent正常终止隔离fixture并清理独立schema，原用户服务与数据不变。
- **最终截图：**实际拖动/保存为`/private/tmp/sf018-visual/desktop-pointer-draft.jpg`、`desktop-graph-saved.jpg`；移动列表为`mobile-list-keyboard.jpg`；异常恢复为`mobile-stale-preview-rejected.jpg`、`mobile-inactive-assignee.jpg`；换人完整预览为`mobile-replacement-preview.jpg`、`mobile-replacement-opening.jpg`、`mobile-replacement-footer.jpg`；结果为`mobile-launched-project.jpg`、`mobile-own-empty-chat.jpg`、`desktop-template-unchanged.jpg`（均同目录）。独立测试agent已实际查看最终换人预览/Footer、项目、空聊天、原模板及先前拖动/键盘/409/失效人截图；主agent亦目视确认。`desktop-launch-service-error.jpg`仅为已修503缺陷证据，不作为PASS证明。
- **最终工程门：**主agent最新`node scripts/build-server.mjs` exit0，DB/API/Web类型检查exit0；`pnpm --config.verify-deps-before-run=false format:check`与`lint` exit0，最后测试格式化后再跑format仍exit0，日志`/private/tmp/sf018-format-check.log`、`/private/tmp/sf018-lint.log`。实际阅读格式日志确认全部匹配，扫描API/DB/contracts生产lib无测试产物。
- **Web生产构建：**相同完整源码外部副本`/private/tmp/ai-harness-sf018-web`，使用现有依赖、不安装，运行`node /Users/kijune/Documents/code/ai-harness/apps/web/node_modules/next/dist/bin/next build --webpack` exit0，日志`/private/tmp/sf018-web-build.log`包含16页生成及路由/traces完成。仅临时副本关闭webpack cache以规避环境路径缓存问题，原Next配置未改；已逐字节核对最终`workflow-template.tsx`与生产副本一致。最新服务编译产物已确认包含preview前置校验与metadata失败后二次校验。
- **结论：**全部18项AC为PASS，状态Accepted；没有用前次成功掩盖最终异常路径，也没有以组件mock替代实际布局/拖拽/生产进程证据。

### 2026-10-20 — 用户修订：仅协作流程与 React Flow（进行中）

- **来源与授权：**用户明确要求 `/templates` 仅保留协作流程，移除“全部/个人清单”分类和个人清单界面入口；节点编辑/拖拽必须使用 React Flow。沿原已授权 PM→实现→独立测试流程直接交付，无新增审批。
- **本次变更：**当前规格覆盖原双类型页面/默认个人清单及自研画布选择；新增 REQ-013–REQ-015、AC-019–AC-021，Plan/Tasks追加 T-007–T-008。保留旧personal数据/API/幂等和既有实例，授权深链仅说明+返回，越权/不存在/故障不泄露；React Flow提供真实图交互，原单根无环、逐节点完整预览和本人专用确认权限维持。
- **历史与当前状态：**原 AC-001–AC-018 的操作、PASS、39文件262项及真实浏览器证据全部是初版事实，未用其证明 React Flow。本次新增验收尚未执行，当前整体状态为 In Progress；实施与独立验收由主agent安排。
- **本次文档验证：**已只读核对现有目录/新建/深链、手写图形、选中属性/完整预览及原四文档，完成需求追溯与文档格式检查；未修改业务代码或UI规范。

## 本次修订验收矩阵

| 验收标准 | 状态 | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 备注                                                                                 |
| -------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| AC-019   | PASS | T-WEB真实模板入口组件过滤mixed目录及legacy-only空态，仅workflow计数/搜索/新建，无类型分类；旧personal深链只说明+返回，403/404/500及错ID不回落旧私有API，不显示目标/编辑/启动。实际浏览器只有1份workflow，授权personal仅说明，`/templates/new?kind=personal`仍为2个原生节点的协作编辑器。T-BACKEND本次重跑原个人store/API/版本/幂等/实例兼容；实际只读PG核对personal仍v1且与初始创建完全一致。                                                                                                                                                 | 不删除、迁移或转换历史personal，原18AC保留为历史。                                   |
| AC-020   | PASS | T-WEB使用实际React Flow：native mouse拖节点/方向键、真实Handle点击连接、duplicate/self/cycle拒绝、target唯一上游替换、实际edge target updater跨目标重连一次原子断旧target、选边移除/Delete不删工作；同名处理人精确ID、断边多根保存拒绝并显式修复。实际浏览器root(80,100)拖至(141,161)，ArrowRight至(146,161)，A→C替换B、C→A循环保原图；原生跨目标重连断开C导致单根保存拒绝，B→C修复保存v2并刷新，390列表B(380,200)→(400,200)保存v3再读不变。PG独立只读核对原3节点ID/位置/人员/链路及旧personal版本，后端非法全图回归通过。                    | React Flow为实际图交互引擎；只补缺少的浏览器几何API，没有mock库或直接调用onConnect。 |
| AC-021   | PASS | native组件验证缩放/平移不写草稿，缩放后拖动按client delta/zoom保存world坐标；完整列表44px方向控件、只读预览无可编辑Handle/方向控件，原409冲突保选中/位置/全文、人员替换及冻结预览仍PASS。实际390 document=390，列表属性双向同步；先v2只查看预览不提交，后v3完整开场/共享范围和Footer可达，经本人专用确认创建1项目3独立普通chat/source：本人空chat、同事2条assistant opening与本次preview逐字一致，零user/Task/journal/worker attempt/job/intent/draft/共享成果/问题/通知。独立18files98tests及Web类型/生产/format/lint全通过，fixture已清理。 | 启动前零项目审计、v3启动后审计分开记录；不将DB执行行统计冒称独立网络telemetry。      |

### 2026-10-20 — React Flow修订独立组件及兼容回归

- **文件边界：**更新`apps/web/tests/components/workflow-templates.test.tsx`、`project-template-shadcn.test.tsx`和`apps/web/tests/lib/workflow-layout.test.ts`；新增`apps/web/tests/components/workflow-react-flow.test.tsx`及`workflow-react-flow-fixture.ts`。原8项项目回归保留，旧personal表单/启动测试改为新建仅workflow、历史深链安全说明/错误边界。
- **实际组件方法：**使用真实`@xyflow/react@12.12.0`节点/边/Handle/Controls、native mouse和键盘事件。fixture仅补jsdom缺少的DOM尺寸、CSS矩阵、ResizeObserver、命中测试及MouseEvent.view，不触碰图变更回调或替换React Flow；组件结果不作为真实390几何证据。8项native用例包含跨target重连、缩放后world坐标与Delete不删责任；editor还验证同名实际处理人ID、保存单根校验/修复、原冻结完整preview和失败保稿。
- **修复记录：**初审补重复连接no-op guard；controlled FlowNode重建需保固定224×144的width/height/measured以保端点测量，已修并复验；按当前规格保留完整列表共用44px方向移动辅助，图形交互仍由React Flow负责。首轮jsdom缺失event.view/elementFromPoint和拖动阈值导致的环境失败已补真实事件序列，不计作产品失败或用跳过掩盖。
- **T-WEB命令与结果：**`node node_modules/vitest/vitest.mjs run apps/web/tests/components/workflow-react-flow.test.tsx apps/web/tests/components/workflow-templates.test.tsx apps/web/tests/components/project-template-shadcn.test.tsx apps/web/tests/lib/workflow-layout.test.ts apps/web/tests/lib/workflow-template-client.test.ts apps/web/tests/lib/template-client.test.ts apps/web/tests/lib/workflow-origin.test.ts apps/web/tests/server/workflow-template-proxy.test.ts`，同次8files47tests全部PASS，2.50s，无skip/Unhandled Error。
- **T-BACKEND命令与结果：**私有本地配置仅经环境传入`TEST_DATABASE_URL`、不打印秘密；`node node_modules/vitest/vitest.mjs run --testTimeout=15000 packages/contracts/tests/templates.test.ts packages/db/tests/template-store.spec.ts packages/db/tests/template-transactions.integration.test.ts packages/db/tests/workflow-templates.integration.test.ts apps/api/tests/template-api.test.ts apps/api/tests/template-service.test.ts apps/api/tests/template-persistence.integration.test.ts apps/api/tests/workflow-template-service.test.ts apps/api/tests/workflow-templates.integration.test.ts apps/api/tests/workflow-templates-process.integration.test.ts`，10files51tests全部PASS，13.38s，无skip。此集合包括契约/显式DI服务单测，以及真实随机PG schema、多pool/HTTP、受控provider、三次独立生产进程；不把其中纯单测冒称真实API。
- **兼容与授权实证：**真实PG保personal/workflow类型与稳定ID、版本/幂等/已有个人实例，非法2–8全图拒绝；固定source/精确开场、人员代次、恶意无本人意图工具拒绝、专用草稿确认、三人/反向问题及三boot均本次重跑通过。两组共18files98tests；本次没有API/DB/core业务改动。

### 2026-10-20 — React Flow修订实际页面、人工启动与工程收口

- **B-REACTFLOW真实环境：**CUA IAB、`localhost:3100`独立合成账户/PG团队，桌面及390×844；未用用户原3000/3001记录作测试写入。实际拖动、原生方向键、Handle连接/循环拒绝、edge端点重连、单根拒绝/保稿/修复、v2保存重读及v3列表等价编辑均由主agent操作。完整动作记录见`/private/tmp/sf018-reactflow-visual/evidence/browser-acceptance.json`，独立测试agent已实际读取。
- **分阶段审计：**`database-audit.json`为启动前repeatable-read READ ONLY审计：workflow v3三节点精确位置146,161 / 400,200 / 680,320、原ID/处理人/上游保持，personal v1与creation相同；2个preview而无项目/源/chat/执行记录。v2全预览只有查看、未点击确认，不据此声称已启动。
- **实际v3人工启动：**390完整预览逐节点实际收件人/开场与共享范围；确认按钮y713.7..745.7、取消y753.7..785.7均在844视口内。主agent通过专用确认创建项目`f5b192a6-d2a9-404c-b564-34f5830138db`，3实际成员/3责任；本人精确chat`a841e03f-3dfd-4e19-bf13-6b764334db1c`有1底部输入器、0消息、0流程图，未发送输入。
- **启动后实际PG核验：**独立辅助agent在同一测试schema只读事务生成`after-launch-audit.json`，独立测试agent已读取全部结果：9checks PASS，恰好1launch/1共享Project/3独立chat/source，冻结v3原节点/位置/人员及链完整；本人0message，两位同事各1条assistant opening与本次preview SQL逐字比较一致；user/Task/journal/worker attempts/jobs/intent/draft/thread/共享成果/问题/通知均0。旧personal仍v1、workflow仍v3。workers禁用；没有独立provider-call账本，以上是持久执行证据，不冒称网络遥测。
- **真实图片与布局：**同目录`desktop-react-flow.jpg`、`mobile-react-flow.jpg`为v2；`mobile-node-list.jpg`为v3，document宽390、方向按钮44×44，完整长名/负责人/上游及属性可达。`mobile-preview-footer.jpg`、`mobile-launched-project.jpg`、`mobile-own-chat.jpg`为v3专用确认及结果。独立测试agent实际查看全部6张最终图，未见页面横溢或正文遮断；未用初版自研图证据证明React Flow。
- **最终工程门：**独立Web`tsc --noEmit`与5测试/helper文件ESLint/Prettier exit0；根Web types、根format:check/lint及最终Next Web production均exit0，实际读日志`/private/tmp/sf018-reactflow-{production-build,typecheck-web,format-check,lint}.log`，生产完整17页/routes/traces完成。外部完整源码副本`/private/tmp/ai-harness-reactflow-web`使用已存在依赖，临时副本关闭webpack cache规避环境路径缓存问题，源Next配置不变。已独立逐字节比对graph/template/catalog/helper/globals及两个template route共7源码全部相同，BUILD_ID存在。
- **清理核验：**`cleanup-audit.json`实际确认SIGTERM39535 exit0、ready=false、stoppedAt=2026-10-20T08:30:56.337Z，独立schema已不存在、3100/3101无listener；原3000 PID31325/3001 PID31324仍监听未操作。测试tab已关、viewport已恢复。

## React Flow修订最终结论（历史）

- **结果：**Accepted，新增AC-019–AC-021全部PASS，18files98tests本次全部通过；原AC-001–AC-018及39文件262项等初版证据完整保留为历史，冲突的旧界面以本次规格覆盖。
- **状态与任务：**Spec/Changes Accepted，Plan/Tasks Complete，T-001–T-008全部DONE；本次三项必需验收无FAIL/NOT RUN遗留。
- **范围：**协作流程是当前模板界面唯一类型，历史个人数据/API/实例保留；图形编辑使用真实React Flow，原完整人工预览、逐节点来源及本人固定联络/专用确认边界保持。

### 2026-10-20 — 用户节点入口反馈（进行中）

- **用户事实：**用户在 `/templates/new` 标记“完整节点列表”要求删除，并询问如何创建节点。此前 React Flow 修订 AC-019–AC-021 已通过，证据保留；本轮不以旧列表/键盘图片证明新界面。
- **产品决定：**只保留真实 React Flow 画布，删除“流程画布 / 完整节点列表”切换和列表正文。将属性底部新增动作移至画布上方的唯一“添加节点（n/8）”按钮，说明新节点默认是选中节点下游；新增稳定 ID、选中并露出新节点，属性区立即可编辑名称/说明/处理人/上游。保留2–8、busy、位置与关系分离、原生节点键盘选择、方向辅助、上游选择、完整预览及人工确认权限。
- **追溯与授权：**追加 REQ-016 / AC-022、T-009实施 / T-010独立验收，当前整体为 In Progress。按本次明确反馈及既有顺序交付授权直接执行，无新增审批；未修改后端/API/业务数据，不新增模型或自动外联能力。
- **PM文档范围：**本次仅修订 Spec/Plan/Tasks/Changes 与参考记录；业务实现、独立测试、实际浏览器及工程检查由主 agent 安排，尚未记为通过。

## 本轮节点入口验收矩阵

| 验收标准 | 状态 | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 备注                                                                                                                                                       |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-022   | PASS | T-ADD-WEB 本轮8测试集50项全部PASS：无模式/列表、唯一画布上方入口、当前选中父节点新增稳定ID、实际native fitView露出/选中/名称focus，完整旧节点不变，失败保稿重试、新建2节点/显式改父/本人处理人/busy、8上限、2删除下限、native键盘及只读预览。B-ADD 实际1176桌面新增并改父保存v2，刷新新ID/正文/人员/关系/位置恢复；390新建2→8，44px入口、Enter选中、原生方向键及辅助移动，无页面横溢。PG只读10checks PASS：v2四节点、原3ID/人员/关系/位置保留、新节点正文精确、手机8节点草稿未保存、仅1份四节点preview且零项目/chat/source/执行/联络记录；工程门通过，环境已清理。 | 本轮8files50tests；未重新执行上轮后端51项。原3正文保持由组件完整payload比较支持，PG报告原3goal投影省略不作其正文比对证据；预览本轮仅查看取消，未确认启动。 |

### 2026-10-20 — 节点入口修订独立组件验收

- **实现边界：**`workflow-graph.tsx` 删除模式 Radio 与完整节点列表分支，只保留真实 React Flow；画布工具栏唯一“添加节点（n/8）”，就近说明默认选中节点下游。`workflow-template.tsx` 复用稳定 ID/布局/单父草稿，新增后选中、通过原生 `fitView` 露出并聚焦节点名称；原属性底部新增入口移除。新增不自动保存、预览或启动。
- **独立测试：**更新 `apps/web/tests/components/workflow-react-flow.test.tsx`、`workflow-templates.test.tsx`、`project-template-shadcn.test.tsx`；原列表操作改为真实原生节点选择。新增三项验证已存模板添加/失败重试保稳定ID与全文、新建2节点添加并显式改上游/真实本人处理人/保存中禁止新增，以及独立ID逐次到8禁用。保留真实拖动/端点连接重连、环拒绝、断边单根校验、删除影响/2下限、同名精确选人、409完整保稿和冻结预览/重试边界。
- **T-ADD-WEB命令与结果：**`node node_modules/vitest/vitest.mjs run apps/web/tests/components/workflow-react-flow.test.tsx apps/web/tests/components/workflow-templates.test.tsx apps/web/tests/components/project-template-shadcn.test.tsx apps/web/tests/lib/workflow-layout.test.ts apps/web/tests/lib/workflow-template-client.test.ts apps/web/tests/lib/template-client.test.ts apps/web/tests/lib/workflow-origin.test.ts apps/web/tests/server/workflow-template-proxy.test.ts`，同次8files50tests全部PASS，3.11s，无skip/Unhandled Error。真实库未mock；浏览器几何fixture仍仅弥补jsdom缺失API，不作为实际390布局证据。
- **检查与范围：**本轮3个改动测试文件的ESLint、Prettier及Web完整 `tsc --noEmit` 均exit0。首轮新增断言“未设置处理人”同时命中画布/属性造成测试选择器歧义，已限定真实新增节点并完整复跑通过；未发现业务缺陷。本轮没有API/DB/core变更，未重新运行上轮后端10files51tests，不将旧98/262项数字计为本轮执行。

### 2026-10-20 — 节点入口实际页面、PG审计与工程收口

- **B-ADD真实环境：**主agent使用CUA IAB、独立合成账户/PG团队及 `localhost:3100`。独立测试agent已完整读 `/private/tmp/sf018-add-node-visual/evidence/browser-acceptance.json`。桌面实际测试宽1176、document1176：Enter选产品节点后，唯一上方按钮将3节点增至4，新ID `c6a8e791-c81d-44b1-9a56-c875d8d7124b` 默认父为产品、位置530,450，真实原生视图露出、名称focus。人工填“节点创建体验”和完整说明、选本人，再明确将上游改为工程；保存v2刷新后新增身份/正文/处理人/上游/位置恢复。四节点只读preview无新增/Radio/列表，查看后取消，未点击确认。
- **实际390与键盘：**`/templates/new` 默认2原生节点、document390，唯一新增按钮44px且初始y428..472；原生Enter选择第二节点后新增，默认父匹配并完整露于原生画布。原生ArrowRight及44px方向辅助将新节点800,650改到825,650，属性同步；连续添加至8，各ID独立且唯一入口禁用，未保存或启动。
- **实际图片：**同目录 `desktop-add-node.jpg`、`mobile-add-entry.jpg`、`mobile-new-node.jpg`、`mobile-eight-node-limit.jpg` 四图由独立测试agent实际查看。桌面截图另以1280×1400完整展示新增节点及属性；390入口、方向控件、属性和上限可达，无页面横向溢出。原完整列表图片仅保留上轮历史，未用于本轮证明。
- **PG独立只读审计：**已完整读 `database-audit.json`，辅助agent在生成schema的repeatable-read READ ONLY事务核验10checks全部PASS。仅1份workflow v2/4个独立节点与1份旧personal v1；新增节点名称/完整goal、本人ID、改后的工程父节点和530,450精确符合保存结果；原3节点ID/人员/上下游/位置均保持，手机8节点草稿未落库。报告对原3goal主动投影为null以省略正文，不是数据库为空，也不据此宣称SQL逐字核对旧正文；原3完整正文不变有本轮组件完整payload比较支持，浏览器重读确认针对新增节点。
- **预览与副作用界限：**PG恰好1份v2/4节点preview，0launch/project/chat/source/Task/chat message/journal/worker attempt/job/contact intent/draft/共享问题成果/通知；旧personal仍v1并与原creation一致。workers禁用，schema没有独立provider-call账本；该结果是持久执行证据，不冒称独立网络遥测。本轮没有实际启动，沿既有完整人工确认边界只查看取消。
- **最终工程门：**主agent最新Web typecheck、根 `format:check`/`lint` 和Web生产构建均exit0；独立测试agent已实际读取同目录 `typecheck-web.log`、`format-check.log`、`lint.log`、`production-build.log`。Next production完成全部17页/routes/traces。外部Web副本 `/private/tmp/ai-harness-add-node-web` 使用现存依赖，临时副本关闭webpack cache、源Next配置不变；独立逐字节比对 `components/workflow-graph.tsx`、`components/workflow-template.tsx` 与源均一致，`.next/BUILD_ID`存在。
- **清理实证：**已实际读 `cleanup-audit.json`：SIGTERM49859正常exit0，ready=false，stoppedAt=2026-10-20T09:03:00.258Z，隔离schema已不存在，3100/3101无listener；原3000 PID31325、3001 PID31324仍在且未操作。测试tab5已关、viewport恢复，未使用真实用户草稿。

## 节点入口修订最终结论

- **结果：**Accepted，AC-022 PASS，本轮8个测试集50项通过；AC-001–AC-021及各阶段真实证据完整保留为历史，本轮无FAIL/NOT RUN遗留。
- **状态与任务：**Spec/Changes Accepted，Plan/Tasks Complete，T-001–T-010全部DONE；共10项完成，待办/进行中/阻塞均0。
- **交付范围：**任务模板只保留React Flow节点视图，画布上方提供唯一明确新增入口。稳定ID、原生键盘与方向辅助、显式改上游、2–8/保存中禁用、版本冲突保稿和完整人工启动权限保持。

### 2026-10-20 — 开始/结束与节点属性弹窗产品修订

- **用户事实：**用户在 `/templates/new` 要求默认开始节点和结束节点，并要求编辑节点时表单通过弹窗出现，不再从下方展开撑高页面。AC-001–AC-022 的既往验收记录保持历史，本轮不复用旧属性卡图片为新弹窗证据。
- **产品决定：**每张编辑/只读预览图派生各一个开始/结束结构节点，开始连原无上游工作、各末叶连结束；结构节点/边固定只读、无处理人/正文，不占2–8工作名额或成为联络目标。新建保原2个工作并显示两端，旧模板自动补充可视边界；不改 contracts/API/db，不把结构节点写入保存、业务preview或启动映射，不新增工作/chat/source/成员/执行或迁移旧实例。非法业务图仍按原单根连通无环校验。
- **弹窗决定：**工作节点正文单击/显式编辑打开Dialog，新增自动打开聚焦；移除常驻属性表单，拖动/Handle/连线及视图操作不误开。复用同一未保存草稿，完成/关闭保留输入并提示需保存模板；错误定位对应节点弹窗，失败/冲突保稿，删除保原专用确认。390px纵向滚动/Footer可达，焦点约束/恢复、busy及启动只读边界保持。
- **追溯与授权：**新增 REQ-017–REQ-018 / AC-023–AC-024、T-011实施 / T-012独立验收。用户已明确授权功能变更，沿既定轮转直接实施，无新增审批；当前 In Progress，新两AC尚未验收，不能以原PASS推断通过。

## 开始/结束与属性弹窗本轮验收矩阵

| 验收标准 | 状态 | 证据                                                                                                                                                                                                                                                                                                                                                        | 备注                                                                                       |
| -------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| AC-023   | PASS | T-BOUNDARY-UI/COMPAT本轮8files55tests通过：真实native固定边界与多根投影、8业务上限、旧节点/保存payload/完整preview映射。B-BOUNDARY桌面真实3工作+2结构、native拖动/连线成分支、保存v2刷新，390新建2工作+2结构；PG14checks PASS，3原UUID/全文/人员/位置/显式父变更精确一致，preview仅3业务/3成员、无虚拟ID，未保存手机草稿且零执行/联络记录。                 | 本轮未实际确认launch、未重新运行旧后端51项；结构仅Web投影，旧22AC保留历史。                |
| AC-024   | PASS | T-BOUNDARY-UI验证Dialog portal、名称focus、Tab约束、完成/Escape/X保稿返焦、精确错误定位、失败/409全文保留、busy/删除/只读边界；真实desktop1176底页高度1368恒定，390底页1522恒定/document390，358px弹窗及搜索结果内部滚动、Footer可达，新建新增自动开并定位错误根。实际5图/JSON已独立查看；types/生产build/lint/format通过，副本字节一致，PG及环境清理通过。 | 完成/关闭仅保留当前草稿，持久化仍须保存模板；无inline节点表单，用户开发服务3000/3001保留。 |

### 2026-10-20 — 开始/结束与节点弹窗独立自动化验收

- **实现边界：**`workflow-boundaries.tsx` 将已有业务图的根/末叶适配为每图各一个真实 React Flow 开始/结束节点及固定边，结构只读且不写入业务草稿。`workflow-graph.tsx` 保持业务节点原生拖动/键盘/连接，正文单击及显式“编辑节点”打开已有草稿，Handle和拖动不触发编辑。`workflow-template.tsx` 移除常驻属性卡，以主表单之外的 Dialog 承载原字段；新增自动打开，完成、Escape及关闭均保留草稿，保存节点错误定位到对应弹窗。
- **T-BOUNDARY-UI实际执行：**`pnpm --config.verify-deps-before-run=false exec vitest run apps/web/tests/components/workflow-react-flow.test.tsx apps/web/tests/components/workflow-templates.test.tsx apps/web/tests/components/project-template-shadcn.test.tsx`，3 files / 41 tests 全部PASS，3.15s（17:24:40启动，日志 `/private/tmp/workflow-terminal-tests.log`）。新测试使用真实 `@xyflow/react`，未替换图组件或事件处理器；保留既有仅补jsdom浏览器几何的fixture。
- **结构节点证据：**旧3工作图出现2结构/4条边，业务草稿完整未变；结构节点真实点击、双击、鼠标拖动、方向/Delete及端点点击，不触发选择/编辑/位置/上下游业务回调，固定边不选择/重连/移除。多根非法草稿如实投影，不暗改父节点；原单根保存校验继续拒绝。新建2工作+2结构，工作数由2至8时独立UUID/当前父节点保持，结构不占新增/删除名额；保存输入严格只含业务节点，旧ID/人员/上下游/位置/全文不变，完整服务器预览与启动请求保持原映射。
- **弹窗证据：**390媒体条件下，初始与关闭时不存在节点字段；打开的Dialog在portal中、主表单之外，底层表单字段数不变。正文点击与显式编辑打开，原生Enter仅选择、拖动及Handle连接不误开；新增后聚焦节点名称。Tab留在弹窗，完成/Escape/X均保完整名称/说明/上游，焦点回显式编辑按钮；字段错误保存定位实际第三个业务节点及无效名称。原同名处理人精确ID、2–8上限、pending保存禁用新增/编辑、故障与409保完整草稿、删除专用确认和断边修复、完整预览/显式启动与幂等失败重试继续通过。
- **T-BOUNDARY-COMPAT实际执行：**另运行 `pnpm --config.verify-deps-before-run=false exec vitest run apps/web/tests/lib/workflow-layout.test.ts apps/web/tests/lib/workflow-template-client.test.ts apps/web/tests/lib/template-client.test.ts apps/web/tests/lib/workflow-origin.test.ts apps/web/tests/server/workflow-template-proxy.test.ts`，5 files / 14 tests 全部PASS，360ms（17:29:35启动，日志 `/private/tmp/workflow-terminal-compatible-tests.log`）。覆盖原布局/图校验帮助函数、workflow及旧personal客户端、来源映射、BFF身份/空间/版本转发；与组件组不重叠，本轮共8文件55项，没有重复累加运行次数。
- **当前检查与限制：**本轮修改的3个组件测试文件Prettier及ESLint均exit0。组件证据不替代实际屏幕几何、PG审计或生产构建；这些仍待主agent实际完成，当前 AC-023–AC-024 尚不记PASS，整体保持 In Progress。原AC-001–AC-022及上轮后端51项保持历史，本轮未重新执行后端/API/core套件。

### 2026-10-20 — 开始/结束与节点弹窗实际页面及工程核对

- **B-BOUNDARY真实环境：**主agent通过CUA使用 `localhost:3100` 的独立合成账户与PostgreSQL团队；测试agent完整读取 `/private/tmp/sf018-terminal-dialog-visual/evidence/browser-acceptance.json`，并实际查看同目录5张新截图。未修改用户现有草稿，测试tab6已关闭并恢复viewport。
- **桌面1176实测：**document1176，已有3个工作节点及各1开始/结束，常驻节点输入0；编辑前、打开Dialog、Escape关闭后route高度均1368，表单没有撑高底页。正文单击打开576×609弹窗并聚焦名称，产品说明追加“弹窗编辑已确认。”后Escape保留并返回显式编辑按钮。原生Enter仅选择；原生拖动把根从80,100移至118,134而不误开；原生Handle将工程父节点明确改为根后，两片叶各连接结束。边界节点点击不编辑/选择工作。明确保存v2并刷新，原工作ID及人工变更恢复。
- **实际390与长表单：**document390，route在初始、Modal打开及搜索出2个真实同事时均1522。弹窗358×679，y82.5–761.5，完成按钮y713.5–745.5；出现搜索结果后弹窗高759.59、y42.2–801.8，内容scrollHeight606/clientHeight583，内部真实滚动，Header/Footer仍可达。键盘显式编辑、关闭保稿均可用。新建页2工作+2结构且常驻输入0；新增至3自动打开、聚焦名称，完成保草稿；明确保存触发原空白根的名称/说明/处理人校验，自动定位真实根节点的无效名称并在弹窗显示全部相关错误，未持久化该草稿。
- **只读预览实测：**已保存v2完整预览仍是3个业务工作及3个人员字段，图额外只读显示2个结构节点，0可拖动节点、0节点编辑入口。查看后取消，未确认启动。本轮实际页面不声称新跑实例创建、固定联络或真实模型执行，原人工确认权限由适用组件回归及未改动的业务契约保持。
- **图片：**`desktop-boundaries.jpg`、`desktop-node-dialog.jpg`、`mobile-node-dialog.jpg`、`mobile-dialog-scroll.jpg`、`mobile-node-validation.jpg` 均为本轮真实截图；测试agent已逐张目视，未使用上轮常驻属性卡或过渡缩放图片作为本轮证据。
- **工程门核对：**已实际读取 `/private/tmp/sf018-terminal-dialog-types.log`、`sf018-terminal-dialog-format.log`、`sf018-terminal-dialog-lint.log`、`sf018-terminal-dialog-web-build.log`：Web类型、根格式/ESLint无错误，Next生产完成17/17静态页与routes/traces。独立逐字节比对当前 `workflow-graph.tsx`、`workflow-template.tsx`、`workflow-boundaries.tsx`、`globals.css` 与生产副本 `/private/tmp/ai-harness-terminal-dialog-web`、实际视觉副本均相同；`.next/BUILD_ID`存在，生产输出没有`*test.ts*`路径。源Next配置未改，临时副本关闭webpack cache，不影响3000上的开发服务。
- **当前结论：**自动化与实际页面证据通过，等待隔离PG最终只读审计及清理后再将本轮AC/任务及整体状态收口；不把旧后端51项计为本轮执行。

### 2026-10-20 — 开始/结束与属性弹窗最终PG审计及清理

- **PG完整字段审计：**独立测试agent完整读取 `evidence/database-audit.json`，辅助agent在随机隔离schema的repeatable-read READ ONLY事务核对14checks全部PASS。仅原3个业务UUID/v2，原名称/说明、每个完整title及assignee精确保持；以creation中完整goal比较确认只有产品说明多出本次明确附加句，其他正文无改。根坐标严格118,134、其他原坐标保持，工程唯一父节点为本次原生连线选择的根；存储及creation无`workflow-start`/`workflow-end`。旧personal仍v1且完整内容与原creation相同，手机新建3工作草稿未落库。
- **预览与副作用审计：**恰好1份v2完整服务器preview，仅原3工作和3真实成员，其全部工作字段与已存版本相等；没有虚拟结构身份或额外处理人。launch/personal project/chat/source/job/contact intent/dispatch/aggregate project/node/question/action/message/notification均0，Task/message/journal/worker attempt也均0。workers禁用，schema没有provider-call专用账本；此为持久执行证据，不冒称独立网络遥测，也不声称本轮已实际启动实例。
- **清理实证：**已完整读取 `evidence/cleanup.json` 和最终state。测试PID56565经SIGTERM正常exit0，stoppedAt=`2026-10-20T09:42:31.544Z`；ready=false，隔离schema已移除，3100/3101无listener。3000 PID31325与3001 PID31324原服务保留，用户项目可继续使用；测试tab已关、viewport已恢复。

## 开始/结束与属性弹窗修订最终结论

- **结果：**Accepted，新增AC-023–AC-024全部PASS，本轮8个互不重叠Web测试集共55项通过；实际桌面/390、键盘、PG完整字段/预览审计和生产工程门均具备本轮证据，隔离测试环境已清理。
- **状态与任务：**Spec/Changes Accepted，Plan/Tasks Complete；T-001–T-012全部DONE，共12项完成，待办/进行中/阻塞均0。AC-001–AC-022的分阶段历史证据未改写为本轮新执行。
- **执行范围：**本轮仅Web派生结构边界与节点属性弹窗；未改变contracts/API/db或实例主记录/联络授权。页面实际查看完整预览后取消，未确认launch；旧后端51项及更早262项验收只保留历史，不计入本轮55项。既有真实启动/固定联络与实例冻结的已验收边界保持，未增加模型或外联能力。
