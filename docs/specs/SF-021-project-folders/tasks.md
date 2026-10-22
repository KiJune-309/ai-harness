# SF-021：任务清单

## 元信息

| 字段      | 值                 |
| --------- | ------------------ |
| ID        | SF-021             |
| 状态      | Completed          |
| 关联 Spec | [spec.md](spec.md) |
| 关联 Plan | [plan.md](plan.md) |

## 任务状态定义

- TODO：尚未开始。
- IN PROGRESS：正在实施。
- BLOCKED：有实际依赖阻塞，记录原因。
- DONE：完成标准及指定验证均通过。

## 任务概览

| ID    | 任务                           | 关联需求/验收                                            | 依赖                 | 状态 |
| ----- | ------------------------------ | -------------------------------------------------------- | -------------------- | ---- |
| T-001 | 文件夹契约/持久化与资料过滤    | REQ-001、003、008、010、013 / AC-001、006、008、009、011 | 无                   | DONE |
| T-002 | 普通会话/API及Agent资料工具    | REQ-004–006、008–010、013 / AC-002–004、006–009、011     | T-001                | DONE |
| T-003 | 侧栏项目与聊天资料入口         | REQ-002–007、014 / AC-001–006、012                       | T-001、T-002接口     | DONE |
| T-004 | 删除旧功能与关联数据、防止再生 | REQ-011、012 / AC-010                                    | 无，执行依赖集成验证 | DONE |
| T-005 | 集成/真实验收/文档及清理执行   | 全部 / AC-001–012                                        | T-001–004            | DONE |

## 任务细节

### T-001：文件夹与资料数据

**文件/边界：** contracts/project-folders、knowledge，db/project-folders、knowledge及tests。
**接口：** ProjectFolder、CreateProjectFolder、受scope/folder限制的list/get/create及资料list/get/chunks/search。
**完成标准：** PG主记录及上传关联/幂等持久化，SQL过滤准确，无内存降级。
**验证方式：** 新契约单测、真实隔离PG跨用户/空间/A/B同名资料及重复动作；AC-001、006、008、009、011。

### T-002：普通会话与资料工具

**文件/边界：** contracts/index、db/index、api/chat-service/controller、project-folder-service/controller、knowledge-service/controller、app、core runtime入口/资料工具及tests。
**接口：** projectFolderId、requestId创建；只读ProjectKnowledgePort；固定当前项目的查找/读片工具。
**完成标准：** 首次输入的会话归属正确且不可被旧快照覆盖，重试不重复；Agent实际工具查阅并使用来源。
**验证方式：** API/PG创建重试及错scope，真实Cordis工具循环和持久路径回归；AC-002–004、006–009、011。

### T-003：侧栏与资料面板

**文件/边界：** workspace、project-folder组件/客户端、知识客户端、Web代理/旧项目页面和tests。
**完成标准：** 直接项目名称折叠列表、项目内普通聊天、全部对话含项目会话、右上角资料Sheet及真实上传/状态。
**验证方式：** Web组件覆盖首条输入/切项目/失败重试；浏览器桌面与390px完成创建/选聊天/上传/来源查看及键盘；AC-001–006、012。

### T-004：旧数据清理与关闭创建路径

**文件/边界：** db/legacy-project-cleanup、api旧controller/policy、旧模板/协作启动路径及tests；主agent负责启动挂接。
**完成标准：** 精确删除关联正文及授权/执行记录，不触及无关资源；旧入口真实不可用、不再生成旧Project或壳。
**验证方式：** 隔离PG清理前后差异、重跑/重启/迟到任务与旧API调用；AC-010。用户真实开发库在隔离验证后按已授权范围执行。

### T-005：集成验收与文档

**文件/边界：** AGENTS.md、UI规范、四文档、必要集成测试及实际浏览器。
**完成标准：** 所有Must有实际证据，根format/lint和相关类型/构建通过；若有未通过项如实记录，不标完成。
**验证方式：** 按Plan逐12AC取证，检查生产构建不包含tests；数据清理仅按真实关系执行。

## 阻塞项

无功能阻塞。并行人工审核功能曾导致临时检查失败，最终同工作区格式、lint、类型及构建均已通过。

## 完成汇总

总任务 5，进行中 0，待办 0，已完成 5。AC-001–012 全部 PASS；见 changes.md 的实际测试及浏览器证据。
