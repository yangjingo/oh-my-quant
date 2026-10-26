; Keep the assisted installer per-user, even when the user is an administrator.
; electron-builder otherwise offers an all-users installation mode.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; This replaces only the directory-page explanation. NSIS retains its target
; editor, Browse button, disk-space display and existing InstallLocation lookup.
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择程序安装目录 / Choose an app folder.$\r$\n研究数据仍保存在 / Research data stays in:$\r$\n%APPDATA%\WhyJ Quant\workspace\.ohquant"
