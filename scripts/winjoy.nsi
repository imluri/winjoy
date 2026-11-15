Unicode true
Name "WinJoy"
OutFile "${WINJOY_OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\WinJoy"
RequestExecutionLevel user
SetCompressor zlib

VIProductVersion "${WINJOY_FILE_VERSION}"
VIAddVersionKey "FileDescription" "WinJoy Setup"
VIAddVersionKey "FileVersion" "${WINJOY_VERSION}"
VIAddVersionKey "ProductName" "WinJoy"
VIAddVersionKey "ProductVersion" "${WINJOY_VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (c) WinJoy contributors"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\WinJoy"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\WinJoy.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext current
  ${IfNot} ${AtLeastWin10}
  ${OrIfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "WinJoy requires 64-bit Windows 10 or later." /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
  Call WaitForWinJoy
FunctionEnd

Function WaitForWinJoy
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} "$0" "/WAITPID=" $1
  ${If} ${Errors}
    Return
  ${EndIf}
  ${If} $1 > 0
    System::Call 'kernel32::OpenProcess(i 0x00100000, i 0, i r1) p .r2 ?e'
    Pop $3
    ${If} $2 = 0
      ; ERROR_INVALID_PARAMETER means the WinJoy process already exited.
      ${If} $3 = 87
        Return
      ${EndIf}
    ${Else}
      System::Call 'kernel32::WaitForSingleObject(p r2, i 45000) i .r3'
      System::Call 'kernel32::CloseHandle(p r2)'
      ${If} $3 = 0
        Return
      ${EndIf}
    ${EndIf}
  ${EndIf}
  MessageBox MB_OK|MB_ICONSTOP "WinJoy could not close for the update. Close it and run the downloaded installer again." /SD IDOK
  SetErrorLevel 1
  Quit
FunctionEnd

Section "WinJoy"
  SetOutPath "$INSTDIR"
  File /r "${WINJOY_PAYLOAD}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\WinJoy.lnk" "$INSTDIR\WinJoy.exe"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "WinJoy"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${WINJOY_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\WinJoy.exe,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${WINJOY_KIB}
SectionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

Section "Uninstall"
  SetOutPath "$TEMP"
  Delete "$SMPROGRAMS\WinJoy.lnk"
  !include "${WINJOY_UNINSTALL}"
  Delete "$INSTDIR\Uninstall.exe"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  RMDir "$INSTDIR"
SectionEnd
