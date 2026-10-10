' JSON 工具停止器：只终止 server.pid 记录且进程名为 node.exe 的进程，绝不按映像名批量杀
Option Explicit

Dim fso, shell, dataDir, pidFile
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
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

If Not fso.FileExists(pidFile) Then WScript.Quit 0

Dim ts, txt, pid
On Error Resume Next
Set ts = fso.OpenTextFile(pidFile, 1)
txt = ts.ReadAll
ts.Close
On Error GoTo 0
pid = JsonNum(txt, "pid")

If pid > 0 Then
  Dim svc, col, p
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  Set col = svc.ExecQuery("Select * From Win32_Process Where ProcessId=" & pid)
  For Each p In col
    If LCase(p.Name) = "node.exe" Then p.Terminate
  Next
End If

On Error Resume Next
fso.DeleteFile pidFile, True
On Error GoTo 0
