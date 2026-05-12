@SETLOCAL
@SET "NODE_PATH=%~dp0openclaw\node_modules"
@IF EXIST "%~dp0node\node.exe" (
  "%~dp0node\node.exe" "%~dp0openclaw\openclaw.mjs" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node "%~dp0openclaw\openclaw.mjs" %*
)