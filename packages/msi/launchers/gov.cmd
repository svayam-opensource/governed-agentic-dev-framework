@echo off
rem gov launcher, installed by the gov MSI into %LOCALAPPDATA%\Programs\gov\bin (the only directory it puts on PATH).
rem It runs gov with gov's own Node and leaves the machine's Node alone: node\ goes first on PATH for this process only.
rem GOV_BIN_DIR tells gov where to write <agent>.cmd shims; NPM_CONFIG_PREFIX keeps npm -g installs beside gov's Node.
setlocal
for %%I in ("%~dp0..") do set "GOV_ROOT=%%~fI"
set "GOV_BIN_DIR=%GOV_ROOT%\bin"
set "PATH=%GOV_ROOT%\node;%PATH%"
set "NPM_CONFIG_PREFIX=%GOV_ROOT%\node"
"%GOV_ROOT%\node\node.exe" "%GOV_ROOT%\app\{{BIN_JS}}" %*
exit /b %ERRORLEVEL%
