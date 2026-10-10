# JSON 工具安装包构建脚本
# 前置：1) 安装 Inno Setup 6：winget install JRSoftware.InnoSetup
#       2) 本机已装 Node（node.exe 会从这里复制到 setup\ 作为打包素材）
# 用法：powershell -ExecutionPolicy Bypass -File setup\build.ps1
$ErrorActionPreference = 'Stop'
$paths = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)
$iscc = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { Write-Error '未找到 ISCC.exe，请先执行：winget install JRSoftware.InnoSetup'; exit 1 }

$nodeStaged = Join-Path $PSScriptRoot 'node.exe'
if (-not (Test-Path $nodeStaged)) {
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue)
  if (-not $node) { Write-Error '未找到 node，请先安装 Node.js 18+'; exit 1 }
  Copy-Item $node.Source $nodeStaged
  Write-Host "已复制 $($node.Source) -> $nodeStaged"
}

& $iscc (Join-Path $PSScriptRoot 'json-tools.iss')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Get-ChildItem (Join-Path $PSScriptRoot 'out') | Format-Table Name, Length
