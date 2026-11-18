@echo off
setlocal
set "ROOT=%~dp0.."
if "%QT_ROOT%"=="" set "QT_ROOT=%ROOT%\..\Qt\6.8.3\msvc2022_64"
set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Debug"
if /i not "%CONFIG%"=="Debug" if /i not "%CONFIG%"=="Release" exit /b 2
if not exist "%QT_ROOT%\bin\qmake.exe" (
    echo Qt not found. Set QT_ROOT to the Qt 6.8.3 MSVC 2022 x64 directory.
    exit /b 1
)
if not defined VCINSTALLDIR (
    for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSROOT=%%i"
    call :setup
    if errorlevel 1 exit /b 1
)
set "PATH=%QT_ROOT%\bin;%PATH%"
if not exist "%ROOT%\build-vs\%CONFIG%" mkdir "%ROOT%\build-vs\%CONFIG%"
cd /d "%ROOT%\build-vs\%CONFIG%"
if /i "%~2"=="clean" (
    if not exist Makefile exit /b 0
    nmake /nologo distclean
    if errorlevel 1 exit /b 1
    exit /b 0
)
if /i "%CONFIG%"=="Debug" (set "QCONFIG=debug") else (set "QCONFIG=release")
"%QT_ROOT%\bin\qmake.exe" "%ROOT%\nhis-checker.pro" "CONFIG-=debug_and_release" "CONFIG+=%QCONFIG%" "DESTDIR=."
if errorlevel 1 exit /b 1
nmake /nologo
exit /b %errorlevel%
:setup
if not defined VSROOT exit /b 1
call "%VSROOT%\VC\Auxiliary\Build\vcvars64.bat"
exit /b %errorlevel%
