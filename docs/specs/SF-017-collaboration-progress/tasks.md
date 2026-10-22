# SF-017：任务清单

## 元信息

| 字段 | 值                                            |
| ---- | --------------------------------------------- |
| ID   | SF-017                                        |
| 状态 | Complete — User Authorized Iterative Delivery |
| 关联 | [spec.md](spec.md)、[plan.md](plan.md)        |

## 任务概览

| ID    | 文件边界与交付                                                                                     | 关联需求/验收                      | 依赖         | 状态 |
| ----- | -------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------ | ---- |
| T-001 | contracts/collaboration、db/collaboration、API：人工project-start、原子普通空chat/source及安全进度 | REQ-002–009 / AC-001–012           | 无           | DONE |
| T-002 | Web team-project/client/relations：开始/逐项继续、安全待处理和有限纵向关系                         | REQ-001–008、010 / AC-002–009、013 | T-001契约    | DONE |
| T-003 | 独立tests：PG/API/进程/受控三人provider/组件与真实browser，发现后修复                              | REQ-001–010 / AC-001–014           | T-001、T-002 | DONE |
| T-004 | AGENTS/UI/changes、生产构建/类型/lint/format与逐AC证据                                             | REQ-009–010 / AC-014               | T-001–003    | DONE |

## 完成标准与验证

- T-001：真实授权和revision的同事务空chat/rootnode/source，无模型/消息/任务/jobs；进度只白名单，真实pending方向、多对象、终结/撤权过滤；真PG/API验证。
- T-002：精确本人source逐项继续/历史查看，新建不复用；表单幂等保稿、冲突重读，关系多根/分支/环有限、390/keyboard实际可用；组件与浏览器验证。
- T-003：独立agent逐AC实际取证，含真实三人往返、私有数据负例、撤权/故障与独立进程，不用mock冒充真实PG或布局。
- T-004：适用工程和旧功能通过，生产无tests，文档同步；必需AC全PASS后才Accepted。

## 阻塞项

无需求阻塞。

## 完成汇总

总任务4；完成4；进行中0；待办0；阻塞0。
