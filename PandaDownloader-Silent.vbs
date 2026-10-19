' Panda Downloader - Silent Background Daemon Launcher
' Developed & Published by PB Tech Zone (https://prakash77.com.np)
' This script launches Panda Downloader directly in the background tray with zero console windows.

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
strPackagedExe = strScriptDir & "\release\PandaDownloader-win32-x64\PandaDownloader.exe"
strElectronExe = strScriptDir & "\node_modules\electron\dist\electron.exe"

If fso.FileExists(strPackagedExe) Then
    WshShell.CurrentDirectory = strScriptDir
    WshShell.Run """" & strPackagedExe & """", 0, False
ElseIf fso.FileExists(strElectronExe) Then
    WshShell.CurrentDirectory = strScriptDir
    WshShell.Run """" & strElectronExe & """ .", 0, False
Else
    WshShell.CurrentDirectory = strScriptDir
    WshShell.Run "cmd.exe /c npm start", 0, False
End If

Set WshShell = Nothing
Set fso = Nothing
