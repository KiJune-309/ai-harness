# SF-001：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-001     |
| 状态     | Draft      |
| 最近更新 | 2026-10-16 |

## 记录

按日期追加新记录，不删除或覆盖旧记录。

### 2026-10-15 — Spec 草案

- **变更内容：**创建系统提示词注入功能的 Spec 草案，并初始化待 Spec 审批的 Plan 与 Tasks 文档。
- **原因：**用户要求研究 DeepSeek system prompt 并为 `packages/core/system-prompt/` 编写规格。
- **关联项：**REQ-001–REQ-007、AC-001–AC-006
- **验证：**阅读仓库根目录与 LLM 模块说明；检索 DeepSeek 官方 Chat Completions、JSON Output 和 Context Caching 文档。未执行代码验证（本阶段仅编写规格）。
- **结论：**Spec 等待用户评审；Plan 和 Tasks 保持未填充状态，等待 Spec 审批。

### 2026-10-16 — 明确提示词来源选择

- **变更内容：**补充 Agent 固定 system prompt 与 Laya 意图识别动态 system prompt 两条互斥路径及对应验收标准；明确空白固定提示词按未配置处理，并将缓存可复用性限定为相同意图选择相同内容。
- **原因：**用户明确说明固定 Agent 提示词直接使用；Agent 没有固定提示词时才调用 Laya 识别意图并动态添加提示词。
- **关联项：**REQ-001–REQ-009、AC-001–AC-008
- **验证：**核对固定提示词路径、动态提示词路径、未知意图处理与消息输出要求均有对应验收标准；未执行代码验证（Spec 阶段）。
- **结论：**Spec 更新为等待用户评审；Plan 和 Tasks 仍等待 Spec 审批。

### 2026-10-16 — 两条提示词路径保留 context

- **变更内容：**将“提示词正文选择”与“context 保留”写清楚；固定 Agent 提示词和 Laya 动态提示词两条路径均保留 context，新增 REQ-010、REQ-011、AC-009、AC-010，并同步修订原有需求及验收。确定性约束包含 context 输入，相同意图仅要求正文相同。
- **原因：**用户要求保留 DeepSeek system prompt 中的 context，先前固定路径输出仅含固定提示词的描述不完整。
- **关联项：**REQ-001、REQ-002、REQ-006、REQ-009–REQ-011；AC-001、AC-002、AC-006、AC-009、AC-010
- **验证：**阅读现有四份 SDD 文档并检查工作区；工作区未发现所指的 DeepSeek context 原文。已核对两条路径、意图变化和 context 变化对应的文档约束；对 spec.md 与 changes.md 的 Prettier 格式检查通过。功能未实现，验收均未执行。
- **结论：**保留 context 的要求已记录；待取得原文或链接后细化字段、分隔格式、原有嵌入位置和缺省行为。Spec 仍为草案。

### 2026-10-16 — 明确 context 注册接口

- **变更内容：**以用户补充的 `systemPrompt.context({ name, order, text })` 示例明确 context 为注册能力，补充字段语义与构造时求值规则；固定和 Laya 动态路径都执行已注册回调。修订 REQ-008–REQ-011，增加 REQ-012–REQ-014 与 AC-011–AC-015，并将确定性条件改为回调的实际返回结果。
- **原因：**用户已提供 `project:working-directory` 示例，消除了此前对 context 具体所指的疑问。
- **关联项：**REQ-001、REQ-002、REQ-008–REQ-014；AC-001、AC-002、AC-006、AC-008–AC-015。
- **验证：**对照用户示例检查 name、order、text 均有契约及验收覆盖，并检查两条正文路径、动态求值、同序排序、无效注册及空白/异常结果的文档一致性。仅更新文档，功能验收未执行。
- **结论：**context 来源问题已解决；首版细节以草案约定供评审。Spec 仍为草案，Plan/Tasks 仍等待 Spec 审批。

## 验收矩阵

| 验收标准 | 状态    | 证据（命令、结果或观察） | 备注      |
| -------- | ------- | ------------------------ | --------- |
| AC-001   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-002   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-003   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-004   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-005   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-006   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-007   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-008   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-009   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-010   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-011   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-012   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-013   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-014   | NOT RUN | 待实现后验证             | Spec 阶段 |
| AC-015   | NOT RUN | 待实现后验证             | Spec 阶段 |

## 最终结论

- **结果：**Pending
- **未通过或未执行项：**AC-001–AC-015 均待实现后验收。
- **后续行动：**确认 Laya 未匹配或失败时的处理方式，并评审更新后的 Spec；Spec 确认后进入 Plan/Tasks 阶段。
