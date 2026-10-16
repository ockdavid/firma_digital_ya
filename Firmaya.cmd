@echo off
rem Doble clic aqui para arrancar Firmaya y abrir el navegador.
setlocal
cd /d "%~dp0"
title Firmaya - servidor (no cierres esta ventana)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo No se encuentra Node.js.
  echo Instalalo desde https://nodejs.org y vuelve a hacer doble clic aqui.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo Primera vez: instalando dependencias. Tarda un par de minutos.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Fallo la instalacion de dependencias.
    pause
    exit /b 1
  )
)

if not exist ".env.local" (
  echo.
  echo Falta el fichero .env.local.
  echo Copia .env.example a .env.local y rellena APP_SECRET y ADMIN_PASSWORD.
  echo.
  pause
  exit /b 1
)

echo.
echo Preparando Firmaya. Esto tarda unos segundos la primera vez.
echo.

rem Modo produccion: compilar una vez y servir. En modo desarrollo cada
rem pantalla se compila al abrirla y tarda un par de segundos.
call npm run build
if errorlevel 1 (
  echo.
  echo Fallo la preparacion. Revisa los errores de arriba.
  pause
  exit /b 1
)

echo.
echo Arrancando Firmaya. El navegador se abrira solo en unos segundos.
echo Para parar el servidor: cierra esta ventana o pulsa Ctrl+C.
echo.

start "" /b node scripts\abrir-navegador.mjs
call npm start

echo.
echo El servidor se ha detenido.
pause
