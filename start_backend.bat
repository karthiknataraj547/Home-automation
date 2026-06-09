@echo off
echo [LUKAS Python Backend] Starting setup...

:: Try to find python executable
set PYTHON_EXE=
for %%i in (python python3 py) do (
    %%i --version >nul 2>&1
    if not errorlevel 1 (
        set PYTHON_EXE=%%i
        goto :found_python
    )
)

:: Check common Windows install locations
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python311\python.exe
    goto :found_python
)
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe
    goto :found_python
)
if exist "C:\Python311\python.exe" (
    set PYTHON_EXE=C:\Python311\python.exe
    goto :found_python
)

echo [ERROR] Python not found. Please install Python 3.10+ from https://python.org
pause
exit /b 1

:found_python
echo [LUKAS Python Backend] Found Python: %PYTHON_EXE%
echo [LUKAS Python Backend] Installing dependencies...
%PYTHON_EXE% -m pip install -r requirements.txt --quiet

if errorlevel 1 (
    echo [ERROR] Failed to install dependencies. Check your internet connection.
    pause
    exit /b 1
)

echo [LUKAS Python Backend] Starting FastAPI server on http://127.0.0.1:8000
%PYTHON_EXE% api\server.py
pause
