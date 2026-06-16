!macro customInit
  # If this is an update (--updated flag), DON'T wipe appdata or kill forcefully
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  IfErrors +2 proceed
  
  # Skip kill + wipe for updates — user keeps their data
  Goto done

proceed:
  # Terminate any running instances of Synced to prevent file lock issues
  nsExec::ExecToStack 'cmd.exe /c taskkill /F /IM Synced.exe /T'
  
  # Wipe app configuration data during installer initialization to force setup onboarding
  RMDir /r "$APPDATA\synced"

done:
!macroend

!macro customUnInit
  # Terminate any running instances of Synced before uninstallation starts
  nsExec::ExecToStack 'cmd.exe /c taskkill /F /IM Synced.exe /T'
  
  # Wipe app configuration data during uninstallation to force setup onboarding on reinstall
  RMDir /r "$APPDATA\synced"

  # Remove firewall rules
  nsExec::Exec 'cmd.exe /c netsh advfirewall firewall delete rule name="Synced API Service"'
  nsExec::Exec 'cmd.exe /c netsh advfirewall firewall delete rule name="Synced Bridge Service"'
!macroend

!macro customInstall
  # Add firewall rules for Synced API (9876) and Bridge (8765)
  nsExec::Exec 'cmd.exe /c netsh advfirewall firewall delete rule name="Synced API Service"'
  nsExec::Exec 'cmd.exe /c netsh advfirewall firewall add rule name="Synced API Service" dir=in action=allow protocol=TCP localport=9876 profile=private,domain'
  nsExec::Exec 'cmd.exe /c netsh advfirewall firewall delete rule name="Synced Bridge Service"'
  nsExec::Exec 'cmd.exe /c netsh advfirewall firewall add rule name="Synced Bridge Service" dir=in action=allow protocol=TCP localport=8765 profile=private,domain'
!macroend
