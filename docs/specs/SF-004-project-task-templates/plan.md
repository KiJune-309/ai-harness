# SF-004：功能实施计划

## 元信息

| 字段      | 值                 |
| --------- | ------------------ |
| ID        | SF-004             |
| 状态      | Completed          |
| 关联 Spec | [spec.md](spec.md) |
| 创建日期  | 2026-10-17         |
| 最近更新  | 2026-10-17         |

## 技术方案与理由

复用现有签名身份、ChatService、ChatStore、项目与Cordis任务执行。模板是有序任务蓝图，只保存名称/目标/Agent引用，不产生会话或模型请求。首次启动在服务端解析实际助手配置，再以单个原子批次保存项目、所有独立任务和成功启动动作。任务仍逐一明确开始。

模板使用递增整数version，编辑提交所读version；存储CAS拒绝旧版本。模板创建保留原始规范化输入，编辑不修改该输入；启动动作同样保存原始templateId/version/项目参数及原任务ID。成功重放先验证模板scope并匹配原动作，再读取原项目当前记录，返回原任务ID，不重新解析Agent、检查当前模板version或重建任务。

## 模块、接口与数据流

### 契约

packages/contracts新增 templateTaskSchema({id:UUID,title:trim1..120,goal:trim1..8000,agentId?:UUID})；templateInputSchema({name,description,tasks})，1..8项、条目ID唯一、目标合计≤32000。createTemplateSchema增加requestId；updateTemplateSchema增加version；projectTemplateSchema增加id/version/创建更新时间。launchTemplateSchema为{requestId,version,name,description}；templateLaunchResultSchema为{project,taskIds:UUID[]}。

PersonalProject增加可选templateOrigin:{templateId,version,taskIds}，用于初始条目顺序追溯。getProject按origin.taskIds顺序列现存所属任务，其余新归入任务按原最近更新顺序附后；移动不篡改origin。

### 存储

ChatStore增加可选templates:ProjectTemplateStore和instantiateTemplateProject(scope,batch)。内部类型：StoredProjectTemplate={template:ProjectTemplate,creation:TemplateInput}；StoredTemplateLaunch={requestId,templateId,version,input:ProjectInput,taskIds}；TemplateProjectBatch={project:StoredProject,tasks:PersonalTask[],launch:StoredTemplateLaunch}。启动requestId同时作为新项目ID。

ProjectTemplateStore提供list/get/save(scope,record,expectedVersion?)及getLaunch(scope,requestId)。无expectedVersion为首次插入，有expectedVersion为CAS更新；失败抛TemplateConflictError供API转409。原始creation只在创建时写入。新增scoped JSONB表harness_project_templates、harness_template_launches，父pool复用。

PG原子批次使用同一client BEGIN/COMMIT：按scope读取模板FOR SHARE并核对version，插入项目、依序插入完整任务快照、插入成功启动动作；所有插入禁止覆盖已有ID，任何异常ROLLBACK并释放client。CAS编辑与FOR SHARE保证提交看到完整版本，锁/唯一键冲突提供明确409。不要用多次普通save伪造事务。

memory先构建隔离的project/conversation/launch草稿Map，逐项校验和查重，全部完成后同步发布，期间无await或可见中间状态；非法后项的失败证明不会发布前项。支持scope与深复制，close清空。

### API

沿用ChatService，TemplateController提供GET/POST /api/chat/templates、GET/PUT /:id、POST /:id/launch。公开响应分别{templates}、ProjectTemplate和TemplateLaunchResult。业务方法listTemplates/getTemplate/createTemplate/updateTemplate/launchTemplate。

模板保存及首次启动验证所有Agent引用。模板变更/首次启动共用scope下template:id锁，首次启动同时持有project:requestId锁，防普通createProject碰撞；锁在首个await前保留。成功重放只读，故不锁/回滚原任务。PG还进行版本/唯一ID检查，不宣称已有分布式执行器。

首次启动缓存Map<agentId或default,AgentDefinition>：同一助手含通用默认仅解析一次；每条目标生成独立任务ID、独立开场消息ID、独立历史，冻结同一配置内容。不同Agent没有全局版本承诺。复用taskAgent及提取的新任务快照构建helper，不调用runtime；启动整体校验后交原子存储。普通项目创建遇到templateOrigin项目ID即拒绝，避免按同名参数误重放模板动作。

### Web及导航

新template-client沿用requestChatResponse超时、中文错误、取消和严格响应；BFF仅增加固定templates列表/详情/保存/launch路径及方法。

/templates列表/搜索/创建，/templates/new完整编辑器，/templates/[id]稳定详情/编辑与启动预览。编辑器保留稳定itemId，添加/删除/上移下移有可访问名称，至少一项；本地字段/总量校验与schema一致。首次创建UUID及规范化指纹失败后保留；编辑保留原version，冲突不静默覆盖。预览按读取模板version显示完整目标/助手，填写项目名/说明；同参数重试保留启动UUID，成功进入/projects/[id]。

桌面侧栏/移动抽屉提供“任务模板”，项目页提供模板入口；移动底栏保持5项，从项目进入模板。遵循现有中性色tokens和UX技能的完整页面表单/就近错误/键盘焦点/44px触控规则，不展示未实现的上下游或自动执行。

## 数据、兼容与迁移影响

仅新增两张scoped表、可选Project.templateOrigin；旧项目/普通聊天/未归组任务兼容，现有Agent/任务数据所有权不变。无新依赖、服务或环境配置。生产使用PG，memory仍显示重启清空提示。

用户新测试目录要求已独立落实：API/tests、contracts/tests、Web/tests/lib及tests/server；core/db已有tests保留。Vitest只发现tests目录，生产构建不emit测试。原1713计数含contracts/lib遗留6个重复测试，迁移后1707项真实源测试通过。

## 风险与缓解

- 多项持久化部分成功：单PG事务/内存草稿发布；真实PG触发器使第二项插入失败，核对零项目/零任务/零动作并同UUID重试。
- 旧动作回滚新数据：不可变创建/启动参数及taskIds独立保存，重放读取当前项目，忽略当前Agent/模板配置。
- 模板编辑竞争/混合版本：API模板锁+PG版本CAS/FOR SHARE；同助手缓存一次，开场ID各自生成。
- 长表单/请求过大：1..8项/单目标8000/合计32000，与256KiB代理限制相容；窄屏纵排。
- 版本冲突丢输入：持久显示冲突与明确重载入口，保存失败不切页、不重建动作。

## 验证策略

| 验收       | 方法/通过条件                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-001–003 | 契约/服务/客户端：字段、重复ID、总量/创建重放/旧版本；浏览器真实空列表、名称说明搜索、编辑器顺序恢复、390px与键盘、加载失败重试。               |
| AC-004–005 | 无runtime服务/HTTP：模板及实例零模型调用、缺key只拒绝执行；4条（2同Agent+2default）冻结配置且开场ID独立，项目显示初始条目顺序。                 |
| AC-006–007 | 服务/HTTP：版本过期、并发同动作、普通项目ID碰撞、异参冲突；改名/执行/移动/模板Agent变更后旧启动重放保持原项目与原taskIds。                      |
| AC-008–009 | memory后项校验失败不发布；真实PG触发器使项目和首任务INSERT后故障，ROLLBACK后无半记录，解除后同UUID重试一份；确定性延迟交错编辑/启动与独立动作。 |
| AC-010–011 | DB/服务/HTTP双scope、外来/不存在模板Agent同404；公开响应严格无凭据；重放不再解析已变化助手。                                                    |
| AC-012–013 | 真实PG独立built API关闭重启恢复版本/顺序/任务/动作；旧普通项目、聊天兼容；独立memory重启清空；浏览器失败保留输入/动作、无假跳转。               |
| AC-014     | 真实DeepSeek由生成任务明确开始、续聊、完成/恢复后继续；原生provider受控断言不混入其他条目/实例/项目说明，目标开场一次及普通入口限制。           |

最终运行全量Vitest、Web/API/core types、API/Web build、lint及format:check；已知原有SF001两文档格式例外单列，本轮文件通过。真实证据不足标NOT RUN，评测逐14AC核对后Accepted。

## 实施顺序与依赖

T001契约→T002存储、T003 API、T004客户端/BFF、T005 UI按约定接口并行→T006真实集成→T007独立评测/修复。root负责Plan/Tasks/契约/客户端及PG/浏览器集成；子agent分工DB、API、UI。遵守测试新路径及全部函数多行JSDoc。

## 计划变更记录

- 2026-10-17：Spec由授权代表批准后编写方案，向PM/评测提交阶段审查，不重复用户确认。
