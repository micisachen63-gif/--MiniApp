Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
gameRoot = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run Chr(34) & "C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" & Chr(34) & " " & Chr(34) & gameRoot & "\watchdog.mjs" & Chr(34), 0, False
