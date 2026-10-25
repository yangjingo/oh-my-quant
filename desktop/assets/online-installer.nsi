Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
Name "WhyJ Quant ${APP_VERSION} Online Setup"
Caption "WhyJ Quant Online Setup"
OutFile "${ONLINE_OUTPUT}"
Icon "${APP_ICON}"
BrandingText "WhyJ Quant"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "WhyJ Quant Online Setup"
VIAddVersionKey /LANG=1033 "FileDescription" "Downloads and verifies the complete WhyJ Quant installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "WhyJ Quant contributors"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "StdUtils.nsh"

!define MUI_ICON "${APP_ICON}"
!define MUI_CUSTOMFUNCTION_ABORT OnlineAbort
!define MUI_WELCOMEPAGE_TITLE "WhyJ Quant Online Setup"
!define MUI_WELCOMEPAGE_TEXT "This small installer downloads the complete ${PAYLOAD_MIB} MiB package.$\r$\nInternet access is required. Electron, Bun and Python are included in the downloaded package; quantitative features stay local.$\r$\n$\r$\nAfter verification, the full installer will let you choose the app folder. Existing research data is retained.$\r$\n$\r$\n需要联网下载完整运行包。校验通过后进入安装向导；保留本地量化功能与研究数据。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function OnlineAbort
  SetErrorLevel 2
FunctionEnd

Section "Download and install"
  InitPluginsDir
  ${GetParameters} $R0
  StrCpy $R1 "$PLUGINSDIR\WhyJ-Quant-Setup.exe"
  DetailPrint "Downloading ${PAYLOAD_MIB} MiB. No installed files are changed before verification."
download:
  inetc::get /CONNECTTIMEOUT 30 /RECEIVETIMEOUT 60 /NOCOOKIES /USERAGENT "WhyJ-Quant-Online/${APP_VERSION}" "${PAYLOAD_URL}" "$R1" /END
  Pop $R2
  StrCmp $R2 "OK" verify
  StrCmp $R2 "Cancelled" cancelled
  DetailPrint "Download failed: $R2"
  IfSilent failed
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Download failed: $R2.$\r$\nCheck your connection and retry, or use the complete offline installer." IDRETRY download
  Goto failed
verify:
  FileOpen $R3 "$R1" r
  IfErrors failed
  FileSeek $R3 0 END $R4
  FileClose $R3
  StrCmp $R4 "${PAYLOAD_BYTES}" +3
  StrCpy $R2 "Downloaded size does not match this release."
  Goto invalid
  ${StdUtils.HashFile} $R3 "SHA2-512" "$R1"
  StrCmp $R3 "${PAYLOAD_SHA512}" verified
  StrCpy $R2 "Downloaded SHA-512 does not match this release."
invalid:
  DetailPrint "$R2 Installation was not started."
  IfSilent failed
  MessageBox MB_OK|MB_ICONSTOP "$R2$\r$\nInstallation was not started. Retry or download the complete offline installer."
  Goto failed
verified:
  DetailPrint "Verified. Starting the complete installer."
  HideWindow
  ClearErrors
  ExecWait '"$R1" $R0' $R2
  IfErrors failed
  Delete "$R1"
  SetErrorLevel $R2
  Quit
cancelled:
  DetailPrint "Download cancelled. Installation was not started."
failed:
  Delete "$R1"
  SetErrorLevel 2
  Quit
SectionEnd
