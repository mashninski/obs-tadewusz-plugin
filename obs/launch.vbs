' Запуск ядра Tadewusz без акна. Выклікаецца з tadewusz.lua пры адкрыцці OBS: launch.vbs <PID OBS>
' Ядро само завершыцца, калі OBS закрыецца (схавае ўзнагароды і зробіць рэзервовую копію).
Option Explicit
Dim shell, fso, app, node, pid
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
pid = WScript.Arguments(0)
If Not IsNumeric(pid) Then WScript.Quit 2
app = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
node = app & "\node.exe"
If Not fso.FileExists(node) Then node = "node"
shell.Run """" & node & """ """ & app & "\core\main.js"" --obs-pid " & pid, 0, False
