' JSON 工具后台启动器：确保本地服务在运行（幂等，重复双击不会起第二个）
' 依赖 PATH 中的 node（安装 Node.js 18+ 后自带），数据目录固定 %APPDATA%\json-tools
' 可选参数 open：服务就绪后用默认浏览器打开 http://localhost:<实际端口>
Option Explicit

Dim fso, shell, scriptDir, serverJs, dataDir, pidFile
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverJs = fso.GetParentFolderName(scriptDir) & "\server.js"
dataDir = shell.ExpandEnvironmentStrings("%APPDATA%") & "\json-tools"
pidFile = dataDir & "\server.pid"

Function JsonNum(txt, key)
  JsonNum = 0
  Dim re, m
  Set re = New RegExp
  re.Pattern = """" & key & """\s*:\s*(\d+)"
  Set m = re.Execute(txt)
  If m.Count > 0 Then JsonNum = CLng(m(0).SubMatches(0))
End Function

Function ReadPidFile()
  ' 返回 Array(pid, port)；文件不存在或不可读时返回 Array(0, 0)
  ReadPidFile = Array(0, 0)
  If Not fso.FileExists(pidFile) Then Exit Function
  Dim ts, txt
  On Error Resume Next
  Set ts = fso.OpenTextFile(pidFile, 1)
  txt = ts.ReadAll
  ts.Close
  On Error GoTo 0
  ReadPidFile = Array(JsonNum(txt, "pid"), JsonNum(txt, "port"))
End Function

Function ProcessAlive(pid, procName)
  ' 仅当该 PID 存在且进程名匹配时才认为存活，避免 PID 复用误判
  ProcessAlive = False
  If pid <= 0 Then Exit Function
  Dim svc, col, p
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  Set col = svc.ExecQuery("Select * From Win32_Process Where ProcessId=" & pid)
  For Each p In col
    If LCase(p.Name) = LCase(procName) Then ProcessAlive = True
  Next
End Function

Dim wantOpen, cur, deadPid, i
wantOpen = False
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "open" Then wantOpen = True
End If

cur = ReadPidFile()
If ProcessAlive(cur(0), "node.exe") Then
  ' 服务已在运行，直接复用
Else
  deadPid = cur(0)
  shell.Run "node """ & serverJs & """ --data=""" & dataDir & """", 0, False
  For i = 1 To 100 ' 最多等 10 秒
    WScript.Sleep 100
    cur = ReadPidFile()
    If cur(0) <> 0 And cur(0) <> deadPid And ProcessAlive(cur(0), "node.exe") Then Exit For
    cur = Array(0, 0)
  Next
End If

If Not ProcessAlive(cur(0), "node.exe") Then
  If wantOpen Then MsgBox "JSON 工具服务启动失败：请确认已安装 Node.js 18+（命令行 node -v 能看到版本号），再双击本脚本。", 48, "JSON 工具"
  WScript.Quit 1
End If

If wantOpen Then shell.Run "http://localhost:" & cur(1), 1, False
