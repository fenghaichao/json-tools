' 一键安装"登录后自动后台运行"：
'   1) 在「启动」文件夹放 ensure.vbs 的快捷方式 → 每次登录后台拉起服务（无窗口）
'   2) 在桌面放「JSON 工具」快捷方式 → 双击打开浏览器（服务没起会自动先起）
Option Explicit

Dim fso, shell, scriptDir, ensureVbs, wscriptExe, lnk
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ensureVbs = scriptDir & "\ensure.vbs"
wscriptExe = shell.ExpandEnvironmentStrings("%WINDIR%") & "\System32\wscript.exe"

Set lnk = shell.CreateShortcut(shell.SpecialFolders("Startup") & "\JSON 工具（后台服务）.lnk")
lnk.TargetPath = wscriptExe
lnk.Arguments = """" & ensureVbs & """"
lnk.WorkingDirectory = scriptDir
lnk.Save

Set lnk = shell.CreateShortcut(shell.SpecialFolders("Desktop") & "\JSON 工具.lnk")
lnk.TargetPath = wscriptExe
lnk.Arguments = """" & ensureVbs & """ open"
lnk.WorkingDirectory = scriptDir
lnk.Save

MsgBox "已安装：" & vbCrLf & _
  "· 登录后台常驻：启动文件夹已加入「JSON 工具（后台服务）」" & vbCrLf & _
  "· 桌面快捷方式：「JSON 工具」双击即打开页面" & vbCrLf & vbCrLf & _
  "如需取消，双击 service 目录下的 uninstall-autostart.vbs。", 64, "JSON 工具"
