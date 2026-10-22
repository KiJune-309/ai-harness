# SF-007：任务清单

| 字段 | 值                                |
| ---- | --------------------------------- |
| 状态 | Complete — Accepted               |
| 关联 | [Spec](spec.md) · [Plan](plan.md) |

## 任务概览

| ID    | 任务                             | 关联REQ/AC                                    | 依赖           | 状态 |
| ----- | -------------------------------- | --------------------------------------------- | -------------- | ---- |
| T-001 | 公开知识契约                     | REQ001–009 / AC001–009                        | 无             | DONE |
| T-002 | 受限core解析、分片及持久对象服务 | REQ002–004、007 / AC002–004、007–008          | T001           | DONE |
| T-003 | PG记录/租约和授权API             | REQ001、003、005–008 / AC001、005–009         | T001；T002接口 | DONE |
| T-004 | 真实资料库Web流程                | REQ001–002、006–009 / AC001–003、005、008–010 | T001；T003接口 | DONE |
| T-005 | 真实四格式/故障/重启集成         | REQ002–008、010 / AC002–009、011              | T002–004       | DONE |
| T-006 | UI及工程全回归/独立验收          | REQ009–010 / AC001–011                        | T005           | DONE |

## 任务细节

### T-001：公开知识契约

- 文件：contracts/src/knowledge.ts及index、tests。
- 产出：Plan所列Document/Chunk/分页/状态/重试schema与限额、processor结果type，API与Web使用同一版本。
- 完成标准：严格无秘密公开字段，Unicode单位/参数/分页可检验，非法参数拒绝。
- 验证：边界契约测试及contracts类型；覆盖REQ001–009/AC001–009，无依赖。

### T-002：受限core解析、分片及持久对象服务

- 文件：core/chat-runtime/src/knowledge*.ts及tests/package exports；infra对象Compose、scripts/local-object-storage.mjs/dev/tests、.env.example、依赖lock。
- 消费T001契约；产出稳定processor/object接口与本地私有持久服务。
- 完成标准：四格式真实解析、ZIP/PDF/正文/片资源边界，Unicode精确覆盖/页范围不虚构，隔离超时；S3原字节受限读写与safe错误，原凭据/卷稳定，外部服务优先。
- 验证：parser/对象与启动器单测、真MinIO往返hash及非公开、容器重建；AC002–004、007–008。

### T-003：PG记录/租约和授权API

- 文件：db/src/knowledge.ts/index及tests；API knowledge-service/controller、app/config及tests。
- 消费T001、T002接口；产出/api/knowledge所有真实入口及共享持久后台任务。
- 完成标准：上传原对象持久后幂等queued，scope完整；SKIP LOCKED租约、generation/token CAS、完整chunks+ready事务；失败重试动作持久幂等，启动恢复及正常shutdown；下载安全attachment。
- 验证：真PG原子性/并发/旧lease/重放、HTTP权限/实际大小边界及worker恢复，AC001、005–009。

### T-004：真实资料库Web流程

- 文件：Web app/rag、app/api/knowledge、components/library*、lib/knowledge-client、server/knowledge-proxy/tests、UI规范/AGENTS。
- 消费T001和T003API；产出真实列表、multipart上传参数、稳定详情/分页、状态轮询、失败重试和下载。
- 完成标准：删除演示；代理对无/伪造长度实际限额；操作失败保留输入及UUID，按序纯文本；安全同源/会话，桌面及390px可用，明确检索未接。
- 验证：代理/客户端测试、真实浏览器和响应式验收，AC001–003、005、008–010。

### T-005：真实四格式/故障/重启集成

- 文件：对应模块tests、忽略的本机验收脚本/fixture、SF007 changes。
- 消费T002–004；产出真实PG和对象服务完整证据。
- 完成标准：四格式内容、边界拒绝、幂等/竞态/租约自动恢复、依赖故障不假成功、下载hash/权限；重建API和两个容器保卷后原ID/字节/分片仍在。
- 验证：独立API进程+真实PG/MinIO隔离测试、真实容器和页面，覆盖AC002–009、011。

### T-006：UI及工程全回归/独立验收

- 文件：SF007四件套及实际工程产物。
- 消费T005证据；产出逐AC裁决及修复闭环。
- 完成标准：桌面/390px主流程实跑、全部适用测试、contracts/db/core/api/web类型、API/Web生产build、lint/format通过，src及生产lib无suite；原账户/Cordis不回退。
- 验证：根命令与独立评测，覆盖全部AC，未跑必须NOT RUN不虚报。

## 阻塞

无；2026-10-17 独立评测 agent 已代理批准 Plan/Tasks，可以按依赖开始实现。

## 汇总

任务 6，完成 6，进行中 0，待办 0。2026-10-18 独立评测完成 AC-001–011，全部 PASS，最终结果 Accepted。

证据索引：契约/解析/服务/客户端及代理单测；独立真实 PG/S3/HTTP/进程恢复 13 项；全量真实依赖 120 套 1880 项；桌面与 390px 实际上传、分片分页、失败重试和下载；容器保卷重建、API/Web 重启复核；生产构建、各包类型、lint/format、无测试产物。具体命令与本机证据路径见 [Changes](changes.md)。
