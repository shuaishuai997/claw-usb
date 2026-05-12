#!/usr/bin/env pwsh
$basedir = Split-Path $MyInvocation.MyCommand.Definition -Parent
$exe = ""
$pathsep = ":"

if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  $exe = ".exe"
  $pathsep = ";"
}

$env:NODE_PATH = "$basedir\openclaw\node_modules"

$ret = 0
# node.exe 在 node/ 子目录下
if (Test-Path "$basedir\node\node$exe") {
  if ($MyInvocation.ExpectingInput) {
    $input | & "$basedir\node\node$exe" "$basedir\openclaw\openclaw.mjs" $args
  } else {
    & "$basedir\node\node$exe" "$basedir\openclaw\openclaw.mjs" $args
  }
  $ret = $LASTEXITCODE
} else {
  # fallback 到系统 node
  if ($MyInvocation.ExpectingInput) {
    $input | & "node$exe" "$basedir\openclaw\openclaw.mjs" $args
  } else {
    & "node$exe" "$basedir\openclaw\openclaw.mjs" $args
  }
  $ret = $LASTEXITCODE
}
exit $ret