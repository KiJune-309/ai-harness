# 官方公开文档阅读记录

2026-10-19 已逐页读取中文导航的18页正文、页内小节、请求响应与示例。动态预览只返回 Loading preview，未声称观看视频；未枚举隐藏页面。以下用于理解用户指定协作方式，不证明本仓库已实现第三方全部能力。

| 已读页面                                                                               | 对本次实现的影响                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [介绍](https://docs.syncless.ai/zh-Hans/)                                              | Agent连接工作上下文，减少人手工转述。                            |
| [快速开始](https://docs.syncless.ai/zh-Hans/get-started/quick-start/)                  | 原Task到协作Project，人员接力。                                  |
| [Workspace与成员](https://docs.syncless.ai/zh-Hans/core-concepts/workspace-members/)   | 工作空间是人员及授权边界。                                       |
| [Task](https://docs.syncless.ai/zh-Hans/core-concepts/task/)                           | 各人自己的Agent与上下文。                                        |
| [Project](https://docs.syncless.ai/zh-Hans/core-concepts/project/)                     | 同一事项、共享工作材料与责任节点。                               |
| [上下游](https://docs.syncless.ai/zh-Hans/core-concepts/upstream-downstream/)          | 前置澄清、下游回问、原链路答复、人作判断。                       |
| [Project Template](https://docs.syncless.ai/zh-Hans/core-concepts/project-template/)   | 官方多人图模板与旧个人清单不同；多人模板和云初始化本轮后置。     |
| [@ Mention](https://docs.syncless.ai/zh-Hans/core-concepts/mentions/)                  | 绑定真实参与人并引入当前工作，简单转告保留。                     |
| [文件与共享存储](https://docs.syncless.ai/zh-Hans/core-concepts/files-shared-storage/) | 项目共享成果；下游需要经过整理的相关上下文。首版共享版本化文本。 |
| [Devices](https://docs.syncless.ai/zh-Hans/core-concepts/devices/)                     | 理解设备边界，按用户明确要求后置。                               |
| [Skills](https://docs.syncless.ai/zh-Hans/core-concepts/skills/)                       | 长期流程规则，本轮复用已有Agent配置，不新建跨设备同步。          |
| [看板](https://docs.syncless.ai/zh-Hans/core-concepts/board/)                          | 展示状态与阻塞，不替代各Task内判断。                             |
| [API概览](https://docs.syncless.ai/zh-Hans/api-reference/)                             | 用户级身份与当前工作空间；本应用继续真实会话鉴权。               |
| [个人任务API](https://docs.syncless.ai/zh-Hans/api-reference/personal-tasks/)          | 第三方创建即执行，不因此改变本仓库旧任务显式开始语义。           |
| [模板API](https://docs.syncless.ai/zh-Hans/api-reference/templates/)                   | 图节点映射真实负责人、异步初始化；不冒称旧模板等同此功能。       |
| [项目API](https://docs.syncless.ai/zh-Hans/api-reference/projects/)                    | 只列加入的标准项目，不公开所有人的私有任务。                     |
| [任务API](https://docs.syncless.ai/zh-Hans/api-reference/tasks/)                       | 私有Task读取仍本人所有，上游必须同项目；运行中普通输入避免竞争。 |
| [用户API](https://docs.syncless.ai/zh-Hans/api-reference/users/)                       | 稳定成员身份服务于责任分派。                                     |

官方页面未定义本应用的站内线程、未读、撤销代次、PostgreSQL事务或恢复协议。这些设计依据用户需求与仓库权限约束，不能当作已公开的第三方内部实现。
