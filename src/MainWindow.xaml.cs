using System.IO;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace PdfNote;

public class TabVm : INotifyPropertyChanged
{
    string _title;
    public string Title { get => _title; set { _title = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Title))); } }
    public bool IsHome { get; set; }
    public string Path { get; set; }
    public UserControl View { get; set; }
    public event PropertyChangedEventHandler PropertyChanged;
}

public partial class MainWindow : Window
{
    [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
    const uint ES_CONTINUOUS = 0x80000000, ES_DISPLAY_REQUIRED = 0x00000002, ES_SYSTEM_REQUIRED = 0x00000001;

    static void ApplyKeepAwake()
    {
        try
        {
            SetThreadExecutionState(Store.Settings.KeepAwake
                ? ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
                : ES_CONTINUOUS);
        }
        catch { }
    }

    readonly ObservableCollection<TabVm> _tabs = new();
    readonly HomeView _home = new();
    readonly TabVm _homeTab;
    TabVm _current;
    bool _fullscreen;
    WindowState _prevState;
    WindowStyle _prevStyle;

    public MainWindow(string[] args)
    {
        InitializeComponent();
        Tabs.ItemsSource = _tabs;
        _homeTab = new TabVm { Title = "🏠 홈", IsHome = true, View = _home };
        _tabs.Add(_homeTab);
        _home.OpenRequested += p => _ = OpenPathAsync(p);
        _home.OpenDialogRequested += OpenDialog;
        _home.NewNoteRequested += NewNote;
        Tabs.SelectedIndex = 0;
        ApplyKeepAwake();

        Loaded += async (s, e) =>
        {
            foreach (var a in args)
                if (File.Exists(a)) await OpenPathAsync(a);
        };
    }

    DocumentView CurrentDoc => _current?.View as DocumentView;

    // ------------------------------------------------------------------ tabs

    void Tabs_SelectionChanged(object s, SelectionChangedEventArgs e)
    {
        if (Tabs.SelectedItem is not TabVm vm) return;
        if (_current != null && _current != vm && _current.View is DocumentView old) old.Suspend();
        _current = vm;
        ContentHost.Content = vm.View;
        if (vm.IsHome) _home.Refresh();
        else if (vm.View is DocumentView dv) dv.Resume();
        Title = vm.IsHome ? "PDF Note" : vm.Title + " — PDF Note";
    }

    void TabClose_Click(object s, RoutedEventArgs e)
    {
        if (((FrameworkElement)s).DataContext is TabVm vm) CloseTab(vm);
        e.Handled = true;
    }

    async void CloseTab(TabVm vm)
    {
        if (vm.IsHome) return;
        if (vm.View is DocumentView dv)
        {
            try { await dv.StopRecordingAsync(); } catch { }
            dv.SaveNow();
            dv.Suspend();
            dv.Source?.Dispose();
        }
        int idx = _tabs.IndexOf(vm);
        bool wasCurrent = vm == _current;
        _tabs.Remove(vm);
        if (wasCurrent)
        {
            _current = null;
            Tabs.SelectedIndex = Math.Clamp(idx - 1, 0, _tabs.Count - 1);
        }
    }

    // ------------------------------------------------------------------ open

    async Task OpenPathAsync(string path)
    {
        try
        {
            var existing = _tabs.FirstOrDefault(t => string.Equals(t.Path, path, StringComparison.OrdinalIgnoreCase));
            if (existing != null) { Tabs.SelectedItem = existing; return; }

            BusyText.Visibility = Visibility.Visible;
            IPageSource src;
            bool isNote = path.EndsWith(".pnote", StringComparison.OrdinalIgnoreCase);
            try
            {
                src = isNote ? NotebookSource.Open(path) : await PdfPageSource.OpenAsync(path);
            }
            catch (Exception ex)
            {
                Store.Log("open: " + ex);
                MessageBox.Show(this, "파일을 열 수 없습니다.\n암호가 걸렸거나 손상된 PDF일 수 있습니다.\n\n" + ex.Message,
                    "PDF Note", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var dv = new DocumentView();
            var vm = new TabVm { Title = src.Title, Path = path, View = dv };
            _tabs.Add(vm);
            Tabs.SelectedItem = vm;
            Store.AddRecent(path, src.Title, isNote);
            await dv.InitAsync(src);
        }
        finally { BusyText.Visibility = Visibility.Collapsed; }
    }

    void OpenDialog()
    {
        var dlg = new OpenFileDialog
        {
            Filter = "PDF 및 노트|*.pdf;*.pnote|PDF|*.pdf|노트|*.pnote",
            Multiselect = true
        };
        if (dlg.ShowDialog(this) != true) return;
        foreach (var f in dlg.FileNames) _ = OpenPathAsync(f);
    }

    void NewNote()
    {
        var meta = Dialogs.NewNote(this);
        if (meta == null) return;
        try
        {
            var nb = NotebookSource.Create(_home.CurrentFolder, meta);
            nb.Dispose();
            _ = OpenPathAsync(nb.FilePath);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "노트를 만들 수 없습니다.\n" + ex.Message, "PDF Note", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    void Open_Click(object s, RoutedEventArgs e) => OpenDialog();
    void NewNote_Click(object s, RoutedEventArgs e) => NewNote();

    void Window_Drop(object s, DragEventArgs e)
    {
        if (!e.Data.GetDataPresent(DataFormats.FileDrop)) return;
        foreach (var f in (string[])e.Data.GetData(DataFormats.FileDrop))
        {
            var ext = System.IO.Path.GetExtension(f).ToLowerInvariant();
            if (ext == ".pdf" || ext == ".pnote") _ = OpenPathAsync(f);
            else if (CurrentDoc != null && ext is ".png" or ".jpg" or ".jpeg" or ".bmp" or ".gif" or ".webp" or ".tif" or ".tiff")
                CurrentDoc.InsertImageFile(f);
        }
    }

    // ------------------------------------------------------------------ keys

    void Window_PreviewKeyDown(object s, KeyEventArgs e)
    {
        bool ctrl = Keyboard.Modifiers.HasFlag(ModifierKeys.Control);
        if (ctrl && e.Key == Key.O) { OpenDialog(); e.Handled = true; return; }
        if (ctrl && e.Key == Key.N) { NewNote(); e.Handled = true; return; }
        if (ctrl && e.Key == Key.W) { if (_current != null) CloseTab(_current); e.Handled = true; return; }
        if (ctrl && e.Key == Key.Tab)
        {
            Tabs.SelectedIndex = (Tabs.SelectedIndex + 1) % _tabs.Count;
            e.Handled = true; return;
        }
        if (e.Key == Key.F11) { ToggleFullscreen(); e.Handled = true; return; }
        if (CurrentDoc != null && CurrentDoc.HandleKey(e)) e.Handled = true;
    }

    void ToggleFullscreen()
    {
        _fullscreen = !_fullscreen;
        if (_fullscreen)
        {
            _prevState = WindowState; _prevStyle = WindowStyle;
            WindowStyle = WindowStyle.None;
            WindowState = WindowState.Maximized;
        }
        else
        {
            WindowStyle = _prevStyle;
            WindowState = _prevState;
        }
        TabBar.Visibility = _fullscreen ? Visibility.Collapsed : Visibility.Visible;
        CurrentDoc?.SetChromeVisible(!_fullscreen);
    }

    // ------------------------------------------------------------------ menu

    void MenuBtn_Click(object s, RoutedEventArgs e)
    {
        var menu = new ContextMenu();
        var dv = CurrentDoc;

        MenuItem Add(ItemsControl parent, string header, Action act, bool enabled = true)
        {
            var mi = new MenuItem { Header = header, IsEnabled = enabled };
            mi.Click += (a, b) => { try { act(); } catch (Exception ex) { MessageBox.Show(this, ex.Message, "PDF Note"); } };
            parent.Items.Add(mi);
            return mi;
        }

        Add(menu, "주석 백업 저장…", () => dv.BackupAnnotations(), dv != null);
        Add(menu, "주석 백업 복원…", () => dv.RestoreAnnotations(), dv != null);
        menu.Items.Add(new Separator());
        Add(menu, "PDF로 내보내기 (필기·하이라이트·메모 포함)…", async () => await dv.ExportPdfAsync(), dv != null);
        var exp = new MenuItem { Header = "노트·발췌 내보내기", IsEnabled = dv != null };
        Add(exp, "Markdown…", () => dv.ExportMarkdown());
        Add(exp, "CSV…", () => dv.ExportCsv());
        Add(exp, "Anki (TSV)…", () => dv.ExportAnki());
        menu.Items.Add(exp);
        menu.Items.Add(new Separator());

        var low = new MenuItem { Header = "절약 모드 (저사양 PC용)", IsCheckable = true, IsChecked = Store.Settings.LowSpec };
        low.Click += (a, b) =>
        {
            Store.Settings.LowSpec = low.IsChecked;
            Store.SaveSettings();
        };
        menu.Items.Add(low);

        void ViewChanged()
        {
            Store.SaveSettings();
            foreach (var t in _tabs) (t.View as DocumentView)?.ApplyViewSettings();
        }
        var trim = new MenuItem { Header = "여백 자동 자르기 (PDF)", IsCheckable = true, IsChecked = Store.Settings.TrimMargins };
        trim.Click += (a, b) => { Store.Settings.TrimMargins = trim.IsChecked; ViewChanged(); };
        menu.Items.Add(trim);

        var fx = new MenuItem { Header = "페이지 넘김 효과" };
        foreach (var (key, name) in new[] { ("slide", "슬라이드"), ("none", "없음") })
        {
            var k = key;
            var mi = new MenuItem { Header = name, IsCheckable = true, IsChecked = Store.Settings.PageEffect == k };
            mi.Click += (a, b) => { Store.Settings.PageEffect = k; Store.SaveSettings(); };
            fx.Items.Add(mi);
        }
        menu.Items.Add(fx);

        var awake = new MenuItem { Header = "화면 켜 둠", IsCheckable = true, IsChecked = Store.Settings.KeepAwake };
        awake.Click += (a, b) => { Store.Settings.KeepAwake = awake.IsChecked; Store.SaveSettings(); ApplyKeepAwake(); };
        menu.Items.Add(awake);

        var lang = new MenuItem { Header = "번역 언어" };
        foreach (var (code, name) in new[] { ("ko", "한국어"), ("en", "English"), ("ja", "日本語"), ("zh-CN", "中文(简体)") })
        {
            var c = code;
            var mi = new MenuItem { Header = name, IsCheckable = true, IsChecked = Store.Settings.TranslateTarget == c };
            mi.Click += (a, b) => { Store.Settings.TranslateTarget = c; Store.SaveSettings(); };
            lang.Items.Add(mi);
        }
        menu.Items.Add(lang);

        var voice = new MenuItem { Header = "읽어주기 음성" };
        var auto = new MenuItem { Header = "자동 (언어 감지)", IsCheckable = true, IsChecked = string.IsNullOrEmpty(Store.Settings.Voice) };
        auto.Click += (a, b) => { Store.Settings.Voice = ""; Store.SaveSettings(); };
        voice.Items.Add(auto);
        foreach (var v in Tts.Voices())
        {
            var name = v;
            var mi = new MenuItem { Header = name, IsCheckable = true, IsChecked = Store.Settings.Voice == name };
            mi.Click += (a, b) => { Store.Settings.Voice = name; Store.SaveSettings(); };
            voice.Items.Add(mi);
        }
        menu.Items.Add(voice);
        menu.Items.Add(new Separator());
        Add(menu, "전체 화면 (F11)", ToggleFullscreen);
        Add(menu, "문서함 폴더 열기", () => Process.Start(new ProcessStartInfo(Store.LibraryDir) { UseShellExecute = true }));
        Add(menu, "정보", () => MessageBox.Show(this,
            "PDF Note for Windows 1.0.0\n\nAndroid용 PDF Note(v1.26.0 기능 기준)의 Windows 버전입니다.\n" +
            "PDF·주석은 모두 이 PC에서만 처리·저장됩니다.\n\n주석 저장 위치:\n" + Store.Root,
            "PDF Note", MessageBoxButton.OK, MessageBoxImage.Information));

        menu.PlacementTarget = (UIElement)s;
        menu.Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom;
        menu.IsOpen = true;
    }

    // ------------------------------------------------------------------ closing

    bool _closingRec;

    async void Window_Closing(object s, CancelEventArgs e)
    {
        if (!_closingRec && _tabs.Any(t => t.View is DocumentView d && d.IsRecording))
        {
            e.Cancel = true;
            _closingRec = true;
            foreach (var t in _tabs.ToList())
                if (t.View is DocumentView d) { try { await d.StopRecordingAsync(); } catch { } }
            Close();
            return;
        }
        foreach (var t in _tabs)
            if (t.View is DocumentView dv) dv.SaveNow();
        Store.SaveSettings();
    }
}
