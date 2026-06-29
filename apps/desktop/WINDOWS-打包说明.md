# Windows 打包说明

这个桌面版项目已经补好了 Windows 打包配置，目标是生成：

- `portable.exe`
- `zip`

这样你就可以把压缩包或便携版程序直接发给别人使用。

## 推荐分发方式

优先推荐：

- `portable.exe`

原因：

- 对方不需要安装
- 双击即可运行
- 更适合内部试用

备选：

- `zip`

原因：

- 方便通过聊天工具或网盘发送
- 对方解压后双击 `exe` 即可

## 现在已经补好的两条出包路线

### 路线 1：在 Windows 电脑上本地出包

适合你自己有一台 Windows 电脑，或者能借到一台机器。

### 路线 2：用 GitHub Actions 自动出包

项目里已经补好工作流文件：

- `.github/workflows/build-windows-desktop.yml`

你把项目放到 GitHub 后，可以直接：

1. 打开仓库的 `Actions`
2. 选择 `Build Windows Desktop`
3. 点击 `Run workflow`
4. 等待完成
5. 在构建产物里下载 Windows 版压缩包

这样你就不需要自己手工装 Windows 打包环境。

## 为什么不建议在当前 Mac 上直接出 Windows exe

虽然 `electron-builder` 支持一部分跨平台打包，但：

- Windows 产物在 Windows 环境里打包最稳
- 某些依赖、权限、签名、运行时细节在跨平台环境下容易出问题

所以最推荐的做法是：

1. 把当前项目拷到一台 Windows 电脑
2. 安装 Node.js 和 pnpm
3. 执行下面命令打包

## Windows 电脑上的打包步骤

### 1. 安装依赖

```bash
cd apps\server
pnpm install

cd ..\web
pnpm install

cd ..\desktop
pnpm install
```

### 2. 执行便携版打包

```bash
pnpm dist:win-portable
```

### 3. 如果只想先出目录结构

```bash
pnpm dist:win-dir
```

## 产物位置

打包完成后，通常会在：

```bash
apps\desktop\release
```

里面看到类似文件：

- `财务算薪系统-0.1.0-x64-portable.exe`
- `财务算薪系统-0.1.0-x64.zip`

如果你走的是 GitHub Actions 路线：

- 产物会在 Actions 的构建附件里下载
- 下载后解压即可拿到 `portable.exe` 或 `zip`

## 发给别人怎么说

如果你发的是：

- `portable.exe`

可以直接告诉对方：

“下载后双击即可使用，不需要安装。”

如果你发的是：

- `zip`

可以直接告诉对方：

“先解压，再双击里面的 exe 文件运行。”

## 还要注意的现实问题

即使打成桌面程序，运行时依然依赖：

- 项目后端本身的运行条件

不过当前项目已经补了一层兜底：

- 如果 MySQL 可用，继续走 MySQL
- 如果 MySQL 不可用，上传记录会自动退回本地 JSON 文件存储
- 桌面版正在切换到应用自己的本地数据目录，不再依赖源码目录保存上传文件和流程状态
- Redis 不是当前桌面版运行的必要条件

也就是说，门槛已经比之前低了一层，但还没有低到“完全零依赖”。

如果后面你想把门槛再降一层，下一步建议是：

- 把数据库尽量本地轻量化
- 或者把依赖进一步内嵌

这样才更接近“普通人解压即用”的体验。
