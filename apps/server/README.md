# Server

后端建议使用 `NestJS + Prisma + MySQL + Redis`。

## 当前状态

当前目录已完成：

- `NestJS` 基础结构文件
- `Prisma` 基础 schema
- 健康检查接口骨架

当前尚未完成：

- 依赖安装
- Prisma Client 生成
- Redis 接入
- 业务模块开发

## 启动前准备

1. 在项目根目录创建 `.env`
2. 增加 `DATABASE_URL`

示例：

```env
DATABASE_URL="mysql://root:123456@127.0.0.1:3306/finance_payroll_dev"
```

3. 安装依赖

```bash
cd apps/server
pnpm install
```

4. 生成 Prisma Client

```bash
pnpm prisma:generate
```

5. 启动开发环境

```bash
pnpm dev
```
