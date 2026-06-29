# Vercel + Railway 上线步骤

## 适合谁

适合你现在这种情况：

- 没有云服务器
- 想尽快让别人访问
- 先接受“够用、能跑、易部署”，再慢慢升级

最推荐的实际执行顺序可直接参考：

- [Vercel + Railway 顺序操作手册](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/Vercel-Railway顺序操作手册.md)

## 一、前端部署到 Vercel

前端目录：

```text
apps/web
```

Vercel 配置文件已提供：

- [`apps/web/vercel.json`](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/apps/web/vercel.json)

### Vercel 里需要设置

- Framework Preset：`Vite`
- Root Directory：`apps/web`
- Build Command：`pnpm build`
- Output Directory：`dist`

### 前端环境变量

```env
VITE_API_BASE_URL=https://your-railway-backend.up.railway.app/api
```

后台逐项填写可直接参考：

- [Vercel后台填写清单](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/Vercel后台填写清单.md)

## 二、后端部署到 Railway

后端目录：

```text
apps/server
```

Railway 配置文件已提供：

- [`apps/server/railway.json`](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/apps/server/railway.json)

### Railway 里需要设置

- Root Directory：`apps/server`
- Build Command：`pnpm build`
- Start Command：`node dist/main.js`

### 后端环境变量

```env
NODE_ENV=production
APP_PORT=3000
CORS_ORIGINS=https://your-vercel-app.vercel.app
DATABASE_URL=mysql://user:password@host:3306/finance_payroll_prod
UPLOAD_DIR=./uploads
JWT_SECRET=replace_with_long_random_secret
JWT_EXPIRES_IN=7d
```

后台逐项填写可直接参考：

- [Railway后台填写清单](/Users/kristen/Documents/Codex/2026-06-23/niha/finance-payroll-tool/docs/Railway后台填写清单.md)

## 三、数据库

你可以选：

- Railway 自带 MySQL
- 阿里云 RDS
- 腾讯云 MySQL

如果只是先跑通，Railway 自带数据库是最快的。

## 四、最终访问

部署完成后：

- 别人访问前端地址，例如：`https://your-vercel-app.vercel.app`
- 前端再调用 Railway 上的后端接口

## 五、当前限制

这条路线很适合快速发布，但要注意：

- 上传文件如果依赖平台本地磁盘，持久化能力不一定稳定
- 真正长期使用，后续建议把上传文件改为对象存储
