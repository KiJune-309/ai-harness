# SF-020：任务清单

## 元信息

| 字段 | 值                                     |
| ---- | -------------------------------------- |
| ID   | SF-020                                 |
| 状态 | Complete                               |
| 关联 | [spec.md](spec.md)、[plan.md](plan.md) |

## 任务概览

| ID    | 文件边界与交付                                                           | 关联REQ/AC                                  | 依赖           | 状态 |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------- | -------------- | ---- |
| T-001 | contracts进度来源/本人输入元数据schema                                   | REQ-002、009 / AC-002、007–008              | 无             | DONE |
| T-002 | db/API精确source SQL元数据、只读Task完成投影、旧fixtures                 | REQ-002、008–009 / AC-002、007–008、010–011 | T-001          | DONE |
| T-003 | Web纯Board模型：六列/完整计数/交集筛选/多wait/稳定排序                   | REQ-003–007 / AC-003–006、009               | T-001          | DONE |
| T-004 | Project视图/URL/同poll、Board卡片/分批/导航/390与UI文档                  | REQ-001、004–010 / AC-001、005–010、012     | T-001、003契约 | DONE |
| T-005 | 独立contracts/PG/API/纯模型/组件/三人provider/三boot/真实UI验收及修复    | REQ-001–010 / AC-001–014                    | T-001–004      | DONE |
| T-006 | AGENTS/UI/changes、最终types/server/Web production/lint/format及逐AC收口 | REQ-008–010 / AC-014                        | T-001–005      | DONE |

## 完成标准与验证

- T-001：新增字段严格布尔/未知，白名单不扩私人正文；metadata与真实source对应。
- T-002：PG/HTTP验证空chat/opening/relay/user/错owner-kind/missing及真实Task完成恢复；只读、无凭据/model/状态写入，权限/重启/故障成立。
- T-003：每node一列、出入站/self真实去重、待本人target、完整41+统计/筛选和稳定排序成立，不截断后计数。
- T-004：同hook/稳定view与旧深链，个人保持原行为；filters同页保留/范围清理；390/键盘/20+与全部wait可达；本人精确导航/他人只读。
- T-005：独立agent逐14AC真实取证，纯mock不冒充PG/布局/provider；发现失败须修复复验。
- T-006：必需AC全PASS、生产无tests、工程门和所有权/视觉规范同步；六轮按实际完成结论交付。

## 阻塞项

无需求阻塞。

## 完成汇总

总任务6；完成6；进行中0；待办0；阻塞0。逐项证据见[changes.md](changes.md)，14项AC全部PASS，Accepted。
