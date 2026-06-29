const fs = require('node:fs')
const path = require('node:path')

const desktopDir = path.resolve(__dirname, '..')
const rootDir = path.resolve(desktopDir, '..', '..')
const serverDir = path.resolve(rootDir, 'apps/server')
const webDir = path.resolve(rootDir, 'apps/web')
const bundleDir = path.resolve(desktopDir, 'bundle')

function resetDir(targetDir) {
  fs.rmSync(targetDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  })
  fs.mkdirSync(targetDir, { recursive: true })
}

function recreateDir(targetDir) {
  fs.rmSync(targetDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  })
  fs.mkdirSync(targetDir, { recursive: true })
}

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} 不存在: ${targetPath}`)
  }
}

function copyDir(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    force: true,
  })
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true })
}

function buildRuntimeServerPackageJson(serverPackageJson) {
  return {
    name: serverPackageJson.name,
    version: serverPackageJson.version,
    private: true,
    description: serverPackageJson.description,
    main: 'dist/main.js',
    dependencies: serverPackageJson.dependencies || {},
  }
}

function ensureParentDir(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
}

function copyRuntimeServerDependencies(serverNodeModulesDir, serverNodeModulesBundleDir, dependencies) {
  resetDir(serverNodeModulesBundleDir)

  Object.keys(dependencies).forEach((packageName) => {
    const sourcePath = path.resolve(serverNodeModulesDir, packageName)
    const destinationPath = path.resolve(serverNodeModulesBundleDir, packageName)

    ensureExists(sourcePath, `运行时依赖 ${packageName}`)
    ensureParentDir(destinationPath)
    copyDir(sourcePath, destinationPath)
  })
}

function main() {
  const serverDistDir = path.resolve(serverDir, 'dist')
  const serverNodeModulesDir = path.resolve(serverDir, 'node_modules')
  const serverPackageJson = path.resolve(serverDir, 'package.json')
  const webDistDir = path.resolve(webDir, 'dist')
  const runtimeTemplateEnv = path.resolve(desktopDir, 'runtime-template.env')
  const bundleBuildDir = path.resolve(desktopDir, 'bundle-build')

  ensureExists(serverDistDir, '后端构建产物')
  ensureExists(serverNodeModulesDir, '后端依赖目录')
  ensureExists(serverPackageJson, '后端 package.json')
  ensureExists(webDistDir, '前端构建产物')
  ensureExists(runtimeTemplateEnv, '桌面运行配置模板')

  recreateDir(bundleBuildDir)

  const parsedServerPackageJson = JSON.parse(fs.readFileSync(serverPackageJson, 'utf8'))

  copyDir(serverDistDir, path.resolve(bundleBuildDir, 'server-dist'))
  copyRuntimeServerDependencies(
    serverNodeModulesDir,
    path.resolve(bundleBuildDir, 'server-node_modules'),
    parsedServerPackageJson.dependencies || {},
  )
  fs.writeFileSync(
    path.resolve(bundleBuildDir, 'server-package.json'),
    JSON.stringify(buildRuntimeServerPackageJson(parsedServerPackageJson), null, 2),
    'utf8',
  )
  copyDir(webDistDir, path.resolve(bundleBuildDir, 'web-dist'))
  copyFile(runtimeTemplateEnv, path.resolve(bundleBuildDir, 'runtime-template.env'))

  fs.rmSync(bundleDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  })
  fs.renameSync(bundleBuildDir, bundleDir)

  process.stdout.write('[desktop] bundle 资源已准备完成\n')
}

main()
