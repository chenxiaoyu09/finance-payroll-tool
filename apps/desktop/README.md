# 财务算薪桌面工具原型

这个目录用于把现有的财务算薪系统包装成一个本地桌面工具。

## 当前形态

当前已经提供一个 `Electron` 桌面壳原型：

- 自动启动本地后端 `apps/server/dist/main.js`
- 本地启动一个轻量网关，把前端静态页面和 `/api` 代理整合到一个本地地址
- 打开桌面窗口，不依赖公网服务器
- 自动在应用本地数据目录生成桌面版运行配置
- bundle 会尽量只保留运行态依赖，减少开发依赖混入产物

## 使用前提

请先确保本机环境正常：

- 后端可正常构建
- 前端可正常构建
- 如果 MySQL 可用，系统会优先使用数据库
- 如果 MySQL 不可用，上传记录会退回本地 JSON 存储
- Redis 不是当前桌面版运行必需项

目前已经验证：

- 数据库不可连接时，后端仍可启动
- `/api/health` 可返回 `local-json-fallback`
- `/api/uploads` 可正常返回本地记录列表
- `/api/uploads/excel` 可在 fallback 模式下正常完成上传与解析
- `/api/uploads/performance/confirm`、`/api/uploads/payroll-draft` 以及多个导出接口在 fallback 模式下也可正常工作

## 首次准备

### 1. 安装桌面端依赖

```bash
cd apps/desktop
pnpm install
```

### 2. 构建前后端

```bash
cd ../server
pnpm build

cd ../web
VITE_API_BASE_URL=/api pnpm build
```

## 启动桌面工具

```bash
cd ../desktop
pnpm start
```

启动后会打开一个本地桌面窗口。

## 开发模式

如果你希望一边改前端/后端，一边看桌面端效果：

```bash
cd apps/desktop
pnpm dev
```

它会同时启动：

- 后端开发服务
- 前端 Vite 开发服务
- Electron 桌面窗口

## 本地 fallback 冒烟验证

如果你想一键验证“数据库不可连接时，桌面本地模式还能不能走完整主流程”，可以执行：

```bash
cd apps/desktop
pnpm smoke:fallback
```

这条命令会自动验证：

- 健康检查
- 绩效表上传
- 流程状态推进
- 绩效确认
- 工资表上传
- 工资草稿生成
- 多个关键导出接口

## 当前限制

这还是一个原型版本，暂时还没有做：

- 安装包打包（`.dmg` / `.exe`）
- 本地数据库切换为 SQLite
- 桌面菜单、自动更新、错误恢复
- Windows 实机打包验证

但它已经足够验证这条路线是否适合把算薪系统做成“本地工具”。
