@echo off
rem Abre Trazo y deja entrar a la tablet conectada a la misma wifi.
rem La primera vez Windows preguntara si permite el acceso a la red: elige solo "Redes privadas".
cd /d "%~dp0"
set PY=C:\Users\jesus\AppData\Local\Programs\Python\Python312\python.exe
if exist "%PY%" (
  "%PY%" servidor.py --red
) else (
  py servidor.py --red || python servidor.py --red
)
pause
