# 财务算薪工具

这是一个面向内部财务算薪场景的开发骨架，用于承接当前 Excel 薪资表、绩效表的系统化改造。

## 当前已完成

- 已提供前端可视化工作台，可上传工资表、绩效表并查看历史记录
- 已提供后端上传接口、健康检查接口、首版算薪预览接口
- 已支持从 Excel 中抽取字段、识别表头、展示标准化预览
- 已支持按姓名合并工资表与绩效表，生成首版算薪草稿与异常提示
- 已补齐前后端环境变量入口，支持从本地开发切换到线上部署

## 目录结构

```text
finance-payroll-tool/
├── apps/
│   ├── server/         # 后端服务（建议 NestJS）
│   └── web/            # 前端管理台（建议 Vue 3）
├── docs/               # 产品、字段、规则、接口文档
├── infra/
│   └── sql/            # 本地数据库初始化脚本
└── scripts/            # 本地开发辅助脚本
```

## 第一阶段目标

第一阶段只做环境准备，不直接进入业务开发：

- 确认本机开发工具链
- 准备本地数据库
- 准备本地缓存服务
- 建立项目目录结构
- 固化环境变量和初始化步骤

## 当前推荐技术栈

- 前端：`Vue 3` + `TypeScript` + `Element Plus`
- 后端：`NestJS` + `TypeScript`
- 数据库：`MySQL 8`
- 缓存：`Redis`
- ORM：`Prisma`
- Excel 处理：`exceljs`
- 包管理：`pnpm`

## 当前环境检查结果

截至当前机器检查结果：

- Node.js：已安装
- npm：已安装
- pnpm：已安装
- Git：已安装
- MySQL：已安装
- Redis：安装中或待安装完成
- Docker：未安装

## 本地开发建议

### 1. 数据库

建议本地创建一个独立数据库，例如：

- 数据库名：`finance_payroll_dev`

初始化脚本见：

- [infra/sql/init.sql](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/infra/sql/init.sql)

### 2. 环境变量

请复制 `.env.example` 为 `.env` 后按本机实际情况填写：

```bash
cp .env.example .env
```

当前关键变量：

- `APP_PORT`：后端服务端口
- `CORS_ORIGINS`：允许访问后端接口的前端地址，多个地址用英文逗号分隔
- `VITE_API_BASE_URL`：前端请求后端接口的基础地址
- `DATABASE_URL`：MySQL 连接串
- `UPLOAD_DIR`：上传文件本地保存目录

本地开发推荐配置：

```env
APP_PORT=3000
CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
VITE_API_BASE_URL=http://127.0.0.1:3000/api
```

如果后续上线：

- 前端部署域名假设为 `https://payroll-web.example.com`
- 后端部署域名假设为 `https://payroll-api.example.com/api`

则建议改为：

```env
CORS_ORIGINS=https://payroll-web.example.com
VITE_API_BASE_URL=https://payroll-api.example.com/api
```

如果前端和后端最终挂在同一域名网关下，也可以让前端使用相对路径 `/api`。

### 3. 本地启动

后端：

```bash
cd apps/server
pnpm dev
```

前端：

```bash
cd apps/web
pnpm dev
```

默认访问地址：

- 前端工作台：`http://127.0.0.1:5173`
- 后端接口：`http://127.0.0.1:3000/api`

如果你暂时不上线，也可先参考：

- [本地长期运行说明](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/本地长期运行说明.md)
- [局域网访问说明](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/局域网访问说明.md)

### 4. 上线建议

如果要给别人稳定使用，不建议继续依赖你本机一直开着本地服务。更合适的做法是：

- 前端部署到静态托管平台，例如 Vercel、Netlify 或国内静态站点服务
- 后端部署到可长期运行的 Node.js 服务平台，例如 Railway、Render、Fly.io 或云服务器
- 数据库迁移到云 MySQL，例如阿里云 RDS、腾讯云 MySQL、Railway MySQL
- 上传文件后续迁移到对象存储，例如 OSS、COS、S3

当前代码已经具备最基础的上线前提：

- 前端接口地址可配置
- 后端跨域来源可配置
- 本地与线上环境可以分离
- 已提供 Docker 部署脚手架
- 已提供公网部署执行文档与线上环境变量模板

下一步如果继续推进，我建议直接补：

1. 登录权限
2. 算薪结果导出
3. 规则配置化
4. 线上部署脚本或 Docker 化

上线文档可直接参考：

- [公网部署执行清单](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/公网部署执行清单.md)
- [线上环境变量模板](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/线上环境变量模板.md)
- [部署方案-云服务器Docker](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/部署方案-云服务器Docker.md)
- [部署方案-托管平台](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/部署方案-托管平台.md)
- [Vercel + Railway 上线步骤](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/Vercel-Railway上线步骤.md)
- [Vercel + Railway 顺序操作手册](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/Vercel-Railway顺序操作手册.md)
- [Vercel后台填写清单](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/Vercel后台填写清单.md)
- [Railway后台填写清单](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/Railway后台填写清单.md)
- [上线前最终检查表](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/上线前最终检查表.md)

生产部署文件：

- [`.env.production.example`](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/.env.production.example)
- [`docker-compose.prod.yml`](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docker-compose.prod.yml)
- [`infra/nginx/payroll.conf`](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/infra/nginx/payroll.conf)

### 5. 后续初始化建议

当前后端骨架文件已经生成。等你确认依赖安装没问题后，再继续执行：

1. 初始化后端 `NestJS`
2. 初始化前端 `Vue 3`
3. 接入 `Prisma`
4. 建表并导入首批 Excel 数据

## 第一阶段交付物

当前目录已提供：

- 项目结构骨架
- 环境变量模板
- 数据库初始化脚本
- 启停服务脚本
- 开发环境准备说明
