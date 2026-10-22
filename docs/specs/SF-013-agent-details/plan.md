# SF-013：功能实施计划

| 字段 | 值                                          |
| ---- | ------------------------------------------- |
| ID   | SF-013                                      |
| 状态 | Approved — Proxy Review                     |
| Spec | [spec.md](spec.md)，Approved — Proxy Review |
| 日期 | 2026-10-19                                  |

## 技术方案与理由

1. 复用AgentEditor而不复制三步与完整编辑字段，入口增加可选agentId，内部workspace以agentId或list为key隔离状态。列表只加载catalog+list，详情只加载catalog+现有getAgent(id)，严格检查返回ID并用AbortController取消/忽略旧响应。新动态路由 `/agents/[id]` 传入真实URL参数；不依赖先访问列表，不从列表回退猜记录。
2. 列表方卡保持现内容与默认Card样式，交互改原生Link到编码后的ID详情，保鼠标/键盘/原生新标签语义；不再内联编辑或显示选中标签。详情返回链接指向 `/agents`，Workspace的Agents活跃判定覆盖嵌套路由。
3. 详情默认只读，展示真实名称/简介、公开模型名称或既有不可用名称fallback、已配置工具、完整prompt、有序开场和两项时间。全部配置纯文本保留换行，长内容可换行/滚动；使用现有默认Card/Badge/Button，无新主题/依赖。显式“编辑 Agent”才展示原完整表单，保共享校验/稳定模型ID/工具/5开场排序，不使用创建步骤。
4. 更新调用原PUT，保同步savingNow互斥、字段首错、失败保全部草稿。更新响应ID须严格等于当前详情ID，不符则保草稿显示失败；有效成功才更新saved定义/baseline并退出编辑，普通保存留同URL，只有保存并开始对话进入原 `/?agent=saved.id`。成功与放弃后焦点返回可用编辑按钮或详情标题，避免已卸载的nameRef。
5. 本页“返回 Agents”和“取消编辑”无修改直接执行；dirty时复用现私有AlertDialog，继续编辑保草稿/焦点，明确放弃才复原已确认记录或router.push列表。pending以同步guard禁止返回/取消/重复写；保已有beforeunload，不扩展全站路由拦截。所有确认继续沿AuthBoundary/PrivatePortal暂停恢复及401卸载，步骤Portal物理嵌套保持。
6. 列表仍提供SF012三步创建Dialog；前两步零POST、最终明确确认、step焦点/取消继续/503恢复、pending禁关闭全部保持。创建有效响应后关闭并router.push真实saved.id详情，列表不再展开编辑，不自动聊天。错误不导航，原POST幂等边界不扩展。

## 模块、接口与数据流

- UI代理：`apps/web/components/agent-editor.tsx`、`agent-editor.styles.ts`、`docs/ui-design-spec.md`。只在现模块内复用，无新共享包。
- 根：新增`apps/web/app/agents/[id]/page.tsx`，更新列表page说明及`workspace.tsx`一行导航活跃判定；适配`account-agent-shadcn.test.tsx`原Agent3项。
- 评测：适配`agent-create-dialog.test.tsx`原8项，新建`agent-details.test.tsx`必要的ID读取/只读/错误重试/晚到响应/编辑授权边界验证，优先合并既有生命周期断言、最多5个新用例。各方不交叉编辑同文件。
- 接口：复用原GET列表/GET单条/POST/PUT与contracts，无API、DB、凭据、工具或Cordis执行改动。Web只依赖contracts。
- 数据流：列表Link URL→key隔离详情→catalog+GET指定ID→只读已保存记录→显式编辑内存draft→完整校验/PUT→有效saved定义回只读；创建有效POST→返回ID详情。查看与导航无模型请求。

## 数据、兼容与迁移影响

- 无数据库/索引/对象存储迁移、无新环境变量/依赖；业务记录继续原持久化范围。
- 本轮取代旧“卡片选择后内联编辑/创建后列表选中”呈现，旧Accepted档案保留；当前UI规范明确新规则优先。原字段、三步创建和两种保存行为保持。
- 本页返回/取消guard不承诺Sidebar、浏览器前后或跨路由的统一未保存拦截。原beforeunload仍保护实际刷新/离开文档。
- 构建期间只短暂停止根自己启动的main dev launcher，避免并行写Next缓存，构建后恢复；数据库/S3与用户会话/密钥保持。

## 风险与缓解

| 风险                                | 缓解                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| 快速切ID展示旧记录/草稿或迟到覆盖   | 内层key卸载所有状态/私有层，旧controller abort/ignore，返回ID严格校验；A/B受控响应验证        |
| 列表缓存误作独立详情/404fallback    | detail不调用list，不存在/无权/错ID都error+retry/back，直达和刷新真实GET验证                   |
| 只读切编辑/返回确认焦点失效         | 初始字段/编辑按钮ref及详情标题fallback，已卸载字段不作最终目标，真实DOM稳定焦点及实际边界验证 |
| 新导航破坏创建/失败草稿/在途互斥    | 原8项保原有效断言，仅成功转详情与移除旧switch场景按新Spec替换，deferred/503/401保持           |
| 长prompt/文件式字符串/5开场撑出页面 | 完整纯文本、min-w-0/break-words、默认响应式Card；桌面及390px真实截图/键盘验证                 |
| mock验证代替实际保存                | 独立DOM证明状态；真实GET/PUT+刷新核完整六字段，必要非秘密验收Agent创建证明真实ID导航          |

## 验证策略

| 项目                | AC         | 方法与通过条件                                                                                                                                                              |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列表/route/默认只读 | AC001、002 | DOM链接href无嵌套编辑，独立详情GET不调用list，全部配置纯文本/顺序和时间/空值；真实点击/直达刷新、浏览器原生新标签语义及导航活跃                                             |
| 编辑/确认/失败      | AC003、004 | 原Agent3项及独立详情deferred校验/重复/失败重试/success，取消/返回保留/放弃，save-chat仅有效PUT后；真实保存后刷新重读                                                        |
| 三步创建            | AC005      | 原8项适配，前两步/取消/pending/失败不导航，成功才push真实ID，三步完整配置和嵌套Portal恢复不退化；真实非秘密记录已创建后刷新核对                                             |
| ID/权限/恢复        | AC006、007 | 404/故障retry/错ID、A/B旧响应忽略、实际AuthBoundary同账户故障恢复/401清私有层；复用后端跨账户隔离实测，不改授权                                                             |
| 工程/移动           | AC008      | 适用DOM+agent-client原13、相关路由/客户端与全量Vitest隔离schema/S3；Web/API类型、Web生产构建含新动态路由、全仓lint/format/diff通过，tests不进入产物；桌面/390px可达无横溢出 |

## 实施顺序与依赖

1. T-001：已批准gate后UI实现列表/详情/编辑状态及UI规范，根补route/导航。
2. T-002：根与评测按文件分工适配旧DOM并补最多5项必要详情边界，依赖T001接口，可先准备测试。
3. T-003：根统一真实浏览器/API重读与工程检查，评测逐8AC终验并记录实际证据。

## 计划变更记录

2026-10-19：依据已代理批准Spec编写Plan/Tasks，沿用已有全部阶段授权；交评测代理审查，批准前未改本轮生产/测试。

2026-10-19：独立评测代理`agent_detail_evaluator`批准Plan/Tasks；已核对PUT返回ID必须等于当前详情ID后才发布已保存记录/聊天导航，其余按原Spec执行。全部AC仍待实施证据。
