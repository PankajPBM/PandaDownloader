@echo off
set SCRIPT_DIR=%~dp0
set MANIFEST_PATH=%SCRIPT_DIR%com.panda.downloader.json

echo Registering Panda Downloader Native Messaging Host...
echo Manifest path: %MANIFEST_PATH%

REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.panda.downloader" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f
REG ADD "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.panda.downloader" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

echo Done! Native Messaging registered for Google Chrome and Microsoft Edge.
pause
