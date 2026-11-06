@echo off
setlocal
cd /d "%~dp0"
title MidiaLocal

where node >nul 2>nul
if errorlevel 1 goto sem_node

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto node_antigo

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo AVISO: FFmpeg nao encontrado. Fotos e documentos funcionam, mas videos ficam desativados.
  echo        Para ativar os videos, rode: winget install Gyan.FFmpeg
  echo.
)

if not exist "node_modules\" (
  echo Instalando dependencias, so na primeira vez. Isso leva alguns segundos...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 goto erro_install
  echo.
)

node server.js --open
goto fim

:sem_node
echo ERRO: o Node.js nao esta instalado.
echo.
echo Instale a versao LTS em https://nodejs.org
echo ou rode no terminal: winget install OpenJS.NodeJS.LTS
echo.
echo Depois feche esta janela e abra o iniciar.bat de novo.
goto fim

:node_antigo
for /f %%v in ('node -v') do set NODE_VERSION=%%v
echo ERRO: o MidiaLocal precisa do Node.js 22.13 ou mais novo. Voce tem o %NODE_VERSION%.
echo.
echo Atualize em https://nodejs.org
echo ou rode no terminal: winget upgrade OpenJS.NodeJS.LTS
goto fim

:erro_install
echo.
echo ERRO: nao foi possivel instalar as dependencias. Verifique sua conexao com a internet
echo e tente de novo. Se continuar falhando, apague a pasta node_modules e rode outra vez.
goto fim

:fim
echo.
pause
