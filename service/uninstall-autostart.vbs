' 取消"登录后自动后台运行"：删除「启动」文件夹里的快捷方式（桌面快捷方式保留）
Option Explicit

Dim fso, shell, lnkPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
lnkPath = shell.SpecialFolders("Startup") & "\JSON 工具（后台服务）.lnk"

If fso.FileExists(lnkPath) Then
  fso.DeleteFile lnkPath, True
  MsgBox "已取消登录自启（正在运行的服务不受影响，可用 stop.vbs 停止）。", 64, "JSON 工具"
Else
  MsgBox "未发现登录自启快捷方式，无需取消。", 64, "JSON 工具"
End If
