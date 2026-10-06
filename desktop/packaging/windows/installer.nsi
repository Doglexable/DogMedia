Unicode true
!ifndef STAGE
  !error "Pass -DSTAGE=/absolute/path/to/Dogmedia"
!endif
!ifndef OUT
  !error "Pass -DOUT=/absolute/path/to/setup.exe"
!endif
!ifndef VERSION
  !error "Pass -DVERSION=x.y.z"
!endif

Name "Dogmedia ${VERSION}"
OutFile "${OUT}"
InstallDir "$PROGRAMFILES64\Dogmedia"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

Section "Dogmedia" MainSection
  SetRegView 64
  SetOutPath "$INSTDIR"
  File /r "${STAGE}/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Dogmedia"
  CreateShortCut "$SMPROGRAMS\Dogmedia\Dogmedia.lnk" "$INSTDIR\Dogmedia.cmd"
  CreateShortCut "$SMPROGRAMS\Dogmedia\Uninstall Dogmedia.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dogmedia" "DisplayName" "Dogmedia"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dogmedia" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dogmedia" "Publisher" "Dogmedia"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dogmedia" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dogmedia" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dogmedia" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dogmedia" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetRegView 64
  Delete "$SMPROGRAMS\Dogmedia\Dogmedia.lnk"
  Delete "$SMPROGRAMS\Dogmedia\Uninstall Dogmedia.lnk"
  RMDir "$SMPROGRAMS\Dogmedia"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dogmedia"
  RMDir /r "$INSTDIR"
SectionEnd
