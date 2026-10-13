@echo off
rem The hermetic gh double for Windows (the same answers as e2e/adopter-smoke.sh's): no token, no network.
if "%~1"=="--version" goto version
if "%~1 %~2 %~3 %~4"=="api user --jq .login" goto login
if "%~1 %~2"=="api user" goto user
if "%~1 %~2"=="auth status" goto auth
exit /b 0
:version
echo gh version 2.99.0 (stub-gh hermetic)
exit /b 0
:login
echo adopter-bot
exit /b 0
:user
echo {"login":"adopter-bot"}
exit /b 0
:auth
echo stub authenticated as adopter-bot
exit /b 0
