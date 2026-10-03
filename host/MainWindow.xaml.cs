using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;

namespace PdfNote;

public partial class MainWindow : Window
{
    public static readonly bool Dev = Environment.GetEnvironmentVariable("PDFNOTE_DEV") == "1" || Environment.GetCommandLineArgs().Contains("--dev");
    readonly Bridge bridge;
    WebServer server;
    bool fullscreen;
    WindowState prevState; WindowStyle prevStyle; ResizeMode prevResize; bool prevTopmost;
    static readonly string StateFile = Path.Combine(AppPaths.Data, "window.json");

    internal MainWindow(IEnumerable<string> files)
    {
        InitializeComponent();
        bridge = new Bridge(this, files);
        RestoreBounds_();
        var browserArgs = "--autoplay-policy=no-user-gesture-required --disable-features=Translate,OverscrollHistoryNavigation,msSmartScreenProtection";
        var dbgPort = Environment.GetEnvironmentVariable("PDFNOTE_DEBUG_PORT");   // CI smoke test / development only
        if (!string.IsNullOrEmpty(dbgPort) && int.TryParse(dbgPort, out _)) browserArgs += " --remote-debugging-port=" + dbgPort;
        Web.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = AppPaths.WebView2Data, AdditionalBrowserArguments = browserArgs };
        Loaded += async (s, e) => await InitWebAsync();
        Closing += OnClosing;
        Closed += (s, e) => { bridge.Shutdown(); try { Web.Dispose(); } catch { } };
    }

    // ------------------------------------------------------------------------------------------------- WebView2
    async Task InitWebAsync()
    {
        try
        {
            Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 0xF5, 0xF5, 0xF7);
            await Web.EnsureCoreWebView2Async();
            var core = Web.CoreWebView2;
            server = new WebServer(core.Environment);

            var st = core.Settings;
            st.AreDefaultContextMenusEnabled = false;
            st.AreDevToolsEnabled = Dev;
            st.AreBrowserAcceleratorKeysEnabled = Dev;   // F5 / F12 / Ctrl+R / Ctrl+P ... only in dev
            st.IsStatusBarEnabled = false;
            st.IsZoomControlEnabled = false;
            st.IsPinchZoomEnabled = false;
            st.IsSwipeNavigationEnabled = false;
            st.IsGeneralAutofillEnabled = false;
            st.IsPasswordAutosaveEnabled = false;
            st.AreDefaultScriptDialogsEnabled = true;
            st.IsWebMessageEnabled = true;

            core.AddWebResourceRequestedFilter("https://" + WebServer.AppHost + "/*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            core.AddWebResourceRequestedFilter("https://" + WebServer.FileHost + "/*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += (s, e) => server.Handle(e);

            core.WebMessageReceived += (s, e) =>
            {
                if (!IsAppSource(e.Source)) { Log.Write("message from foreign source " + e.Source); return; }
                bridge.OnMessage(e.WebMessageAsJson);
            };
            core.NavigationStarting += (s, e) =>
            {
                if (IsAppSource(e.Uri) || e.Uri.StartsWith("about:blank", StringComparison.OrdinalIgnoreCase) || (Dev && e.Uri.StartsWith("http://localhost"))) return;
                e.Cancel = true;
                OpenExternal(e.Uri);
            };
            core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.PermissionRequested += (s, e) =>
            {
                bool ours = IsAppSource(e.Uri);
                switch (e.PermissionKind)
                {
                    case CoreWebView2PermissionKind.Microphone:
                    case CoreWebView2PermissionKind.ClipboardRead:
                        e.State = ours ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny; break;
                    default: e.State = CoreWebView2PermissionState.Deny; break;
                }
                e.SavesInProfile = true;
            };
            core.DownloadStarting += OnDownloadStarting;
            core.ContainsFullScreenElementChanged += (s, e) => SetFullscreen(core.ContainsFullScreenElement);
            core.DocumentTitleChanged += (s, e) => { var t = core.DocumentTitle; Title = string.IsNullOrWhiteSpace(t) ? "PDF Note" : t; };
            core.ProcessFailed += OnProcessFailed;
            core.NavigationCompleted += (s, e) => Log.Write("navigation completed ok=" + e.IsSuccess + " status=" + e.WebErrorStatus + " url=" + core.Source);

            var devUrl = Dev ? Environment.GetEnvironmentVariable("PDFNOTE_DEV_URL") : null;
            core.Navigate(string.IsNullOrEmpty(devUrl) ? "https://" + WebServer.AppHost + "/index.html" : devUrl);
        }
        catch (Exception ex)
        {
            Log.Write("WebView2 init failed: " + ex);
            App.ShowRuntimeMissing(ex);
            Close();
        }
    }

    static bool IsAppSource(string uri) =>
        !string.IsNullOrEmpty(uri) && (uri.StartsWith(WebServer.AppOrigin + "/", StringComparison.OrdinalIgnoreCase) || uri.Equals(WebServer.AppOrigin, StringComparison.OrdinalIgnoreCase)
        || (Dev && uri.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase)));

    static void OpenExternal(string uri)
    {
        try
        {
            if (Uri.TryCreate(uri, UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https" || u.Scheme == "mailto"))
                Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception e) { Log.Write("open external failed: " + e.Message); }
    }

    void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
    {
        // http(s) links go to the system browser; blob:/data: downloads from the page get a Save dialog.
        if (Uri.TryCreate(e.DownloadOperation.Uri, UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https") && !IsAppSource(e.DownloadOperation.Uri))
        {
            e.Cancel = true; e.Handled = true; OpenExternal(e.DownloadOperation.Uri); return;
        }
        var d = new SaveFileDialog { FileName = Path.GetFileName(e.ResultFilePath), OverwritePrompt = true };
        if (d.ShowDialog(this) == true) { e.ResultFilePath = d.FileName; e.Handled = true; }
        else { e.Cancel = true; e.Handled = true; }
    }

    int crashes;
    void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
    {
        Log.Write("WebView2 process failed: " + e.ProcessFailedKind + " " + e.Reason + " " + e.ExitCode);
        if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
        {
            MessageBox.Show(this, "웹 화면 엔진(WebView2)이 종료되었습니다. 앱을 다시 시작해 주세요.", "PDF Note", MessageBoxButton.OK, MessageBoxImage.Warning);
            Close(); return;
        }
        if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
        {
            if (++crashes > 3) { Close(); return; }
            Dispatcher.BeginInvoke(() => { try { Web.CoreWebView2.Reload(); } catch { } });
        }
    }

    // ------------------------------------------------------------------------------------------------- bridge helpers (UI thread safe)
    internal void PostRaw(string json)
    {
        Dispatcher.BeginInvoke(() => { try { Web.CoreWebView2?.PostWebMessageAsJson(json); } catch (Exception e) { Log.Write("post failed: " + e.Message); } });
    }

    internal void PostEvent(string ev, object data) => PostRaw(JsonSerializer.Serialize(new { ev, d = data }));

    /// <summary>Second instance asked us to open files / come to front.</summary>
    internal void HandleExternalOpen(IEnumerable<string> files)
    {
        Dispatcher.BeginInvoke(() =>
        {
            foreach (var f in files) bridge.OpenFile(f);
            if (WindowState == WindowState.Minimized) WindowState = fullscreen ? WindowState.Maximized : WindowState.Normal;
            Show(); Activate(); var tm = Topmost; Topmost = true; Topmost = tm;
            Focus();
        });
    }

    public void SetFullscreen(bool on)
    {
        if (on == fullscreen) return;
        fullscreen = on;
        if (on)
        {
            prevState = WindowState; prevStyle = WindowStyle; prevResize = ResizeMode; prevTopmost = Topmost;
            WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
            if (WindowState == WindowState.Maximized) WindowState = WindowState.Normal;
            WindowState = WindowState.Maximized; Topmost = true;
        }
        else
        {
            Topmost = prevTopmost; WindowStyle = prevStyle; ResizeMode = prevResize;
            WindowState = WindowState.Normal; WindowState = prevState;
        }
    }

    // ------------------------------------------------------------------------------------------------- window state
    void RestoreBounds_()
    {
        try
        {
            if (!File.Exists(StateFile)) return;
            using var d = JsonDocument.Parse(File.ReadAllText(StateFile));
            var r = d.RootElement;
            double l = r.GetProperty("left").GetDouble(), t = r.GetProperty("top").GetDouble(), w = r.GetProperty("width").GetDouble(), h = r.GetProperty("height").GetDouble();
            bool max = r.TryGetProperty("max", out var m) && m.GetBoolean();
            // keep at least part of the window on a visible screen
            double vl = SystemParameters.VirtualScreenLeft, vt = SystemParameters.VirtualScreenTop, vw = SystemParameters.VirtualScreenWidth, vh = SystemParameters.VirtualScreenHeight;
            if (w < MinWidth || h < MinHeight || w > vw + 40 || h > vh + 40) return;
            if (l + w < vl + 80 || t + 60 < vt || l > vl + vw - 80 || t > vt + vh - 60) return;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = l; Top = t; Width = w; Height = h;
            if (max) WindowState = WindowState.Maximized;
        }
        catch { }
    }

    void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
    {
        try
        {
            if (fullscreen) { Topmost = prevTopmost; }
            var rb = fullscreen ? RestoreBounds : (WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds);
            if (rb.Width > 100 && rb.Height > 100)
            {
                Directory.CreateDirectory(AppPaths.Data);
                bool max = fullscreen ? prevState == WindowState.Maximized : WindowState == WindowState.Maximized;
                File.WriteAllText(StateFile, JsonSerializer.Serialize(new { left = rb.Left, top = rb.Top, width = rb.Width, height = rb.Height, max }));
            }
        }
        catch { }
    }
}
