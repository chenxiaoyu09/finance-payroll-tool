# 部署方案一：云服务器 + Docker

## 适用场景

如果你希望系统长期稳定在线，并且后续还要继续扩展权限、日志、备份、对象存储，这个方案最合适。

## 推荐架构

- 前端：Nginx 静态站点
- 后端：NestJS Node 服务
- 数据库：MySQL
- 缓存：Redis
- 部署方式：Docker Compose

## 最终访问方式

- 前端：`https://payroll.your-domain.com`
- 后端：`https://api.your-domain.com/api`

## 服务器建议

- 2 核 4G 起步
- Ubuntu 22.04
- 开放端口：`80`、`443`

## 服务器初始化

安装 Docker 与 Docker Compose 后，把项目上传到服务器，例如：

```bash
/srv/finance-payroll-tool
```

## 生产环境变量建议

根目录 `.env` 可参考：

```env
NODE_ENV=production
APP_PORT=3000
CORS_ORIGINS=https://payroll.your-domain.com
VITE_API_BASE_URL=https://api.your-domain.com/api

DB_HOST=mysql
DB_PORT=3306
DB_NAME=finance_payroll_prod
DB_USER=root
DB_PASSWORD=replace_this_password
DATABASE_URL=mysql://root:replace_this_password@mysql:3306/finance_payroll_prod

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

UPLOAD_DIR=./uploads
JWT_SECRET=replace_with_long_random_secret
JWT_EXPIRES_IN=7d
```

项目里也已经提供了生产模板：

- [`.env.production.example`](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/.env.production.example)

## 推荐生产启动方式

建议不要直接使用开发演示版 `docker-compose.yml`，正式上云请使用生产版：

- [`docker-compose.prod.yml`](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docker-compose.prod.yml)
- [`infra/nginx/payroll.conf`](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/infra/nginx/payroll.conf)

先准备生产环境变量：

```bash
cp .env.production.example .env.production
```

再按你的域名和密码修改 `.env.production`。

## 启动命令

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## 验证步骤

```bash
curl http://127.0.0.1/api/health
```

如果后端通了，再继续配置反向代理。

## Nginx 反向代理思路

建议拆两个域名：

- `payroll.your-domain.com` 指向前端
- `api.your-domain.com` 指向后端

如果要走统一域名，也可以把 `/api` 转发给后端。

当前仓库已内置正式 Nginx 配置：

- [`infra/nginx/payroll.conf`](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/infra/nginx/payroll.conf)

扩展示例和命令可继续参考：

- [Nginx反向代理示例.conf](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/Nginx反向代理示例.conf.md)
- [服务器部署命令清单](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/服务器部署命令清单.md)

## 这个方案的优点

- 最稳定
- 可控性强
- 后续方便扩容
- 更适合正式项目
