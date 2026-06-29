# Vercel 后台填写清单

## 新建项目时

### Import Repository

选择你的代码仓库。

### Framework Preset

填写：

```text
Vite
```

### Root Directory

填写：

```text
apps/web
```

### Build Command

填写：

```text
pnpm build
```

### Output Directory

填写：

```text
dist
```

## Environment Variables

添加一项：

### Key

```text
VITE_API_BASE_URL
```

### Value

先填 Railway 后端地址，例如：

```text
https://your-railway-backend.up.railway.app/api
```

## 部署完成后你会拿到什么

Vercel 会给你一个前端网址，例如：

```text
https://your-vercel-app.vercel.app
```

这个网址就是以后给别人访问的地址。
