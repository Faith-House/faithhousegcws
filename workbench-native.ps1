param([string]$Payload)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class JarvisDesktop {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,int data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
}
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class JEnumerator {}
[ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface JEnum {
 [PreserveSig] int EnumAudioEndpoints(int f,int s,out IntPtr c); [PreserveSig] int GetDefaultAudioEndpoint(int f,int role,out JDevice d);
}
[ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface JDevice { [PreserveSig] int Activate(ref Guid iid,int ctx,IntPtr param,[MarshalAs(UnmanagedType.IUnknown)]out object obj); }
[ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface JVolume {
 [PreserveSig] int RegisterControlChangeNotify(IntPtr p);[PreserveSig] int UnregisterControlChangeNotify(IntPtr p);[PreserveSig] int GetChannelCount(out uint c);
 [PreserveSig] int SetMasterVolumeLevel(float l,ref Guid g);[PreserveSig] int SetMasterVolumeLevelScalar(float l,ref Guid g);[PreserveSig] int GetMasterVolumeLevel(out float l);[PreserveSig] int GetMasterVolumeLevelScalar(out float l);
 [PreserveSig] int SetChannelVolumeLevel(uint c,float l,ref Guid g);[PreserveSig] int SetChannelVolumeLevelScalar(uint c,float l,ref Guid g);[PreserveSig] int GetChannelVolumeLevel(uint c,out float l);[PreserveSig] int GetChannelVolumeLevelScalar(uint c,out float l);
 [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)]bool m,ref Guid g);[PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)]out bool m);
}
public class JarvisAudio {
 public static int Read(){float v;Marshal.ThrowExceptionForHR(Device().GetMasterVolumeLevelScalar(out v));return (int)Math.Round(v*100);}
 public static bool IsMuted(){bool m;Marshal.ThrowExceptionForHR(Device().GetMute(out m));return m;}
 static JVolume Device(){JDevice d;Marshal.ThrowExceptionForHR(((JEnum)new JEnumerator()).GetDefaultAudioEndpoint(0,1,out d));object o;Guid id=typeof(JVolume).GUID;Marshal.ThrowExceptionForHR(d.Activate(ref id,23,IntPtr.Zero,out o));return (JVolume)o;}
 public static int Set(int percent){var d=Device();Guid g=Guid.Empty;Marshal.ThrowExceptionForHR(d.SetMasterVolumeLevelScalar(percent/100f,ref g));if(percent>0)Marshal.ThrowExceptionForHR(d.SetMute(false,ref g));float v;Marshal.ThrowExceptionForHR(d.GetMasterVolumeLevelScalar(out v));return (int)Math.Round(v*100);}
 public static bool Mute(bool muted){var d=Device();Guid g=Guid.Empty;Marshal.ThrowExceptionForHR(d.SetMute(muted,ref g));bool m;Marshal.ThrowExceptionForHR(d.GetMute(out m));return m;}
}
'@
function Emit($data){$data | ConvertTo-Json -Depth 6 -Compress}
if($p.action -eq 'get_audio'){
 $value=[JarvisAudio]::Read();$muted=[JarvisAudio]::IsMuted();Emit @{outcome='confirmed';summary="Computer volume reads $value percent. Muted: $muted.";percent=$value;muted=$muted};exit
}
if($p.action -eq 'list_windows'){
 $windows=@(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { @{pid=$_.Id;app=$_.ProcessName;title=$_.MainWindowTitle} })
 Emit @{outcome='confirmed';summary='Read the open windows.';windows=$windows};exit
}
if($p.action -eq 'open_app'){
 $before=@(Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
 $launched=Start-Process -FilePath $p.app -PassThru -WindowStyle Normal
 Start-Sleep -Milliseconds 800
 $found=Get-Process -Id $launched.Id -ErrorAction SilentlyContinue
 if($found){Emit @{outcome='confirmed';summary='The requested application process is running.';pid=$found.Id}}else{Emit @{outcome='unverified';summary='Windows accepted the launch request; the application process was not confirmed.'}};exit
}
if($p.action -eq 'screenshot'){
 $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
 $bitmap=New-Object Drawing.Bitmap $bounds.Width,$bounds.Height
 $graphics=[Drawing.Graphics]::FromImage($bitmap)
 try{$graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bitmap.Size);$stream=New-Object IO.MemoryStream;$bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Jpeg);Emit @{outcome='confirmed';summary='Captured the desktop.';imageBase64=[Convert]::ToBase64String($stream.ToArray());mime='image/jpeg'}}finally{$graphics.Dispose();$bitmap.Dispose()};exit
}
if($p.action -in @('volume','mute')){
 if($p.action -eq 'volume'){$value=[JarvisAudio]::Set([int]$p.percent);Emit @{outcome='confirmed';summary="Volume reads $value percent.";percent=$value}}else{$value=[JarvisAudio]::Mute([bool]$p.muted);Emit @{outcome='confirmed';summary="Mute state reads $value.";muted=$value}};exit
}
if($p.action -eq 'brightness'){
 $method=Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
 if(!$method){throw 'This display does not expose brightness control.'}
 $null=Invoke-CimMethod -InputObject $method -MethodName WmiSetBrightness -Arguments @{Timeout=[uint32]1;Brightness=[byte]$p.percent}
 $value=(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness
 Emit @{outcome='confirmed';summary="Display brightness reads $value percent.";percent=$value};exit
}
if($p.action -in @('shutdown','restart','cancel_shutdown')){
 if($p.action -eq 'cancel_shutdown'){$null=& shutdown.exe /a}else{$mode=if($p.action -eq 'shutdown'){'/s'}else{'/r'};$null=& shutdown.exe $mode /t 60}
 if($LASTEXITCODE -ne 0){throw 'Windows rejected the power request.'}
 Emit @{outcome='unverified';summary='Windows accepted the power request. A scheduled shutdown/restart has a 60-second delay and can be cancelled.'};exit
}
$target=Get-Process -Id ([int]$p.pid) -ErrorAction Stop
if($target.Id -eq $p.protectedPid -or $target.ProcessName -match '^(node|ollama|powershell|pwsh|codex|ChatGPT|System|winlogon|csrss|services|lsass)$'){throw 'This process is protected from desktop automation.'}
if($target.MainWindowHandle -eq 0){throw 'That process has no interactive window.'}
if($p.action -eq 'close_app'){
 $accepted=$target.CloseMainWindow();Start-Sleep -Milliseconds 700
 if(!(Get-Process -Id $target.Id -ErrorAction SilentlyContinue)){Emit @{outcome='confirmed';summary='The application process exited.'}}else{Emit @{outcome='unverified';summary='The application was asked to close but is still running. It may need you to save changes.'}};exit
}
$null=[JarvisDesktop]::ShowWindow($target.MainWindowHandle,9)
$null=[JarvisDesktop]::SetForegroundWindow($target.MainWindowHandle)
Start-Sleep -Milliseconds 150
if([JarvisDesktop]::GetForegroundWindow() -ne $target.MainWindowHandle){throw 'Windows did not focus the chosen window. No input was sent.'}
if($p.action -eq 'focus'){Emit @{outcome='confirmed';summary='The chosen window is in the foreground.'};exit}
switch($p.action){
 'type' {$escaped=[regex]::Replace([string]$p.text,'([+^%~(){}\[\]])','{$1}');[Windows.Forms.SendKeys]::SendWait($escaped)}
 'hotkey' {$keys=@{copy='^c';paste='^v';select_all='^a';enter='{ENTER}';escape='{ESC}';tab='{TAB}';save='^s';undo='^z';find='^f';next_tab='^{TAB}';previous_tab='^+{TAB}'};[Windows.Forms.SendKeys]::SendWait($keys[$p.key])}
 'click' {$rect=[System.Windows.Forms.SystemInformation]::VirtualScreen;if(!$rect.Contains([int]$p.x,[int]$p.y)){throw 'The click point is outside the screen.'};$point=New-Object JarvisDesktop+Point;$point.X=[int]$p.x;$point.Y=[int]$p.y;$under=[JarvisDesktop]::WindowFromPoint($point);[uint32]$underPid=0;$null=[JarvisDesktop]::GetWindowThreadProcessId($under,[ref]$underPid);if($underPid -ne $target.Id){throw 'The click point belongs to another application. No click was sent.'};$null=[JarvisDesktop]::SetCursorPos([int]$p.x,[int]$p.y);[JarvisDesktop]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[JarvisDesktop]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
 'scroll' {[JarvisDesktop]::mouse_event(2048,0,0,([int]$p.amount*120),[UIntPtr]::Zero)}
 default {throw 'Unsupported desktop action.'}
}
Emit @{outcome='unverified';summary='Input was sent to the chosen foreground window. The resulting application state was not independently confirmed.'}
