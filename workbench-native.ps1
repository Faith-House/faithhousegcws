param([string]$Payload)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
function Emit($data){$data | ConvertTo-Json -Depth 6 -Compress}
if($p.action -eq 'list_apps'){
 $shell=New-Object -ComObject Shell.Application
 $apps=@($shell.Namespace('shell:AppsFolder').Items() | ForEach-Object {
  $id=[string]$_.ExtendedProperty('System.AppUserModel.ID');$target=[string]$_.ExtendedProperty('System.Link.TargetParsingPath')
  if($id -eq 'Microsoft.Windows.Explorer'){$target=[IO.Path]::Combine($env:WINDIR,'explorer.exe')}
  if($id -and ($id.Contains('!') -or ($target -match '(?i)\.exe$' -and (Test-Path -LiteralPath $target -PathType Leaf)))){ @{name=[string]$_.Name;id=$id;target=$target} }
 } | Sort-Object { $_.name })
 Emit @{outcome='confirmed';apps=$apps};exit
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class JarvisWindow {
 public long handle; public int pid; public string app; public string title; public string appId; public string path;
}
public class JarvisDesktop {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,int data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from,uint to,bool attach);
 [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] struct Message {public IntPtr h;public uint message;public UIntPtr w;public IntPtr l;public uint time;public Point point;public uint extra;}
 [DllImport("user32.dll")] static extern bool PeekMessage(out Message m,IntPtr h,uint min,uint max,uint remove);
 [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr h);
 delegate bool EnumWindowProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowProc callback,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumWindowProc callback,IntPtr p);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder title,int count);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder name,int count);
 [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr h,ref uint size,StringBuilder appId);
 static string AppId(uint pid) {
  IntPtr h=OpenProcess(0x1000,false,pid);if(h==IntPtr.Zero)return "";
  try { uint size=0;GetApplicationUserModelId(h,ref size,null);if(size==0||size>2048)return "";var id=new StringBuilder((int)size);return GetApplicationUserModelId(h,ref size,id)==0?id.ToString():""; } finally {CloseHandle(h);}
 }
 public static JarvisWindow[] Windows() {
  var windows=new List<JarvisWindow>();
  EnumWindows(delegate(IntPtr h,IntPtr unused) {
   if(!IsWindowVisible(h))return true;
   var title=new StringBuilder(1024);GetWindowText(h,title,title.Capacity);if(title.Length==0)return true;
   var cls=new StringBuilder(256);GetClassName(h,cls,cls.Capacity);
   if(cls.ToString()=="Progman"||cls.ToString()=="WorkerW"||cls.ToString().StartsWith("Shell_"))return true;
   uint pid;GetWindowThreadProcessId(h,out pid);
   try {var process=Process.GetProcessById((int)pid);string file="";try{file=process.MainModule.FileName;}catch{}
    string id=AppId(pid);
    if(process.ProcessName=="ApplicationFrameHost"&&id=="") EnumChildWindows(h,delegate(IntPtr child,IntPtr p){uint childPid;GetWindowThreadProcessId(child,out childPid);var childId=AppId(childPid);if(childId!="")id=childId;return id=="";},IntPtr.Zero);
    windows.Add(new JarvisWindow{handle=h.ToInt64(),pid=(int)pid,app=process.ProcessName,title=title.ToString(),appId=id,path=file});
   } catch {}return true;
  },IntPtr.Zero);return windows.ToArray();
 }
 public static bool Focus(long handle) {
  var h=new IntPtr(handle);if(IsIconic(h))ShowWindow(h,9);else ShowWindow(h,5);
  SetForegroundWindow(h);
  if(GetForegroundWindow()!=h) {
   Message message;PeekMessage(out message,IntPtr.Zero,0,0,0);
   uint unused;uint foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),out unused),targetThread=GetWindowThreadProcessId(h,out unused),currentThread=GetCurrentThreadId();
   // A voice-triggered background helper has no last-input privilege. Share focus state
   // only for this explicit activation, then detach immediately; never inject an Alt key.
   bool attached=foregroundThread!=0&&foregroundThread!=currentThread&&AttachThreadInput(currentThread,foregroundThread,true);
   bool targetAttached=targetThread!=0&&targetThread!=currentThread&&targetThread!=foregroundThread&&AttachThreadInput(currentThread,targetThread,true);
   try {if(attached||targetAttached){BringWindowToTop(h);SetForegroundWindow(h);SetActiveWindow(h);SetFocus(h);}}
   finally {if(targetAttached)AttachThreadInput(currentThread,targetThread,false);if(attached)AttachThreadInput(currentThread,foregroundThread,false);}
  }
  for(int i=0;i<8;i++){if(GetForegroundWindow()==h)return true;System.Threading.Thread.Sleep(75);}
  return false;
 }
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
function App-Window($app) {
 return @([JarvisDesktop]::Windows() | Where-Object { ($_.appId -and $_.appId -eq $app.appId) -or ($app.targetPath -and $_.path -and $_.path -eq $app.targetPath) }) | Select-Object -First 1
}
function Focus-Window($window) {
 return [JarvisDesktop]::Focus($window.handle)
}
if($p.action -eq 'get_audio'){
 $value=[JarvisAudio]::Read();$muted=[JarvisAudio]::IsMuted();Emit @{outcome='confirmed';summary="Computer volume reads $value percent. Muted: $muted.";percent=$value;muted=$muted};exit
}
if($p.action -eq 'list_windows'){
 $windows=@([JarvisDesktop]::Windows() | ForEach-Object { @{pid=$_.pid;app=$_.app;title=$_.title;foreground=([JarvisDesktop]::GetForegroundWindow().ToInt64() -eq $_.handle)} })
 Emit @{outcome='confirmed';summary='Read the open windows.';windows=$windows};exit
}
if($p.action -eq 'open_app'){
 $found=App-Window $p;$reused=[bool]$found
 $deadline=[DateTime]::UtcNow.AddSeconds(8)
 if(!$found){
  $shell=New-Object -ComObject Shell.Application
  $item=$shell.Namespace('shell:AppsFolder').ParseName([string]$p.appId)
  if(!$item){throw 'That app is no longer in the Windows app list.'}
  $item.InvokeVerb('open')
  do {Start-Sleep -Milliseconds 200;$found=App-Window $p} while(!$found -and [DateTime]::UtcNow -lt $deadline)
 }
 if(!$found){Emit @{outcome='unverified';foreground=$false;app=$p.appName;summary="Windows accepted the request for $($p.appName), but no visible app window was confirmed."};exit}
 $focused=Focus-Window $found
 # Packaged apps can replace their splash window with an ApplicationFrameHost window.
 while(!$focused -and [DateTime]::UtcNow -lt $deadline){
  Start-Sleep -Milliseconds 200;$current=App-Window $p
  if($current){$found=$current;$focused=Focus-Window $found}
 }
 if($focused){$verb=if($reused){'Switched to'}else{'Opened'};$summary="$verb $($p.appName). Its window is in front.";$outcome='confirmed'}else{$summary="$($p.appName) is open, but Windows did not bring its window to the front.";$outcome='unverified'}
 Emit @{outcome=$outcome;summary=$summary;foreground=$focused;app=$p.appName;pid=$found.pid;title=$found.title;reused=$reused};exit
}
if($p.action -eq 'focus_browser'){
 $processes=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'")
 $ids=New-Object 'System.Collections.Generic.HashSet[int]'
 foreach($proc in $processes){
  $matched=[regex]::Match([string]$proc.CommandLine,'(?i)(?:"--user-data-dir=([^"]+)"|--user-data-dir(?:=|\s+)(?:"([^"]+)"|([^\s"]+)))')
  if(!$matched.Success){continue}
  $folder=@($matched.Groups | Select-Object -Skip 1 | Where-Object Success | Select-Object -First 1).Value
  try {if([IO.Path]::GetFullPath($folder).TrimEnd('\') -eq [IO.Path]::GetFullPath([string]$p.profileDirectory).TrimEnd('\')){$null=$ids.Add([int]$proc.ProcessId)}}catch{}
 }
 do {$changed=$false;foreach($proc in $processes){if($ids.Contains([int]$proc.ParentProcessId) -and $ids.Add([int]$proc.ProcessId)){$changed=$true}}} while($changed)
 $found=@([JarvisDesktop]::Windows() | Where-Object { $ids.Contains($_.pid) }) | Select-Object -First 1
 if(!$found){Emit @{outcome='unverified';foreground=$false;summary='The managed browser window could not be identified. No other browser window was focused.'};exit}
 $focused=Focus-Window $found
 Emit @{outcome=$(if($focused){'confirmed'}else{'unverified'});foreground=$focused;pid=$found.pid;summary=$(if($focused){'The managed browser window is in front.'}else{'Windows did not bring the managed browser window to the front.'})};exit
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
