# SF-019：个人技能库实施计划

## 元信息

| 字段     | 值                                            |
| -------- | --------------------------------------------- |
| ID       | SF-019                                        |
| 状态     | Complete — User Authorized Iterative Delivery |
| 关联     | [spec.md](spec.md)                            |
| 最近更新 | 2026-10-20                                    |

## 技术方案与理由

复用contracts、db、API和chat-runtime，不新增服务或执行器。技能是本人当前Workspace的不可变版本文本；Agent写入仅接受版本引用，API解析真实正文为冻结快照，core只消费快照。保留现有聊天、Task、个人模板和持久session的Agent快照语义。

## 模块、接口与数据流

- contracts：独立skills.ts定义SkillInput/Record/Summary/VersionSummary/Ref/Snapshot和限额；AgentInput.skillRefs可选，仅接受引用；AgentDefinition.skillSnapshots可选兼容旧记录。引用唯一且保持顺序，快照合计正文<=32000。
- db：沿进程共享pool初始化技能当前记录、不可变版本和动作账本，所有查询按userId/workspaceId及当前真实成员范围；创建/更新requestId持久重放、版本竞争和事务回滚。失败不创建内存替代。
- API：`GET/POST chat/skills`；`GET/PUT chat/skills/:id`；`GET chat/skills/:id/versions`；`GET chat/skills/:id/versions/:version`。列表返回`{skills:SkillSummary[]}`不含正文，历史返回`{versions:SkillVersionSummary[]}`；详情/精确版本为SkillRecord。更新增加requestId，重试同动作不重复升版，异参数冲突。
- AgentService：保存时按本人/空间精确解析skillRefs并复制快照，拒绝伪造正文/外来/缺失版本和超限；未提供refs的新Agent为空，旧Agent更新兼容保持已保存绑定。不能在运行时回库取最新版。
- core：共用独立有序Skill context注册函数，由普通与协作setup均调用；明确标题/编号/版本及冻结全文，interpolate:false且required:true，不覆盖原prompt，不改工具、外联slots或其他权限。
- Web：`/skills`列表/创建Dialog、`/skills/[id]`编辑和只读历史，侧栏及移动Sheet入口；Agent第2步在系统prompt后加入版本选择/全文/显式升级，最终预览与已保存详情显示。临时SKILL.md导入文案明确仅当前消息。

## 数据、兼容与迁移影响

新增PostgreSQL技能表与版本/动作，不迁移或删除旧Agent及工作快照；缺少skillSnapshots按空集合消费。库更新不影响旧Agent；Agent显式保存更新只影响之后新建的工作，旧聊天/Task/持久session不漂移。共享Project/progress/开场继续白名单，私有skill正文/ID/快照不自动复制。

## 风险与缓解

| 风险                           | 缓解                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------- |
| 库更新悄悄改变历史执行         | API冻结精确版本；两runtime只用快照；provider捕获旧/新实际文本                     |
| 更新重试重复升版或竞争覆盖     | 独立requestId、持久动作摘要、预期version、事务锁与PG两pool测试                    |
| 客户端冒充正文或越范围绑定     | 输入仅refs、API精确解析、双维范围和真实成员检查                                   |
| Skill内容被当作新权限/模板求值 | 独立不插值context；工具仅原toolIds，联络仍真实本人持久请求/确认；恶意provider实测 |
| 新字段破坏旧Agent/私有投影     | 可选字段兼容、旧回归、共享响应正文负例                                            |
| 长正文/版本冲突造成丢稿        | 原稿保留、显式比较/重读、390/键盘和真实Footer验证                                 |

## 验证策略

| 验证                           | AC                  | 通过条件                                                                 |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------ |
| schema/真实PG/API并发与权限    | AC-001–006、011–012 | 限额、顺序、精确历史、幂等、竞争/故障和范围成立                          |
| 两条真实runtime/provider与快照 | AC-007–010、014     | 普通/Task/个人模板/协作session使用正确冻结正文；恶意调用无权限扩张或共享 |
| 真进程与实际UI                 | AC-012–013          | 三次独立启动恢复；桌面/390/键盘/保稿/显式升级和完整正文可达              |
| 工程/旧回归                    | AC-015              | types/server/Web production/lint/format通过，逐项证据无未执行必需项      |

## 实施顺序与依赖

T-001契约先行，T-002持久层/API与T-003 core、T-004 Web按契约并行；T-005独立验收发现问题后修复复验；T-006文档工程最终收口。第六项看板必须等本项Accepted后正式提出。
