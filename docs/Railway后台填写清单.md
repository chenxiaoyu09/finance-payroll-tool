# Railway 后台填写清单

## 新建项目时

### Deploy from GitHub Repo

选择你的代码仓库。

### Root Directory

填写：

```text
apps/server
```

## Build / Start

如果平台没有自动识别，就手工确认：

### Build Command

```text
pnpm build
```

### Start Command

```text
node dist/main.js
```

## Environment Variables

至少填写下面这些：

### NODE_ENV

```text
production
```

### APP_PORT

```text
3000
```

### CORS_ORIGINS

先填你的 Vercel 前端地址，例如：

```text
https://your-vercel-app.vercel.app
```

### DATABASE_URL

例如：

```text
mysql://user:password@host:3306/finance_payroll_prod
```

### UPLOAD_DIR

```text
./uploads
```

### JWT_SECRET

填写一个足够长的随机字符串。

### JWT_EXPIRES_IN

```text
7d
```

## 部署完成后你会拿到什么

Railway 会给你一个后端地址，例如：

```text
https://your-railway-backend.up.railway.app
```

前端里要使用的完整接口前缀则是：

```text
https://your-railway-backend.up.railway.app/api
```
