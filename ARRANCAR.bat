@echo off
rem Abre Trazo en este ordenador. Doble clic y listo.
cd /d "%~dp0"
set PY=C:\Users\jesus\AppData\Local\Programs\Python\Python312\python.exe
if exist "%PY%" (
  "%PY%" servidor.py %*
) else (
  py servidor.py %* || python servidor.py %*
)
pause
