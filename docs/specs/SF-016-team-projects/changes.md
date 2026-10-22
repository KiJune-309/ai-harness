# SF-016：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-016     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-20 |

## 记录

### 2026-10-20 — 产品经理提出第二项 Project 需求

- **变更内容：**创建统一项目入口、个人/协作范围、权威元信息、项目成员和人工共享正文的 Spec 及参考记录；Plan/Tasks 初始化，业务代码未修改。
- **原因：**主 agent 通知 SF-015 最终通过全部验收和生产构建，按用户要求进入第二项。现有两类项目的入口/元信息不一致，成员与共享内容缺明确管理入口。
- **授权：**用户已授权“产品经理提出 → 主 agent 实现 → 测试 agent 验收”的顺序轮转，本项提出后直接进入规划实施，不额外加入文档审批。
- **关联项：**REQ-001–REQ-012、AC-001–AC-015。
- **验证：**已读取官方 Project 全文及现有 SF-003/SF-014、Workspace 边界、项目/协作 UI 与持久化实现；本期功能尚未实施或测试。
- **结论：**需求可实施；独立验收前不编写第三项上下游需求。

## 验收矩阵

| 验收标准 | 状态 | 证据（命令、结果或观察）                                                                                                                                                                                                                                       | 备注                                                 |
| -------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| AC-001   | PASS | T-FINAL实际组件验证同ID共享优先、整体更新时间排序、固定总数、名称/说明搜索、全部/仅自己/协作筛选；共享读取失败不显示完整集合或空态，重试恢复。B-UI真实390px两类型筛选后总数恒2，成员只见获授权shared。                                                         | 同ID旧私人壳不遮盖共享卡片。                         |
| AC-002   | PASS | 真PG/API创建0人、1人及20位真实有效同事项目；21人/重复/非团队/self拒绝；HTTP名称120/121、说明2000/2001边界，稳定requestId相同重放/异内容冲突。创建后chat/jobs/私人壳/notifications均0。                                                                         | 纯协作项目无需node、个人模型或普通聊天。             |
| AC-003   | PASS | 真实旧壳fixture在共享更新后，双方shared及private列表/详情均显示新名称说明，旧private PUT为409且creation原始内容保持；双pool同revision编辑仅一成功；private/shared同ID并发4轮仅一方成功，含大小写ID。                                                           | 私有壳读写不能绕过共享权威。                         |
| AC-004   | PASS | 新组件实测有本人node也停留总览，仅本人有“继续我的聊天”链接，403/500不挂载private fallback。PG投影隐藏他人source/private prompt及未选私聊；真实API旧node和收件人普通chat仍200。旧协作UI深链、事件分页/锚点及模板回归2files/41tests通过。                        | 新总览与显式node/event地址分别测试。                 |
| AC-005   | PASS | 真实HTTP/PG交叉角色：Workspace owner不是project member时列表为空、猜ID/改写/发布404；只有project owner可管理，member只可读写本人资料，其他空间及团队未选者拒绝；猜旧private壳也404。                                                                           | Workspace角色不提升项目权限。                        |
| AC-006   | PASS | PG并发同动作加人仅一次，新成员可读已存两版资料；self/remove及非团队拒绝。组件实际选择稳定ID、展示完整共享范围、取消移除无命令，确认新增才提交。B-UI真实创建预览实际成员与完整说明。                                                                            | 新增成员无新任务、模型或消息副作用。                 |
| AC-007   | PASS | PG真实旧普通chat、artifact、pending Agent draft和running job，project移除后权限拒绝/lease失效；重加共享资料和成果恢复，旧node永久cancelled、can*false，持最新node revision的retry/revise/activate仍拒绝，旧draft不能确认。旧未提交note-edit跨移除重加409。     | 不只靠旧revision冲突冒充永久撤权。                   |
| AC-008   | PASS | 同一PG用例的Workspace移除/重入分支实测旧node永久fence、原私有chat保留；纯项目成员ID仍在时缺Workspace资格照样拒绝。Workspace恢复后旧note版本未变的未提交编辑仍409；旧running job的cancelled contact intent不能借幸存thread恢复起草，本人新请求仍可起草。        | 已修复测试发现的旧node权限复活。                     |
| AC-009   | PASS | 无node项目真实HTTP/PG人工发布，作者为真实会话member；并发/丢响应重放单一v1，内部换行保持。标题120/正文32000合法边界完整回读，空白/121/32001及伪造author字段400；chat/jobs/通知不增加。                                                                         | 正文中的指令或@文本仅作资料。                        |
| AC-010   | PASS | owner改member资料404/PG拒绝；原作者v2及同动作重放不产生v3，旧版本可读、旧version/revision冲突。组件409后禁提交，显式重读保本地全文并展示最新保存版，再由本人提交新project revision及note version。                                                             | 项目授权revision同时阻断移除/重加后的旧稿。          |
| AC-011   | PASS | PG旧artifact保留并恢复共享读取，新增组件将旧成果历史与新notes分区完整显示，owner无他人编辑按钮。Agent及携真实lease伪装human的管理/资料命令拒绝；原真实发送草稿确认/协作worker回归通过，取消intent fallback有正反用例。                                         | 无新增模型发布能力或自动外发。                       |
| AC-012   | PASS | 真实API在一个private项目创建两任务，仅选其一交接后产生独立共享事项；另一任务及原private项目对同事404，其他私有描述不进入投影，owner原两任务归组保留。SF015范围回归、旧task/project/template API及UI通过。                                                      | 未把私人项目整体自动共享。                           |
| AC-013   | PASS | built main.js实际独立进程三次启动，项目/两有效成员/两版notes及原create/publish/edit动作重放保持，无第三版。HTTP将collaboration_state暂改名时shared与private项目列表均503，恢复后原资料仍在。                                                                   | 已修复private列表新查询异常的500映射。               |
| AC-014   | PASS | B-UI真实desktop/390px创建、预览、改名、筛选、notes v1/v2及历史、成员权限和Escape回焦点；innerWidth/document/body scrollWidth均390。组件实际覆盖失败保稿/原requestId、防双击、首错focus、移除取消、完整正文及409明确重读。                                      | 边界人数/长度通过PG/API/组件，不冒充手工浏览器输入。 |
| AC-015   | PASS | T-FINAL17files/104tests及旧UI2files/41tests全部通过；最终新增成果UI后本组件11tests及Web types再次通过。server生产build、db/api/web类型、root lint/format均通过，外部隔离相同源码Next生产构建含/projects及/projects/[id]成功；lib无tests，AGENTS/UI规范已同步。 | 任务与验收收口，无必需项未执行。                     |

## 最终结论

- **结果：**Accepted，2026-10-20，AC-001–AC-015全部PASS。
- **未通过或未执行项：**无必需验收项遗留；未手工操作的极限长度/人数由真实API、PG与组件边界用例明确取证。
- **后续行动：**可按用户顺序由产品经理提出第三项上下游体验；本轮不将后续节点图、模板处理人、Skills或看板记为已交付。

### 2026-10-20 — 主agent进入第二轮实施

- 已读取完整Spec，填写Plan/Tasks，按用户预授权轮转进入实现。
- 后端与Web按文件分工扩展既有项目模块，独立测试在实现后执行。
- 所有AC仍待真实验收；下一项上下游在本项Accepted之后提出。

### 2026-10-20 — 独立测试、缺陷修复与最终验收

- **独立新用例：**[真实PG](../../../packages/db/tests/team-projects.integration.test.ts)、[实际HTTP](../../../apps/api/tests/team-projects.integration.test.ts)、[生产进程恢复](../../../apps/api/tests/team-projects-process.integration.test.ts)、[真实组件](../../../apps/web/tests/components/team-projects.test.tsx)。当前新用例20项，覆盖7项PG、HTTP整链、独立进程恢复及11项组件；测试使用随机隔离schema和私有连接环境，未打印秘密，未改用户业务记录。
- **T-FINAL命令：**在私有 `TEST_DATABASE_URL` 下运行 `node node_modules/vitest/vitest.mjs run packages/db/tests/team-projects.integration.test.ts apps/api/tests/team-projects.integration.test.ts apps/api/tests/team-projects-process.integration.test.ts apps/web/tests/components/team-projects.test.tsx packages/db/tests/workspaces.integration.test.ts apps/api/tests/workspace-api.integration.test.ts apps/api/tests/workspace-process.integration.test.ts apps/web/tests/components/team-workspaces.test.tsx apps/web/tests/components/workspace-switch-acceptance.test.tsx packages/db/tests/collaboration-persistence.integration.test.ts packages/db/tests/collaboration-dispatch.integration.test.ts packages/db/tests/collaboration-races.integration.test.ts apps/api/tests/project-api.test.ts apps/api/tests/template-api.test.ts apps/api/tests/task-api.test.ts apps/api/tests/collaboration-worker.test.ts apps/api/tests/collaboration-default-model.test.ts`，同次17files/104tests全部PASS（15.21s）。
- **旧UI及最终增量：**`node node_modules/vitest/vitest.mjs run apps/web/tests/components/collaboration.test.tsx apps/web/tests/components/project-template-shadcn.test.tsx`，2files/41tests通过，包含显式node/event深链、事件锚点和模板/个人项目操作。随后补充“旧成果版本与notes分区、owner无他人编辑按钮”，本轮新组件文件11tests通过，Web类型检查再次通过；不把重叠测试次数加成唯一用例总数。
- **实际发现并修复：**collaboration_state不可用时普通项目列表原500已统一503；Workspace恢复原会让旧running责任canWork/canManage复活，现同事务永久撤销旧node/grant/question；note-edit增加project revision，阻断跨撤权代次的旧未提交稿；旧job cancelled intent不得借幸存thread/related fallback恢复起草。上述均有保留的真实PG/API负例及合法新请求正例。UUID大小写规范化、self/重复及private/shared碰撞亦已实测。
- **B-UI真实浏览器：**Web实施agent使用独立Chrome验收session及localhost隔离fixture，完成桌面创建/成员完整预览、总览、修改元信息、notes发布更新/旧版阅读；真实390px列表筛选、成员只读与本人资料操作、Escape取消回焦点，测得 `innerWidth/documentElement.scrollWidth/body.scrollWidth=390/390/390`。测试agent实际查看创建预览、移动notes版本与成员视图截图。人数20/21和最大文本边界由自动化执行，没有声称浏览器手工输入。
- **截图：**[desktop-create-preview](/private/tmp/sf016-visual/desktop-create-preview.jpg)、[desktop-overview](/private/tmp/sf016-visual/desktop-overview.jpg)、[desktop-note-preview](/private/tmp/sf016-visual/desktop-note-preview.jpg)、[mobile-note-versions](/private/tmp/sf016-visual/mobile-note-versions.jpg)、[mobile-project-list](/private/tmp/sf016-visual/mobile-project-list.jpg)、[mobile-member-view](/private/tmp/sf016-visual/mobile-member-view.jpg)、[mobile-note-preview](/private/tmp/sf016-visual/mobile-note-preview.jpg)。
- **生产构建：**主agent运行最新 `node scripts/build-server.mjs` 退出0。Web在 `/private/tmp/ai-harness-sf016-web` 使用相同完整源码副本和现有依赖链接，执行 `node /Users/kijune/Documents/code/ai-harness/apps/web/node_modules/next/dist/bin/next build --webpack` 退出0；只在临时副本关闭webpack缓存以规避嵌套路径缓存问题，正式Next配置未改。测试agent亲自读取 [构建日志](/private/tmp/sf016-web-build.log) 和 `.next/BUILD_ID`，编译/TypeScript/16静态页/build traces均完成，含个人及共享项目同一路由。
- **工程门与结论：**`pnpm --config.verify-deps-before-run=false lint`、`pnpm --config.verify-deps-before-run=false format:check`、db/api/web类型检查全部通过；新测试文件独立ESLint/Prettier通过，生产lib无tests产物。AGENTS的项目所有权段与UI规范SF-016已复核同步，T-001–T-005全部完成。本项Accepted。
