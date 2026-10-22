# SF-016：任务清单

## 元信息

| 字段 | 值                                            |
| ---- | --------------------------------------------- |
| ID   | SF-016                                        |
| 状态 | Complete — User Authorized Iterative Delivery |
| 关联 | [spec.md](spec.md)、[plan.md](plan.md)        |

## 任务概览

| ID    | 文件边界与交付                                                                           | 关联需求/验收                              | 依赖         | 状态 |
| ----- | ---------------------------------------------------------------------------------------- | ------------------------------------------ | ------------ | ---- |
| T-001 | contracts/collaboration、db/collaboration：人工项目管理、成员、版本资料、权限与动作账本  | REQ-002–011 / AC-002–013                   | 无           | DONE |
| T-002 | API collaboration/project/chat-service：严格人工命令、共享权威与失权无私有fallback       | REQ-003–006、009–011 / AC-003–008、011–013 | T-001        | DONE |
| T-003 | Web project/collaboration及client：统一列表/筛选/去重、创建scope、共享总览/成员/资料表单 | REQ-001–010、012 / AC-001–012、014         | T-001、T-002 | DONE |
| T-004 | tests：独立PG/HTTP/进程/组件与desktop390实际验收及修复                                   | REQ-001–012 / AC-001–015                   | T-001–003    | DONE |
| T-005 | AGENTS/UI规范/changes与工程构建检查                                                      | REQ-011、012 / AC-012–015                  | T-001–004    | DONE |

## 完成标准与验证

- T-001：新共享项目无node即可创建/发布资料；真实成员双重校验；幂等与版本竞争正确；Agent不能管理或发布；PG测试验证。
- T-002：旧私有API不能绕过共享权限或独改壳；所有元信息一致，人工身份不可由body伪造；HTTP与旧项目回归验证。
- T-003：单网格/类型筛选/共享优先统一排序；人工创建和成员/正文scope清晰；失败/版本冲突保稿；组件与真实browser验证。
- T-004：独立测试agent按每条AC实际记录，发现后修复重跑必要用例，不以mock代替PG/布局/进程证据。
- T-005：types/server/web production build、pnpm format:check与lint通过；所有权规范更新、逐AC都有真实依据；最后才标Complete/Accepted。

## 阻塞项

无需求阻塞。

## 完成汇总

总任务5；完成5；进行中0；待办0；阻塞0。
