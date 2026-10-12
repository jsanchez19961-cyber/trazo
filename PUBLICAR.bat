@echo off
rem Publica la ultima version del PROGRAMA Trazo en GitHub Pages.
rem Tus notas NO se suben: estan en cada dispositivo y en tu Google Drive.
cd /d "%~dp0"
git add -A
git commit -m "Actualizar Trazo"
git push -u origin main
git subtree push --prefix app origin gh-pages
echo.
echo Listo. En uno o dos minutos estara en https://jsanchez19961-cyber.github.io/trazo/
pause
