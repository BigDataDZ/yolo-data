$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host 'YOLO Data Windows 启动向导'
Write-Host "项目目录：$ProjectRoot"

try {
    $NodeVersionText = (& node --version 2>$null).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'node command failed' }
} catch {
    Write-Error '未找到 Node.js。请先安装 Node.js >= 22.5（包含 npm），然后重新运行 start.ps1。'
    exit 1
}
$NodeVersion = [version]($NodeVersionText.TrimStart('v'))
if ($NodeVersion -lt [version]'22.5') {
    Write-Error "Node.js 版本过低：$NodeVersionText，需要 >= 22.5。"
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error '未找到 npm。请修复 Node.js/npm 安装或 PATH 后重试。'
    exit 1
}

$NodeReady = $false
& node -e "Promise.all([import('@modelcontextprotocol/sdk'),import('mysql2/promise'),import('knex'),import('yaml'),import('zod')]).catch(()=>process.exit(1))" 2>$null
$NodeReady = $LASTEXITCODE -eq 0
$VenvPython = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
$PythonReady = $false
if (Test-Path $VenvPython) {
    & $VenvPython -c 'import pandas, openpyxl' 2>$null
    $PythonReady = $LASTEXITCODE -eq 0
}

if (-not $NodeReady -or -not $PythonReady) {
    Write-Host '首次启动或检测到依赖缺失，需要初始化运行环境。'
    $NpmChoice = Read-Host 'npm registry（回车沿用当前配置，输入 m 使用 npmmirror）'
    if ($NpmChoice -match '^[mM]$') { $env:npm_config_registry = 'https://registry.npmmirror.com' }
    $PipChoice = Read-Host 'Python 包源（回车沿用当前配置，输入 a 使用阿里云镜像）'
    if ($PipChoice -match '^[aA]$') { $env:PIP_INDEX_URL = 'https://mirrors.aliyun.com/pypi/simple/' }
    & npm run setup
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host '运行依赖已就绪，跳过安装。'
}

Write-Host '正在启动……'
& npm run dev
exit $LASTEXITCODE
