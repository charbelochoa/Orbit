@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
set "ELECTRON_NO_ATTACH_CONSOLE="
"%~dp0Orbit AI.exe" "%~dp0resources\app\electron\cli.cjs" %*
exit /b %errorlevel%
