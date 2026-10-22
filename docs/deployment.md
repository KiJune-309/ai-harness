# Windows 使用 Docker Compose 与 Caddy 部署

本方案在 Windows 电脑上运行 Docker Desktop，使用 Linux 容器部署 Caddy、Next.js Web、NestJS API、PostgreSQL 17 + pgvector 和私有 MinIO。默认地址为 `https://localhost`，不需要购买域名。

以下命令均在 **Windows PowerShell 的仓库根目录**执行，由你自行构建和启动。构建配置为 `infra/build.compose.yaml`，运行配置为 `infra/production.compose.yaml`，数据卷与 `pnpm dev` 分开。

## 1. 准备 Windows 环境

安装 Docker Desktop，启用 WSL 2 引擎并使用 **Linux containers**。开启硬件虚拟化，保持 Docker Desktop 运行；电脑休眠或 Docker Desktop 退出时，网站也会停止。Docker 官方要求 WSL 至少为 2.1.5，详见 [Windows 安装要求](https://docs.docker.com/desktop/setup/install/windows-install/) 和 [WSL 2 配置](https://docs.docker.com/desktop/features/wsl/)。

```powershell
docker compose version
docker info --format '{{.OSType}}'
```

第二条应输出 `linux`。确认选用的 HTTP、HTTPS 端口未被其他服务占用，并能访问容器镜像仓库、npm registry 和模型服务。默认使用 80、443；已有网站占用时，可按下一节改用 8080、8443。仅在这台电脑通过 `localhost` 使用时，无需配置公网 DNS 或路由器端口转发。

建议直接在目标 Windows 电脑构建镜像，避免从其他 CPU 架构电脑复制不兼容镜像。Windows 宿主机不需要安装 PostgreSQL、MinIO 或 Caddy。

## 2. 初始化私有配置

如果本机已有 Node.js 24 和仓库使用的 pnpm，执行：

```powershell
pnpm deploy:init
notepad infra/.env.production
```

初始化命令只在文件不存在时创建 `infra/.env.production`，分别生成数据库密码、服务 token、账户加密密钥和对象存储密码；已有配置不会被覆盖。在文件中填写真实 `DEEPSEEK_API_KEY`，其余默认值可以保留：

```dotenv
APP_DOMAIN=localhost
DEEPSEEK_API_KEY=填写自己的系统模型密钥
```

若其他应用已占用 80、443，在同一配置文件设置以下值，让本项目与原有网站共存：

```dotenv
APP_DOMAIN=localhost
HTTP_PORT=8080
HTTPS_PORT=8443
```

此时访问 `https://localhost:8443`，`http://localhost:8080` 会跳转到该 HTTPS 地址。`APP_DOMAIN` 仍只填主机名，不带端口；两个端口须不同且未被占用。主机与容器使用相同端口，保证跳转保留所选 HTTPS 端口。使用公共域名申请公共 CA 证书时，验证仍要求公网 80/443 可达，不能仅靠更改这两个端口完成。

如果 Windows 只安装了 Docker，可以手动复制示例文件后配置：

```powershell
if (Test-Path infra/.env.production) { throw '配置已存在，请直接编辑，不要覆盖。' }
Copy-Item infra/.env.example infra/.env.production
notepad infra/.env.production
```

以下 PowerShell 命令每次生成一个 64 位十六进制随机值；运行四次，将不同结果分别填入 `POSTGRES_PASSWORD`、`HARNESS_API_TOKEN`、`ACCOUNT_ENCRYPTION_KEY`、`S3_SECRET_ACCESS_KEY`：

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
[BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
```

`POSTGRES_PASSWORD` 使用十六进制值，以便安全放入数据库连接 URL。`S3_ACCESS_KEY_ID` 可保留示例值。真实配置已被 Git 与 Docker 构建上下文忽略，密钥只在容器运行时注入；不要提交或公开这份文件。

**配置须随数据一起私密备份并长期保留。** 常规重启、升级不重新生成密码或密钥；更换 `ACCOUNT_ENCRYPTION_KEY` 会使原有个人模型凭据无法解密。已有数据库密码不能仅通过修改环境变量来轮换。此部署使用新的数据卷，不会自动迁移开发环境中的账户、聊天或文件。

## 3. 构建与启动

使用 pnpm 的快捷命令：

```powershell
pnpm deploy:build
pnpm deploy:up
pnpm deploy:logs
```

只安装 Docker 时，等价命令为：

```powershell
docker compose -f infra/build.compose.yaml build
docker compose --env-file infra/.env.production -f infra/production.compose.yaml config --quiet
docker compose --env-file infra/.env.production -f infra/production.compose.yaml up -d --wait --wait-timeout 180
docker compose --env-file infra/.env.production -f infra/production.compose.yaml logs -f --tail=100 caddy web api
```

构建使用仓库锁定的 pnpm 版本与依赖清单，不需要把真实密钥写入镜像。查看实时日志时按 `Ctrl+C` 只退出日志查看，容器继续运行。`config --quiet` 不打印展开后的秘密，勿将普通 `config` 的完整输出公开。

API 启动时初始化数据库结构、检查私有对象存储，并启动资料解析、向量和协作 worker，无需另起 worker 容器。数据库或已配置的对象存储不可用时启动失败，不降级为内存。首次创建的资料 bucket 保持私有。

`--wait` 只检查启动状态，不代表模型调用已成功；API 健康检查也不代表持续的数据库或模型可用性。

### 目标机无法下载镜像时

可以在能访问镜像源的电脑构建离线包。下面以目标为普通 Intel/AMD Windows 电脑为例，显式指定 `linux/amd64`；不要直接复制 Apple Silicon 默认构建的 ARM 镜像。在联网电脑的项目根目录执行：

```sh
docker build --platform linux/amd64 -f infra/app.Dockerfile --target web -t ai-harness-web:local .
docker build --platform linux/amd64 -f infra/app.Dockerfile --target api -t ai-harness-api:local .
docker build --platform linux/amd64 -f infra/postgres-vector.Dockerfile -t ai-harness-production-postgres:17-0.8.7 infra
docker build --platform linux/amd64 -f infra/minio.Dockerfile -t ai-harness-minio:RELEASE.2025-04-22T22-12-26Z infra
docker pull --platform linux/amd64 caddy:2.11.7-alpine
docker save -o ai-harness-amd64.tar ai-harness-web:local ai-harness-api:local ai-harness-production-postgres:17-0.8.7 caddy:2.11.7-alpine ai-harness-minio:RELEASE.2025-04-22T22-12-26Z
```

将镜像包及项目的 `infra` 配置目录复制到目标机，按前面的步骤单独初始化私有配置，然后执行：

```powershell
docker load -i ai-harness-amd64.tar
docker compose --env-file infra/.env.production -f infra/production.compose.yaml up -d --no-build --pull never --wait --wait-timeout 180
```

镜像包不包含运行时密钥或业务数据。离线部署仍需要目标机能访问配置的模型服务；更新时重新生成并导入镜像包，再运行上述启动命令，保留原私有配置和数据卷。

MinIO 镜像从该版本的官方 GitHub Release 二进制构建，并校验固定 SHA-256；使用项目自己的 `ai-harness-minio` 标签，避免依赖已经无法拉取的原镜像标签。下载地址与校验值保存在 `infra/minio.Dockerfile`。

## 4. 信任本机 HTTPS 证书

默认 `APP_DOMAIN=localhost` 使用 Caddy 自动生成和续期的**本地 CA 证书**，不是公共 CA 签发的证书。容器无法自动将其根证书加入 Windows 信任库，因此首次访问前，先导出本机 Caddy 的根证书并导入当前 Windows 用户：

```powershell
docker compose --env-file infra/.env.production -f infra/production.compose.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt "$env:TEMP\ai-harness-caddy-root.crt"
Import-Certificate -FilePath "$env:TEMP\ai-harness-caddy-root.crt" -CertStoreLocation Cert:\CurrentUser\Root
```

仅导入本部署生成的 `root.crt`，不导出或分发 CA 私钥。若提示证书尚不存在，先检查 Caddy 日志，待服务完成启动后重试。关闭并重新打开浏览器，访问 **<https://localhost>**；配置 `HTTPS_PORT=8443` 时访问 **<https://localhost:8443>**。HTTP 会自动跳转到对应的 HTTPS 端口。个别使用独立证书库的浏览器需要在其证书设置中另行信任这个根证书。原理见 [Caddy 本地 HTTPS 文档](https://caddyserver.com/docs/automatic-https#local-https)。

`localhost` 永远指当前访问者自己的电脑。本默认配置用于 Windows 主机本机访问；从手机、其他电脑或公网访问需要另外配置正确的访问名称、网络入口和证书信任，不能在另一台设备输入 `localhost` 访问这台 Windows 电脑。

在浏览器验证：

1. 注册或登录，刷新后会话仍有效。
2. 创建聊天、发送消息，检查模型逐步输出和停止生成。
3. 在私有项目上传文件，检查处理状态、原件和资料查询。
4. 停止并再次启动后，确认账户、聊天和文件仍存在。

## 5. 更新、停止与备份

更新代码并备份数据后，执行 `pnpm deploy:build` 和 `pnpm deploy:up`。Docker-only 环境重新执行上面的 `build` 与 `up` 命令。修改环境变量后也要执行 `up`，单纯 `restart` 不会更新容器环境变量。

```powershell
# 停止服务，保留数据
pnpm deploy:stop

# Docker-only 环境的等价命令
docker compose --env-file infra/.env.production -f infra/production.compose.yaml stop

# 查看服务状态
docker compose --env-file infra/.env.production -f infra/production.compose.yaml ps
```

四个命名卷保存 PostgreSQL、原始文件、Caddy 证书和 Caddy 配置。停止与重建容器保留这些卷；**不要运行 `down -v`，也不要在 Docker Desktop 中删除本项目的数据卷**。删除 Caddy 数据卷还会更换本地 CA，需要重新导入其根证书。

备份应包含数据库、原始文件卷、私有配置和 Caddy 数据卷，并保存在另一处受限位置。数据库与原始文件应取自同一停写窗口：停止 Web/API，让正在执行的工作退出，再备份，完成后启动。恢复已有业务数据时须保留原账户加密密钥和对象存储配置。

**历史版本升级注意：** API 初始化包含 SF-021 旧项目数据清理，并在 worker 启动前执行。升级旧环境前要完成可恢复的数据备份；回滚应用镜像不会恢复已清理的数据。本方案不包含自动备份或高可用。

## 转发与权限边界

```text
浏览器 → Caddy :443 → web:3000 → api:3001 → PostgreSQL / 私有 MinIO / 模型服务
```

Caddy 将所有请求（包括 `/api/*`）转发到 Web。Web 检查请求来源、读取账户 Cookie，并附加私有服务 token 后访问 API；API 再验证真实账户与工作空间权限。因此不要将 `/api/*` 单独直连 NestJS，也不要在 Caddy 注入服务 token。

只有 Caddy 映射主机 HTTP/TCP、HTTPS/TCP 和 HTTPS/UDP（HTTP/3）端口，默认是 80 和 443，可通过 `HTTP_PORT`、`HTTPS_PORT` 修改；Web、API、PostgreSQL、MinIO 及其控制台均不映射主机端口。Caddy 保留 Host 与 HTTPS 转发信息，满足同源校验和 Secure Cookie。当前实际运行路径未接入 Redis 或 Neo4j，因此不启动这两个服务。

Caddy 会及时转发 SSE，不配置会影响浏览器断开取消的 `flush_interval -1`，也不设置会截断长模型请求的短超时。应用允许最大 10 MiB 文件并预留 multipart 开销，代理不降低此限制。详见 [Caddy 流式响应文档](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming)。
