# Vercel + Railway 顺序操作手册

## 推荐顺序

这条路线不要前后端一起乱配，最顺的做法是：

1. 先部署 Railway 后端
2. 拿到 Railway 后端公网地址
3. 再部署 Vercel 前端
4. 把 Vercel 前端地址回填到 Railway 的 `CORS_ORIGINS`

## 第一步：先在 Railway 部署后端

### 你要填的核心信息

- Root Directory：`apps/server`
- Build Command：`pnpm build`
- Start Command：`node dist/main.js`

### 先填的环境变量

```env
NODE_ENV=production
APP_PORT=3000
CORS_ORIGINS=https://placeholder.vercel.app
DATABASE_URL=mysql://user:password@host:3306/finance_payroll_prod
UPLOAD_DIR=./uploads
JWT_SECRET=replace_with_long_random_secret
JWT_EXPIRES_IN=7d
```

说明：

- `CORS_ORIGINS` 先随便填一个占位前端域名，后面可以改

### 你会拿到什么

部署成功后，Railway 会给你一个公网地址，例如：

```text
https://your-railway-backend.up.railway.app
```

后端接口前缀就是：

```text
https://your-railway-backend.up.railway.app/api
```

## 第二步：再去 Vercel 部署前端

### 你要填的核心信息

- Framework Preset：`Vite`
- Root Directory：`apps/web`
- Build Command：`pnpm build`
- Output Directory：`dist`

### 前端环境变量

把第一步拿到的 Railway 地址填进去：

```env
VITE_API_BASE_URL=https://your-railway-backend.up.railway.app/api
```

### 你会拿到什么

Vercel 会给你一个前端地址，例如：

```text
https://your-vercel-app.vercel.app
```

## 第三步：回到 Railway 修正跨域

把 Railway 的：

```env
CORS_ORIGINS
```

改成你第二步拿到的真实 Vercel 地址，例如：

```env
https://your-vercel-app.vercel.app
```

然后重新部署 Railway。

## 第四步：联调验证

最后验证下面四项：

1. 前端能打开
2. 服务状态能显示已连通
3. 能上传 Excel
4. 能生成算薪预览并导出文件

## 如果报跨域错误

优先检查：

1. `CORS_ORIGINS` 是否等于真实的 Vercel 域名
2. 前端 `VITE_API_BASE_URL` 是否等于真实的 Railway 接口地址
3. Railway 改完环境变量后是否已重新部署
