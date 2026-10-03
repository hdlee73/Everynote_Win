using System.IO;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Ink;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Media.Animation;
using System.Windows.Data;
using System.Windows.Threading;
using Microsoft.Win32;
using Shapes = System.Windows.Shapes;

namespace PdfNote;

public enum ToolMode { Read, Pen, Highlighter, Eraser, Lasso, TextSelect, Typing, Memo, Outline, Capture }

public partial class DocumentView : UserControl
{
    // ---- document state ----
    IPageSource _src;
    DocAnnotations _ann = new();
    int _page = -1;
    double _zoom = 1.0;
    double _baseW = 794, _baseH = 1123;
    int _lastPx = 1000;

    // ---- tools ----
    ToolMode _mode = ToolMode.Read;
    ToolMode? _applied;
    bool _ready;
    bool _uiUpdating;
    System.Windows.Media.Color _penColor = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#111111");
    string _hlColorHex = "#FFEB3B";
    double _penW = 2.5, _hlW = 16;
    static readonly string[] PenColors = { "#111111", "#E53935", "#1E88E5", "#43A047", "#8E24AA" };
    static readonly string[] HlColors = { "#FFEB3B", "#8BC34A", "#F48FB1", "#4FC3F7", "#FFB74D" };

    // ---- rendering ----
    readonly DispatcherTimer _renderTimer = new() { Interval = TimeSpan.FromMilliseconds(140) };
    readonly DispatcherTimer _saveTimer = new() { Interval = TimeSpan.FromSeconds(3) };
    int _renderToken;
    readonly Dictionary<(int, int), BitmapSource> _cache = new();
    readonly List<(int, int)> _cacheOrder = new();
    DateTime _lastFlip = DateTime.MinValue;
    DispatcherTimer _statusTimer;

    // ---- ink / undo ----
    class InkAction
    {
        public StrokeCollection Added, Removed;
    }
    class UndoState
    {
        public List<InkAction> Undo = new();
        public List<InkAction> Redo = new();
    }
    readonly Dictionary<int, UndoState> _undo = new();
    bool _suppressInk, _inkDirty, _dirty, _notesDirty;

    // ---- text layer / selection ----
    List<WordBox> _words;
    Task<List<WordBox>> _wordsTask;
    int _wordsPage = -1;
    int _selA = -1, _selB = -1;
    bool _dragging;
    Point _lastPos, _capStart;
    readonly List<UIElement> _transient = new();

    // ---- lists ----
    readonly ObservableCollection<ThumbItem> _thumbs = new();
    readonly ObservableCollection<OutlineEntry> _outline = new();
    readonly ObservableCollection<BookmarkEntry> _bookmarks = new();
    readonly ObservableCollection<NoteEntry> _notes = new();
    readonly ObservableCollection<SearchHit> _hits = new();
    List<OutlineEntry> _pdfOutline = new();
    bool _navFromList;
    readonly Dictionary<int, List<RectD>> _searchRects = new();
    CancellationTokenSource _searchCts;
    bool _hideMemos;

    // ---- view / crop ----
    readonly Dictionary<int, RectD> _crop = new();
    RectD _cropCur = new(0, 0, 1, 1);
    bool _fitMode = true;

    // ---- typing format (remembered for the next text) ----
    string _tFont = "gothic";
    bool _tBold, _tItalic;
    double _tSize = 18;
    string _tColor = "#111111";
    ObjectControl _lastText;

    // ---- lasso shape / long-press / thumbs / recordings ----
    int _lassoShape;
    readonly DispatcherTimer _lpTimer = new() { Interval = TimeSpan.FromMilliseconds(650) };
    Point _lpPos, _lpStart;
    ICollectionView _thumbView;
    bool _bmOnly;
    readonly ObservableCollection<RecordingItem> _recs = new();
    AudioRecorder _recorder;
    DispatcherTimer _recTimer;
    DateTime _recStart;
    string _recId, _recFile;
    int _recPage;
    MediaPlayer _player;

    public IPageSource Source => _src;
    public string DocTitle => _src?.Title ?? "";
    public int CurrentPage => _page;

    public DocumentView()
    {
        InitializeComponent();
        _thumbView = CollectionViewSource.GetDefaultView(_thumbs);
        _thumbView.Filter = o => !_bmOnly || _ann.Bookmarks.Contains(((ThumbItem)o).Index);
        ThumbList.ItemsSource = _thumbView;
        RecList.ItemsSource = _recs;
        OutlineList.ItemsSource = _outline;
        BookmarkList.ItemsSource = _bookmarks;
        NotesList.ItemsSource = _notes;
        SearchList.ItemsSource = _hits;

        BuildColorButtons();
        BuildTypingPanel();
        _lpTimer.Tick += (s, e) => { _lpTimer.Stop(); ShowInsertMenu(_lpPos); };
        _recTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _recTimer.Tick += (s, e) => RecStatus.Text = $"녹음 중…  {DateTime.Now - _recStart:mm\\:ss}";
        Ink.Strokes.StrokesChanged += OnStrokesChanged;
        Ink.SelectionMoved += (s, e) => { _inkDirty = true; };
        Ink.SelectionResized += (s, e) => { _inkDirty = true; };

        _renderTimer.Tick += async (s, e) => { _renderTimer.Stop(); await RenderCurrentAsync(); };
        _saveTimer.Tick += (s, e) => SaveTick();
        _saveTimer.Start();

        _ready = true;
        FingerChk.IsChecked = Store.Settings.FingerInk;
        PanelToggle.IsChecked = true;
        SetMode(ToolMode.Read);
        ApplyWidthSliderRange();
    }

    // =====================================================================
    //  Initialization
    // =====================================================================

    public async Task InitAsync(IPageSource src)
    {
        _src = src;
        _ann = Store.LoadAnnotations(src.Key);
        LoadingText.Visibility = Visibility.Visible;

        RebuildThumbs();
        bool nb = src.IsNotebook;
        AddPageBtn.IsEnabled = nb;
        DelPageBtn.IsEnabled = nb;
        RefreshRecs();
        RefreshBookmarks();
        RefreshNotes();
        RefreshOutline();

        int start = Math.Clamp(_ann.LastPage, 0, Math.Max(0, src.PageCount - 1));
        GoToPage(start);
        await Dispatcher.InvokeAsync(FitWidth, DispatcherPriority.Loaded);
        LoadingText.Visibility = Visibility.Collapsed;

        _pdfOutline = await src.GetOutlineAsync();
        RefreshOutline();
        Keyboard.Focus(this);
    }

    public void Suspend()
    {
        SaveNow();
        _cache.Clear();
        _cacheOrder.Clear();
        PageImage.Source = null;
        Tts.Stop();
        try { _player?.Pause(); } catch { }
    }

    public async void Resume()
    {
        if (_src == null) return;
        await RenderCurrentAsync();
        Keyboard.Focus(this);
    }

    public void SetChromeVisible(bool visible)
    {
        var v = visible ? Visibility.Visible : Visibility.Collapsed;
        ToolbarBorder.Visibility = v;
        BottomBorder.Visibility = v;
        if (!visible) { SideCol.Width = new GridLength(0); SplitCol.Width = new GridLength(0); }
        else PanelToggle_Changed(null, null);
    }

    // =====================================================================
    //  Status helper
    // =====================================================================

    public void SetStatus(string text, int clearAfterMs = 4000)
    {
        StatusText.Text = text;
        _statusTimer?.Stop();
        if (clearAfterMs <= 0) return;
        _statusTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(clearAfterMs) };
        _statusTimer.Tick += (s, e) => { _statusTimer.Stop(); StatusText.Text = ""; };
        _statusTimer.Start();
    }

    // =====================================================================
    //  Persistence
    // =====================================================================

    void MarkDirty() => _dirty = true;

    void CommitInk()
    {
        if (_page < 0 || !_inkDirty) return;
        if (Ink.Strokes.Count == 0) _ann.Ink.Remove(_page);
        else _ann.Ink[_page] = InkIo.ToB64(Ink.Strokes);
        _inkDirty = false;
        _dirty = true;
    }

    void SaveTick()
    {
        if (_src == null) return;
        CommitInk();
        if (_notesDirty) { _notesDirty = false; RefreshNotes(); }
        if (_dirty) { _dirty = false; Store.SaveAnnotations(_src.Key, _ann); }
    }

    public void SaveNow()
    {
        if (_src == null) return;
        CommitInk();
        _dirty = false;
        Store.SaveAnnotations(_src.Key, _ann);
    }

    // =====================================================================
    //  Navigation
    // =====================================================================

    public void GoToPage(int page, double? yNorm = null)
    {
        if (_src == null) return;
        if (page >= _src.PageCount)
        {
            if (_src is NotebookSource nb && page == _src.PageCount)
            {
                nb.AddPage();
                _thumbs.Add(new ThumbItem(_src, _src.PageCount - 1));
                PageTotal.Text = " / " + _src.PageCount;
            }
            else page = _src.PageCount - 1;
        }
        if (page < 0) page = 0;

        CommitInk();
        PruneEmptyTexts();
        int prev = _page;
        _page = page;
        var (w, h) = _src.GetPageSize(page);
        _baseW = w; _baseH = h;
        ApplyCrop(_crop.TryGetValue(page, out var cc) ? cc : new RectD(0, 0, 1, 1));

        _suppressInk = true;
        try
        {
            Ink.Strokes.Clear();
            if (_ann.Ink.TryGetValue(page, out var b64) && !string.IsNullOrEmpty(b64))
            {
                try { Ink.Strokes.Add(InkIo.FromB64(b64)); } catch (Exception ex) { Store.Log("ink load: " + ex.Message); }
            }
        }
        finally { _suppressInk = false; }
        _inkDirty = false;

        PageImage.Source = null;
        _words = null; _wordsTask = null; _wordsPage = -1;
        ClearTransient();
        RebuildHighlights();
        RebuildMemos();
        RebuildObjects();
        UpdateNavUi();
        UpdateUndoUi();

        _ann.LastPage = page;
        MarkDirty();

        var _ = RenderCurrentAsync();
        Scroller.ScrollToTop();
        Scroller.ScrollToLeftEnd();
        if (yNorm.HasValue)
            Dispatcher.BeginInvoke(() => Scroller.ScrollToVerticalOffset(
                Math.Max(0, (yNorm.Value * _baseH - _cropCur.Y * _baseH) * _zoom - 60)), DispatcherPriority.Loaded);
        if (prev >= 0 && prev != page) PlayFlip(page > prev ? 1 : -1);
    }

    void PlayFlip(int dir)
    {
        if (Store.Settings.PageEffect != "slide") return;
        var move = new DoubleAnimation(dir * 70, 0, TimeSpan.FromMilliseconds(170))
        { EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut } };
        FlipTf.BeginAnimation(TranslateTransform.XProperty, move);
        Host.BeginAnimation(OpacityProperty, new DoubleAnimation(0.35, 1, TimeSpan.FromMilliseconds(170)));
    }

    // ---- crop (trim blank margins) ----

    void ApplyCrop(RectD c)
    {
        _cropCur = c;
        Host.Width = Math.Max(50, c.W * _baseW);
        Host.Height = Math.Max(50, c.H * _baseH);
        PageGrid.Width = _baseW;
        PageGrid.Height = _baseH;
        PageGrid.Margin = new Thickness(-c.X * _baseW, -c.Y * _baseH, 0, 0);
    }

    RectD UnionAnnotationBounds(RectD crop, int page)
    {
        double x0 = crop.X, y0 = crop.Y, x1 = crop.X + crop.W, y1 = crop.Y + crop.H;
        void U(double x, double y, double w, double h)
        {
            x0 = Math.Min(x0, x); y0 = Math.Min(y0, y); x1 = Math.Max(x1, x + w); y1 = Math.Max(y1, y + h);
        }
        foreach (var o in _ann.Objects.Where(o => o.Page == page)) U(o.X, o.Y, o.W, o.H);
        foreach (var m in _ann.Memos.Where(m => m.Page == page)) U(m.X, m.Y, MemoControl.WidthFor(m.Size) / _baseW, 0.12);
        foreach (var h in _ann.Highlights.Where(h => h.Page == page)) foreach (var r in h.Rects) U(r.X, r.Y, r.W, r.H);
        foreach (var l in _ann.Links.Where(l => l.Page == page)) foreach (var r in l.Rects) U(r.X, r.Y, r.W, r.H);
        if (page == _page && Ink.Strokes.Count > 0)
        {
            var b = Ink.Strokes.GetBounds();
            if (!b.IsEmpty) U(b.X / _baseW, b.Y / _baseH, b.Width / _baseW, b.Height / _baseH);
        }
        x0 = Math.Max(0, x0); y0 = Math.Max(0, y0); x1 = Math.Min(1, x1); y1 = Math.Min(1, y1);
        return new RectD(x0, y0, Math.Max(0.1, x1 - x0), Math.Max(0.1, y1 - y0));
    }

    async Task EnsureCropAsync(int page, BitmapSource bmp)
    {
        if (!Store.Settings.TrimMargins || _src.IsNotebook || _crop.ContainsKey(page)) return;
        var r = await Task.Run(() => ImageFx.FindContentBounds(bmp));
        if (page != _page || _crop.ContainsKey(page)) return;
        r = UnionAnnotationBounds(r, page);
        _crop[page] = r;
        ApplyCrop(r);
        if (_fitMode) FitWidth();
    }

    /// <summary>Called when view settings (trim margins etc.) change.</summary>
    public async void ApplyViewSettings()
    {
        if (_src == null) return;
        _crop.Clear();
        ApplyCrop(new RectD(0, 0, 1, 1));
        if (_fitMode) FitWidth();
        if (PageImage.Source is BitmapSource bmp) await EnsureCropAsync(_page, bmp);
    }

    public void NextPage() => GoToPage(_page + 1);

    public void PrevPage(bool toBottom = false)
    {
        if (_page <= 0) return;
        GoToPage(_page - 1);
        if (toBottom) Dispatcher.BeginInvoke(() => Scroller.ScrollToBottom(), DispatcherPriority.Loaded);
    }

    void UpdateNavUi()
    {
        PageBox.Text = (_page + 1).ToString();
        BookmarkBtn.Content = _ann.Bookmarks.Contains(_page) ? "★ 즐겨찾기" : "☆ 즐겨찾기";
        if (_page >= 0 && _page < _thumbs.Count)
        {
            _navFromList = true;
            var ti = _thumbs[_page];
            ThumbList.SelectedItem = _thumbView.Cast<object>().Contains(ti) ? ti : null;
            if (ThumbList.SelectedItem != null) ThumbList.ScrollIntoView(ti);
            _navFromList = false;
        }
    }

    void Prev_Click(object s, RoutedEventArgs e) => PrevPage();
    void Next_Click(object s, RoutedEventArgs e) => NextPage();

    void PageBox_KeyDown(object s, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        if (int.TryParse(PageBox.Text.Trim(), out int n)) GoToPage(Math.Clamp(n - 1, 0, _src.PageCount - 1));
        else PageBox.Text = (_page + 1).ToString();
        Keyboard.Focus(this);
        e.Handled = true;
    }

    void ThumbList_SelectionChanged(object s, SelectionChangedEventArgs e)
    {
        if (_navFromList || ThumbList.SelectedItem is not ThumbItem t) return;
        if (t.Index != _page) GoToPage(t.Index);
    }

    // =====================================================================
    //  Rendering & zoom
    // =====================================================================

    int ComputeRenderPx()
    {
        double dpi = VisualTreeHelper.GetDpi(this).DpiScaleX;
        int cap = Store.Settings.LowSpec ? 1800 : 3200;
        int px = (int)Math.Ceiling(_baseW * _zoom * dpi);
        px = (px + 99) / 100 * 100;
        return Math.Clamp(px, 400, cap);
    }

    void CachePut((int, int) key, BitmapSource bmp)
    {
        int cap = Store.Settings.LowSpec ? 3 : 6;
        if (_cache.ContainsKey(key)) { _cache[key] = bmp; return; }
        _cache[key] = bmp;
        _cacheOrder.Add(key);
        while (_cacheOrder.Count > cap)
        {
            _cache.Remove(_cacheOrder[0]);
            _cacheOrder.RemoveAt(0);
        }
    }

    async Task RenderCurrentAsync()
    {
        if (_src == null || _page < 0) return;
        int token = ++_renderToken;
        int page = _page;
        int px = ComputeRenderPx();
        if (_cache.TryGetValue((page, px), out var hit))
        {
            PageImage.Source = hit; _lastPx = px;
            await EnsureCropAsync(page, hit);
            return;
        }
        BitmapSource bmp;
        try { bmp = await _src.RenderAsync(page, px); }
        catch (Exception ex)
        {
            Store.Log("render: " + ex.Message);
            SetStatus("페이지를 그리지 못했습니다: " + ex.Message);
            return;
        }
        if (token != _renderToken || page != _page) { CachePut((page, px), bmp); return; }
        CachePut((page, px), bmp);
        PageImage.Source = bmp;
        _lastPx = px;
        await EnsureCropAsync(page, bmp);

        if (!Store.Settings.LowSpec && page + 1 < _src.PageCount && !_cache.ContainsKey((page + 1, px)))
        {
            try
            {
                var next = await _src.RenderAsync(page + 1, px);
                CachePut((page + 1, px), next);
            }
            catch { }
        }
    }

    void ScheduleRender() { _renderTimer.Stop(); _renderTimer.Start(); }

    void ApplyZoom(double z, bool keepCenter = true, bool fit = false)
    {
        z = Math.Clamp(z, 0.25, 6.0);
        _fitMode = fit;
        if (Math.Abs(z - _zoom) < 0.0005) return;
        double fx = 0.5, fy = 0.5;
        if (keepCenter && Scroller.ExtentWidth > 0 && Scroller.ExtentHeight > 0)
        {
            fx = (Scroller.HorizontalOffset + Scroller.ViewportWidth / 2) / Scroller.ExtentWidth;
            fy = (Scroller.VerticalOffset + Scroller.ViewportHeight / 2) / Scroller.ExtentHeight;
        }
        _zoom = z;
        ZoomTf.ScaleX = z; ZoomTf.ScaleY = z;
        ZoomLabel.Text = $"{z * 100:0}%";
        if (keepCenter)
        {
            Scroller.UpdateLayout();
            Scroller.ScrollToHorizontalOffset(fx * Scroller.ExtentWidth - Scroller.ViewportWidth / 2);
            Scroller.ScrollToVerticalOffset(fy * Scroller.ExtentHeight - Scroller.ViewportHeight / 2);
        }
        ScheduleRender();
    }

    public void FitWidth()
    {
        double vw = Scroller.ViewportWidth;
        if (vw <= 0) vw = Scroller.ActualWidth;
        if (vw <= 0) return;
        double cw = Host.Width > 0 ? Host.Width : _baseW;
        ApplyZoom((vw - 32) / cw, false, true);
        Scroller.ScrollToLeftEnd();
    }

    void ZoomIn_Click(object s, RoutedEventArgs e) => ApplyZoom(_zoom * 1.2);
    void ZoomOut_Click(object s, RoutedEventArgs e) => ApplyZoom(_zoom / 1.2);
    void Fit_Click(object s, RoutedEventArgs e) => FitWidth();

    void Scroller_SizeChanged(object s, SizeChangedEventArgs e)
    {
        if (_fitMode) FitWidth(); else ScheduleRender();
    }

    void Scroller_PreviewMouseWheel(object s, MouseWheelEventArgs e)
    {
        if (Keyboard.Modifiers == ModifierKeys.Control)
        {
            ApplyZoom(_zoom * (e.Delta > 0 ? 1.1 : 1 / 1.1));
            e.Handled = true;
            return;
        }
        bool canFlip = (DateTime.UtcNow - _lastFlip).TotalMilliseconds > 350;
        if (e.Delta < 0 && Scroller.VerticalOffset >= Scroller.ScrollableHeight - 1)
        {
            if (canFlip) { _lastFlip = DateTime.UtcNow; NextPage(); }
            e.Handled = true;
        }
        else if (e.Delta > 0 && Scroller.VerticalOffset <= 0.5)
        {
            if (canFlip && _page > 0) { _lastFlip = DateTime.UtcNow; PrevPage(true); }
            e.Handled = true;
        }
    }

    // ---- touch: pinch zoom / pan / swipe to turn page (read mode) ----

    void Host_ManipulationStarting(object s, ManipulationStartingEventArgs e)
    {
        e.ManipulationContainer = Scroller;
        e.Mode = ManipulationModes.Scale | ManipulationModes.Translate;
        e.Handled = true;
    }

    void Host_ManipulationDelta(object s, ManipulationDeltaEventArgs e)
    {
        var d = e.DeltaManipulation;
        if (Math.Abs(d.Scale.X - 1) > 0.002) ApplyZoom(_zoom * d.Scale.X, false, false);
        Scroller.ScrollToHorizontalOffset(Scroller.HorizontalOffset - d.Translation.X);
        Scroller.ScrollToVerticalOffset(Scroller.VerticalOffset - d.Translation.Y);
        e.Handled = true;
    }

    void Host_ManipulationCompleted(object s, ManipulationCompletedEventArgs e)
    {
        var t = e.TotalManipulation.Translation;
        if (Scroller.ScrollableWidth < 2 && Math.Abs(t.X) > 140 && Math.Abs(t.X) > 2 * Math.Abs(t.Y))
        {
            if (t.X < 0) NextPage(); else PrevPage();
        }
        e.Handled = true;
    }

    // =====================================================================
    //  Tools
    // =====================================================================

    void BuildColorButtons()
    {
        foreach (var hex in PenColors)
        {
            var c = hex;
            PenColorPanel.Children.Add(MakeColorBtn(c, () =>
            {
                _penColor = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(c);
                if (_mode != ToolMode.Pen) SetMode(ToolMode.Pen); else ApplyTool();
            }));
        }
        foreach (var hex in HlColors)
        {
            var c = hex;
            HlColorPanel.Children.Add(MakeColorBtn(c, () =>
            {
                _hlColorHex = c;
                if (_mode != ToolMode.Highlighter && _mode != ToolMode.TextSelect) SetMode(ToolMode.Highlighter);
                else ApplyTool();
            }));
        }
    }

    static Button MakeColorBtn(string hex, Action onClick)
    {
        var col = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hex);
        var b = new Button
        {
            Width = 22, Height = 22, Margin = new Thickness(3, 0, 3, 0), Padding = new Thickness(0),
            Background = new SolidColorBrush(col), BorderBrush = Brushes.Gray, BorderThickness = new Thickness(1),
            Cursor = Cursors.Hand
        };
        b.Click += (s, e) => onClick();
        return b;
    }

    RadioButton ModeButton(ToolMode m) => m switch
    {
        ToolMode.Read => BtnRead,
        ToolMode.Pen => BtnPen,
        ToolMode.Highlighter => BtnHl,
        ToolMode.Eraser => BtnEraser,
        ToolMode.Lasso => BtnLasso,
        ToolMode.TextSelect => BtnText,
        ToolMode.Typing => BtnTyping,
        ToolMode.Memo => BtnMemo,
        ToolMode.Outline => BtnOutline,
        _ => BtnCapture
    };

    void Tool_Checked(object sender, RoutedEventArgs e)
    {
        if (!_ready) return;
        var rb = (RadioButton)sender;
        SetMode(Enum.Parse<ToolMode>((string)rb.Tag));
    }

    public void SetMode(ToolMode m)
    {
        if (!_ready) return;
        if (_applied == m) return;
        _applied = m;
        _mode = m;
        var rb = ModeButton(m);
        if (rb.IsChecked != true) rb.IsChecked = true;

        ClearTransient();
        _dragging = false;
        Overlay.ReleaseMouseCapture();
        _lpTimer.Stop();
        if (m != ToolMode.Typing) PruneEmptyTexts();

        bool inkMode = m is ToolMode.Pen or ToolMode.Highlighter or ToolMode.Eraser or ToolMode.Lasso;
        bool lassoShape = m == ToolMode.Lasso && _lassoShape != 0;
        bool overlayMode = m is ToolMode.TextSelect or ToolMode.Typing or ToolMode.Memo or ToolMode.Outline or ToolMode.Capture;

        Ink.IsHitTestVisible = inkMode && !lassoShape;
        Overlay.IsHitTestVisible = overlayMode || lassoShape;
        ObjLayer.IsHitTestVisible = m is ToolMode.Read or ToolMode.Typing;
        Host.IsManipulationEnabled = m == ToolMode.Read;
        LassoShapeBox.Visibility = m == ToolMode.Lasso ? Visibility.Visible : Visibility.Collapsed;
        TypingPanel.Visibility = m == ToolMode.Typing ? Visibility.Visible : Visibility.Collapsed;
        Overlay.Cursor = m switch
        {
            ToolMode.TextSelect => Cursors.IBeam,
            ToolMode.Typing => Cursors.IBeam,
            ToolMode.Lasso => Cursors.Cross,
            ToolMode.Capture => Cursors.Cross,
            ToolMode.Memo or ToolMode.Outline => Cursors.Pen,
            _ => Cursors.Arrow
        };

        PenColorPanel.Visibility = m == ToolMode.Pen ? Visibility.Visible : Visibility.Collapsed;
        HlColorPanel.Visibility = m is ToolMode.Highlighter or ToolMode.TextSelect ? Visibility.Visible : Visibility.Collapsed;
        WidthSlider.Visibility = m is ToolMode.Pen or ToolMode.Highlighter ? Visibility.Visible : Visibility.Collapsed;
        ApplyWidthSliderRange();
        ApplyTool();

        string hint = m switch
        {
            ToolMode.Read => "이동: 휠/드래그로 스크롤, 두 손가락으로 확대, 하이라이트를 누르면 메모/삭제",
            ToolMode.Pen => "펜: 필압 필기. 펜 뒷면은 지우개",
            ToolMode.Highlighter => "형광펜: 자유 곡선 형광펜",
            ToolMode.Eraser => "지우개: 지울 획에 닿게 문지르세요",
            ToolMode.Lasso => "올가미: 필기를 둘러 선택 → 이동/삭제 (모양은 옆 목록에서 선택)",
            ToolMode.TextSelect => "글자선택: 문장을 드래그하세요",
            ToolMode.Typing => "타이핑: 글자를 넣을 위치를 누르세요 (서식은 도구 막대에서)",
            ToolMode.Memo => "메모: 포스트잇을 놓을 위치를 누르세요",
            ToolMode.Outline => "개요: 제목을 붙일 위치를 누르세요",
            _ => "캡처: 영역을 드래그하세요"
        };
        SetStatus(hint, 6000);
    }

    InkCanvasEditingMode WantedEditingMode() => _mode switch
    {
        ToolMode.Pen or ToolMode.Highlighter => InkCanvasEditingMode.Ink,
        ToolMode.Eraser => InkCanvasEditingMode.EraseByStroke,
        ToolMode.Lasso => InkCanvasEditingMode.Select,
        _ => InkCanvasEditingMode.None
    };

    void ApplyTool()
    {
        if (!_ready) return;
        Ink.EditingMode = WantedEditingMode();
        Ink.EditingModeInverted = InkCanvasEditingMode.EraseByStroke;
        if (_mode == ToolMode.Pen)
        {
            Ink.DefaultDrawingAttributes = new DrawingAttributes
            {
                Color = _penColor, Width = _penW, Height = _penW, FitToCurve = true,
                IgnorePressure = false, StylusTip = StylusTip.Ellipse, IsHighlighter = false
            };
        }
        else if (_mode == ToolMode.Highlighter)
        {
            var c = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(_hlColorHex);
            Ink.DefaultDrawingAttributes = new DrawingAttributes
            {
                Color = c, Width = _hlW * 0.55, Height = _hlW, FitToCurve = true,
                IgnorePressure = true, StylusTip = StylusTip.Rectangle, IsHighlighter = true
            };
        }
        if (_mode is not (ToolMode.Pen or ToolMode.Highlighter or ToolMode.Eraser or ToolMode.Lasso))
            Ink.IsHitTestVisible = false;
    }

    void LassoShape_Changed(object s, SelectionChangedEventArgs e)
    {
        if (!_ready) return;
        _lassoShape = LassoShapeBox.SelectedIndex;
        if (_mode == ToolMode.Lasso) { _applied = null; SetMode(ToolMode.Lasso); }
    }

    void Ink_SelectionChanged(object s, EventArgs e)
    {
        if (!_ready || _mode != ToolMode.Lasso || _lassoShape == 0) return;
        if (Ink.GetSelectedStrokes().Count == 0)
        {
            Ink.IsHitTestVisible = false;
            Overlay.IsHitTestVisible = true;
        }
    }

    void ApplyWidthSliderRange()
    {
        if (!_ready) return;
        _uiUpdating = true;
        if (_mode == ToolMode.Highlighter)
        {
            WidthSlider.Minimum = 8; WidthSlider.Maximum = 40; WidthSlider.Value = _hlW;
        }
        else
        {
            WidthSlider.Minimum = 1; WidthSlider.Maximum = 12; WidthSlider.Value = _penW;
        }
        _uiUpdating = false;
    }

    void WidthSlider_Changed(object s, RoutedPropertyChangedEventArgs<double> e)
    {
        if (!_ready || _uiUpdating) return;
        if (_mode == ToolMode.Highlighter) _hlW = WidthSlider.Value; else _penW = WidthSlider.Value;
        ApplyTool();
    }

    void Finger_Changed(object s, RoutedEventArgs e)
    {
        if (!_ready) return;
        Store.Settings.FingerInk = FingerChk.IsChecked == true;
        Store.SaveSettings();
    }

    void HideMemos_Changed(object s, RoutedEventArgs e)
    {
        if (!_ready) return;
        _hideMemos = HideMemosChk.IsChecked == true;
        RebuildMemos();
    }

    void PanelToggle_Changed(object s, RoutedEventArgs e)
    {
        if (!_ready) return;
        bool on = PanelToggle.IsChecked == true;
        SideCol.Width = on ? new GridLength(250) : new GridLength(0);
        SplitCol.Width = on ? new GridLength(5) : new GridLength(0);
    }

    // =====================================================================
    //  Ink events & undo
    // =====================================================================

    void Ink_PreviewStylusDown(object s, StylusDownEventArgs e)
    {
        // When "finger writing" is off, a finger touch must scroll instead of draw.
        if (_mode is ToolMode.Pen or ToolMode.Highlighter or ToolMode.Eraser or ToolMode.Lasso)
        {
            bool touch = e.StylusDevice?.TabletDevice?.Type == TabletDeviceType.Touch;
            if (touch && !Store.Settings.FingerInk) Ink.EditingMode = InkCanvasEditingMode.None;
            else if (Ink.EditingMode != WantedEditingMode()) Ink.EditingMode = WantedEditingMode();
        }
    }

    void Ink_PreviewStylusUp(object s, StylusEventArgs e)
    {
        if (_mode is ToolMode.Pen or ToolMode.Highlighter or ToolMode.Eraser or ToolMode.Lasso)
        {
            var want = WantedEditingMode();
            if (Ink.EditingMode != want) Ink.EditingMode = want;
        }
    }

    UndoState GetUndo(int page)
    {
        if (!_undo.TryGetValue(page, out var st)) _undo[page] = st = new UndoState();
        return st;
    }

    void OnStrokesChanged(object s, StrokeCollectionChangedEventArgs e)
    {
        if (_suppressInk) return;
        _inkDirty = true;
        var st = GetUndo(_page);
        st.Undo.Add(new InkAction { Added = new StrokeCollection(e.Added), Removed = new StrokeCollection(e.Removed) });
        if (st.Undo.Count > 200) st.Undo.RemoveAt(0);
        st.Redo.Clear();
        UpdateUndoUi();
    }

    void UpdateUndoUi()
    {
        var st = GetUndo(Math.Max(0, _page));
        UndoBtn.IsEnabled = st.Undo.Count > 0;
        RedoBtn.IsEnabled = st.Redo.Count > 0;
    }

    public void Undo()
    {
        var st = GetUndo(_page);
        if (st.Undo.Count == 0) return;
        var a = st.Undo[^1];
        st.Undo.RemoveAt(st.Undo.Count - 1);
        _suppressInk = true;
        try
        {
            if (a.Added.Count > 0) Ink.Strokes.Remove(a.Added);
            if (a.Removed.Count > 0) Ink.Strokes.Add(a.Removed);
        }
        catch (Exception ex) { Store.Log("undo: " + ex.Message); }
        finally { _suppressInk = false; }
        st.Redo.Add(a);
        _inkDirty = true;
        UpdateUndoUi();
    }

    public void Redo()
    {
        var st = GetUndo(_page);
        if (st.Redo.Count == 0) return;
        var a = st.Redo[^1];
        st.Redo.RemoveAt(st.Redo.Count - 1);
        _suppressInk = true;
        try
        {
            if (a.Removed.Count > 0) Ink.Strokes.Remove(a.Removed);
            if (a.Added.Count > 0) Ink.Strokes.Add(a.Added);
        }
        catch (Exception ex) { Store.Log("redo: " + ex.Message); }
        finally { _suppressInk = false; }
        st.Undo.Add(a);
        _inkDirty = true;
        UpdateUndoUi();
    }

    void Undo_Click(object s, RoutedEventArgs e) => Undo();
    void Redo_Click(object s, RoutedEventArgs e) => Redo();

    // =====================================================================
    //  Text layer & selection
    // =====================================================================

    Task<List<WordBox>> EnsureWordsAsync()
    {
        if (_wordsTask == null || _wordsPage != _page)
        {
            _wordsPage = _page;
            int p = _page;
            _wordsTask = _src.GetWordsAsync(p, true);
        }
        return _wordsTask;
    }

    int NearestWord(Point p)
    {
        if (_words == null || _words.Count == 0) return -1;
        double nx = p.X / _baseW, ny = p.Y / _baseH;
        int best = -1;
        double bd = double.MaxValue;
        for (int i = 0; i < _words.Count; i++)
        {
            var w = _words[i];
            double dx = nx < w.X ? w.X - nx : (nx > w.X + w.W ? nx - (w.X + w.W) : 0);
            double dy = ny < w.Y ? w.Y - ny : (ny > w.Y + w.H ? ny - (w.Y + w.H) : 0);
            dx *= _baseW; dy *= _baseH;
            double d = dx * dx + dy * dy * 1.6;
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    }

    List<WordBox> SelectedWords()
    {
        if (_words == null || _selA < 0 || _selB < 0) return new List<WordBox>();
        int a = Math.Min(_selA, _selB), b = Math.Max(_selA, _selB);
        return _words.Skip(a).Take(b - a + 1).ToList();
    }

    static List<RectD> MergeLines(IEnumerable<WordBox> ws)
    {
        var res = new List<RectD>();
        RectD cur = null;
        foreach (var w in ws)
        {
            if (cur != null)
            {
                double top = Math.Max(cur.Y, w.Y), bot = Math.Min(cur.Y + cur.H, w.Y + w.H);
                double ov = bot - top, minH = Math.Min(cur.H, w.H);
                if (ov > 0.5 * minH && w.X >= cur.X - 0.02 && w.X - (cur.X + cur.W) < 0.05)
                {
                    double x2 = Math.Max(cur.X + cur.W, w.X + w.W);
                    double y1 = Math.Min(cur.Y, w.Y), y2 = Math.Max(cur.Y + cur.H, w.Y + w.H);
                    cur.X = Math.Min(cur.X, w.X);
                    cur.W = x2 - cur.X;
                    cur.Y = y1;
                    cur.H = y2 - y1;
                    continue;
                }
                res.Add(cur);
            }
            cur = new RectD(w.X, w.Y, w.W, w.H);
        }
        if (cur != null) res.Add(cur);
        return res;
    }

    static string JoinWords(IEnumerable<WordBox> ws) => string.Join(" ", ws.Select(w => w.Text));

    void ClearTransient()
    {
        foreach (var t in _transient) Overlay.Children.Remove(t);
        _transient.Clear();
        _selA = _selB = -1;
    }

    void DrawSelection()
    {
        foreach (var t in _transient) Overlay.Children.Remove(t);
        _transient.Clear();
        var brush = new SolidColorBrush(System.Windows.Media.Color.FromArgb(0x55, 0x21, 0x96, 0xF3));
        foreach (var r in MergeLines(SelectedWords()))
        {
            var rect = new Shapes.Rectangle { Width = r.W * _baseW, Height = r.H * _baseH, Fill = brush, IsHitTestVisible = false };
            Canvas.SetLeft(rect, r.X * _baseW);
            Canvas.SetTop(rect, r.Y * _baseH);
            Overlay.Children.Add(rect);
            _transient.Add(rect);
        }
    }

    void Overlay_MouseDown(object s, MouseButtonEventArgs e)
    {
        var p = e.GetPosition(Overlay);
        _lastPos = p;
        switch (_mode)
        {
            case ToolMode.TextSelect:
                _ = BeginSelectAsync(p);
                break;
            case ToolMode.Typing:
                AddTextAt(p);
                break;
            case ToolMode.Lasso:
                ClearTransient();
                _capStart = p;
                _dragging = true;
                Overlay.CaptureMouse();
                break;
            case ToolMode.Memo:
                AddMemoAt(p);
                SetMode(ToolMode.Read);
                break;
            case ToolMode.Outline:
                AddOutlineAt(p);
                break;
            case ToolMode.Capture:
                ClearTransient();
                _capStart = p;
                _dragging = true;
                Overlay.CaptureMouse();
                break;
        }
        e.Handled = true;
    }

    async Task BeginSelectAsync(Point p)
    {
        ClearTransient();
        _dragging = true;
        Overlay.CaptureMouse();
        if (_words == null) SetStatus("글자 인식 중…", 0);
        int page = _page;
        List<WordBox> ws;
        try { ws = await EnsureWordsAsync(); }
        catch { ws = new List<WordBox>(); }
        if (page != _page) return;
        _words = ws;
        if (_words.Count == 0)
        {
            _dragging = false;
            Overlay.ReleaseMouseCapture();
            SetStatus("인식된 글자가 없습니다. 스캔본이면 Windows 설정에서 OCR 언어(한국어 등)를 설치하세요.", 7000);
            return;
        }
        StatusText.Text = "";
        _selA = NearestWord(p);
        _selB = _dragging ? NearestWord(_lastPos) : NearestWord(_lastPos);
        DrawSelection();
        if (!_dragging && _selA >= 0) ShowSelectionMenu();
    }

    void Overlay_MouseMove(object s, MouseEventArgs e)
    {
        var p = e.GetPosition(Overlay);
        _lastPos = p;
        if (!_dragging) return;
        if (_mode == ToolMode.TextSelect)
        {
            if (_words != null && _selA >= 0)
            {
                int n = NearestWord(p);
                if (n != _selB) { _selB = n; DrawSelection(); }
            }
        }
        else if (_mode == ToolMode.Capture || _mode == ToolMode.Lasso)
        {
            foreach (var t in _transient) Overlay.Children.Remove(t);
            _transient.Clear();
            var r = new Rect(_capStart, p);
            Shapes.Shape shape = _mode == ToolMode.Lasso && _lassoShape == 2 ? new Shapes.Ellipse() : new Shapes.Rectangle();
            shape.Width = r.Width; shape.Height = r.Height;
            shape.Stroke = Brushes.DodgerBlue; shape.StrokeThickness = 1.5;
            shape.StrokeDashArray = new DoubleCollection { 4, 3 };
            shape.Fill = new SolidColorBrush(System.Windows.Media.Color.FromArgb(0x22, 0x1E, 0x88, 0xE5));
            shape.IsHitTestVisible = false;
            Canvas.SetLeft(shape, r.X); Canvas.SetTop(shape, r.Y);
            Overlay.Children.Add(shape);
            _transient.Add(shape);
        }
    }

    void Overlay_MouseUp(object s, MouseButtonEventArgs e)
    {
        var p = e.GetPosition(Overlay);
        _lastPos = p;
        if (!_dragging) return;
        _dragging = false;
        Overlay.ReleaseMouseCapture();
        if (_mode == ToolMode.TextSelect)
        {
            if (_words != null && _selA >= 0) { _selB = NearestWord(p); DrawSelection(); ShowSelectionMenu(); }
        }
        else if (_mode == ToolMode.Capture)
        {
            var r = new Rect(_capStart, p);
            r.Intersect(new Rect(0, 0, _baseW, _baseH));
            if (!r.IsEmpty && r.Width > 8 && r.Height > 8) ShowCaptureMenu(r);
            else ClearTransient();
        }
        else if (_mode == ToolMode.Lasso)
        {
            var r = new Rect(_capStart, p);
            ClearTransient();
            if (r.Width < 6 || r.Height < 6) return;
            StrokeCollection sel;
            if (_lassoShape == 2)
            {
                var pts = new List<Point>();
                for (int i = 0; i < 48; i++)
                {
                    double a = i * Math.PI * 2 / 48;
                    pts.Add(new Point(r.X + r.Width / 2 + r.Width / 2 * Math.Cos(a), r.Y + r.Height / 2 + r.Height / 2 * Math.Sin(a)));
                }
                sel = Ink.Strokes.HitTest(pts, 60);
            }
            else sel = Ink.Strokes.HitTest(r, 60);
            if (sel.Count == 0) { SetStatus("선택된 필기가 없습니다."); return; }
            Overlay.IsHitTestVisible = false;
            Ink.IsHitTestVisible = true;
            Ink.EditingMode = InkCanvasEditingMode.Select;
            Ink.Select(sel);
            SetStatus("선택됨: 끌어서 이동, 모서리로 크기 조절, Delete로 삭제. 바깥을 누르면 선택 해제");
        }
        e.Handled = true;
    }

    // ---- selection actions ----

    void ShowSelectionMenu()
    {
        var ws = SelectedWords();
        if (ws.Count == 0) return;
        string text = JoinWords(ws);
        var menu = new ContextMenu { Placement = System.Windows.Controls.Primitives.PlacementMode.MousePoint };
        MenuItem Item(string header, Action act)
        {
            var mi = new MenuItem { Header = header };
            mi.Click += (s, e) => act();
            return mi;
        }
        menu.Items.Add(Item("하이라이트", () => { AddHighlightFromSelection(""); ClearTransient(); }));
        menu.Items.Add(Item("하이라이트 + 메모", () =>
        {
            var note = Dialogs.Prompt(Window.GetWindow(this), "하이라이트 메모", "메모 내용", "", true);
            if (note == null) return;
            AddHighlightFromSelection(note);
            ClearTransient();
        }));
        menu.Items.Add(new Separator());
        menu.Items.Add(Item("복사", () => { SafeClipboard(text); SetStatus("복사했습니다."); ClearTransient(); }));
        menu.Items.Add(Item("번역", () => { OpenTranslate(text); ClearTransient(); }));
        menu.Items.Add(Item("읽어주기", () =>
        {
            if (Tts.IsSpeaking) Tts.Stop(); else Tts.Speak(text);
            ClearTransient();
        }));
        menu.Items.Add(Item("사전 검색", () => { OpenDictionary(text); ClearTransient(); }));
        menu.Items.Add(new Separator());
        menu.Items.Add(Item("링크 걸기…", () =>
        {
            var input = Dialogs.Prompt(Window.GetWindow(this), "링크 걸기", "웹 주소 또는 이동할 페이지 번호");
            if (!string.IsNullOrWhiteSpace(input))
            {
                ObjectControl.ParseTarget(input, out var url, out var tp);
                if (url.Length > 0 || tp >= 0)
                {
                    _ann.Links.Add(new LinkItem { Page = _page, Rects = MergeLines(ws), Url = url, TargetPage = tp });
                    MarkDirty(); RebuildHighlights();
                }
            }
            ClearTransient();
        }));
        menu.Items.Add(Item("개요 제목으로 추가", () =>
        {
            var first = ws[0];
            var title = Dialogs.Prompt(Window.GetWindow(this), "개요 추가", "제목",
                text.Length > 60 ? text.Substring(0, 60) : text);
            if (!string.IsNullOrWhiteSpace(title))
            {
                _ann.Outline.Add(new OutlineItem { Page = _page, Y = Math.Max(0, first.Y - 0.01), Title = title.Trim() });
                MarkDirty(); RefreshOutline();
            }
            ClearTransient();
        }));
        menu.Items.Add(Item("선택 취소", ClearTransient));
        menu.Closed += (s, e) => { };
        menu.IsOpen = true;
    }

    void AddHighlightFromSelection(string note)
    {
        var ws = SelectedWords();
        if (ws.Count == 0) return;
        _ann.Highlights.Add(new HighlightItem
        {
            Page = _page, Color = _hlColorHex, Rects = MergeLines(ws), Text = JoinWords(ws), Note = note ?? ""
        });
        MarkDirty();
        RebuildHighlights();
        RefreshNotes();
    }

    static void SafeClipboard(string text)
    {
        try { Clipboard.SetText(text); } catch (Exception ex) { Store.Log("clipboard: " + ex.Message); }
    }

    static void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { Store.Log("openurl: " + ex.Message); }
    }

    static void OpenTranslate(string text)
    {
        if (text.Length > 1800) text = text.Substring(0, 1800);
        OpenUrl($"https://translate.google.com/?sl=auto&tl={Store.Settings.TranslateTarget}&text={Uri.EscapeDataString(text)}&op=translate");
    }

    static void OpenDictionary(string text)
    {
        var q = text.Length > 60 ? text.Substring(0, 60) : text;
        OpenUrl("https://dict.naver.com/search.dict?dicQuery=" + Uri.EscapeDataString(q));
    }

    // ---- capture ----

    RenderTargetBitmap RenderHost(double scale)
    {
        int pw = (int)Math.Ceiling(_baseW * scale), ph = (int)Math.Ceiling(_baseH * scale);
        var dv = new DrawingVisual();
        using (var dc = dv.RenderOpen())
        {
            dc.PushTransform(new ScaleTransform(scale, scale));
            dc.DrawRectangle(new VisualBrush(PageGrid) { Stretch = Stretch.None, AlignmentX = AlignmentX.Left, AlignmentY = AlignmentY.Top },
                null, new Rect(0, 0, _baseW, _baseH));
            dc.Pop();
        }
        var rtb = new RenderTargetBitmap(pw, ph, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(dv);
        rtb.Freeze();
        return rtb;
    }

    BitmapSource CaptureRegion(Rect r)
    {
        double scale = Math.Clamp(_lastPx / _baseW, 1.0, 3.0);
        Overlay.Visibility = Visibility.Hidden;
        try
        {
            var full = RenderHost(scale);
            int x = Math.Max(0, (int)(r.X * scale)), y = Math.Max(0, (int)(r.Y * scale));
            int w = Math.Min(full.PixelWidth - x, (int)(r.Width * scale));
            int h = Math.Min(full.PixelHeight - y, (int)(r.Height * scale));
            var crop = new CroppedBitmap(full, new Int32Rect(x, y, Math.Max(1, w), Math.Max(1, h)));
            crop.Freeze();
            return crop;
        }
        finally { Overlay.Visibility = Visibility.Visible; }
    }

    void ShowCaptureMenu(Rect r)
    {
        var menu = new ContextMenu { Placement = System.Windows.Controls.Primitives.PlacementMode.MousePoint };
        MenuItem Item(string header, Action act)
        {
            var mi = new MenuItem { Header = header };
            mi.Click += (s, e) => act();
            return mi;
        }
        menu.Items.Add(Item("이미지 복사", () =>
        {
            try { Clipboard.SetImage(CaptureRegion(r)); SetStatus("이미지를 복사했습니다."); }
            catch (Exception ex) { SetStatus("복사 실패: " + ex.Message); }
            ClearTransient();
        }));
        menu.Items.Add(Item("PNG로 저장…", () =>
        {
            var dlg = new SaveFileDialog { Filter = "PNG 이미지|*.png", FileName = $"{_src.Title}_p{_page + 1}.png" };
            if (dlg.ShowDialog() == true)
            {
                var enc = new PngBitmapEncoder();
                enc.Frames.Add(BitmapFrame.Create(CaptureRegion(r)));
                using var fs = File.Create(dlg.FileName);
                enc.Save(fs);
                SetStatus("저장했습니다.");
            }
            ClearTransient();
        }));
        menu.Items.Add(Item("글자 복사", async () =>
        {
            var ws = await EnsureWordsAsync();
            var inside = ws.Where(w =>
            {
                double cx = (w.X + w.W / 2) * _baseW, cy = (w.Y + w.H / 2) * _baseH;
                return r.Contains(new Point(cx, cy));
            });
            var t = JoinWords(inside);
            if (t.Length > 0) { SafeClipboard(t); SetStatus("글자를 복사했습니다."); }
            else SetStatus("영역 안에 인식된 글자가 없습니다.");
            ClearTransient();
        }));
        menu.Items.Add(Item("취소", ClearTransient));
        menu.IsOpen = true;
    }

    // =====================================================================
    //  Highlights
    // =====================================================================

    static SolidColorBrush HlBrush(string hex, byte alpha)
    {
        var c = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hex);
        var b = new SolidColorBrush(System.Windows.Media.Color.FromArgb(alpha, c.R, c.G, c.B));
        b.Freeze();
        return b;
    }

    void RebuildHighlights()
    {
        HlLayer.Children.Clear();
        foreach (var h in _ann.Highlights.Where(x => x.Page == _page))
        {
            foreach (var r in h.Rects)
            {
                var rect = new Shapes.Rectangle
                {
                    Width = r.W * _baseW, Height = r.H * _baseH, Fill = HlBrush(h.Color, 0x70),
                    Tag = h, Cursor = Cursors.Hand
                };
                if (!string.IsNullOrEmpty(h.Note)) rect.ToolTip = h.Note;
                Canvas.SetLeft(rect, r.X * _baseW);
                Canvas.SetTop(rect, r.Y * _baseH);
                rect.MouseLeftButtonUp += Highlight_Click;
                HlLayer.Children.Add(rect);
            }
        }
        foreach (var l in _ann.Links.Where(x => x.Page == _page))
        {
            foreach (var r in l.Rects)
            {
                var hit = new Shapes.Rectangle
                {
                    Width = r.W * _baseW, Height = r.H * _baseH, Fill = HlBrush("#1E88E5", 0x1C),
                    Tag = l, Cursor = Cursors.Hand, ToolTip = l.TargetPage >= 0 ? $"{l.TargetPage + 1}페이지로 이동" : l.Url
                };
                Canvas.SetLeft(hit, r.X * _baseW);
                Canvas.SetTop(hit, r.Y * _baseH);
                hit.MouseLeftButtonUp += LinkRect_Click;
                HlLayer.Children.Add(hit);
                var line = new Shapes.Rectangle
                {
                    Width = r.W * _baseW, Height = 1.6, Fill = HlBrush("#1565C0", 0xFF), IsHitTestVisible = false
                };
                Canvas.SetLeft(line, r.X * _baseW);
                Canvas.SetTop(line, (r.Y + r.H) * _baseH - 1);
                HlLayer.Children.Add(line);
            }
            var last = l.Rects.LastOrDefault();
            if (last != null)
            {
                var mark = new TextBlock { Text = "↗", Foreground = HlBrush("#1565C0", 0xFF), FontSize = 11, IsHitTestVisible = false };
                Canvas.SetLeft(mark, (last.X + last.W) * _baseW + 1);
                Canvas.SetTop(mark, last.Y * _baseH - 2);
                HlLayer.Children.Add(mark);
            }
        }
        if (_searchRects.TryGetValue(_page, out var sr))
        {
            foreach (var r in sr)
            {
                var rect = new Shapes.Rectangle
                {
                    Width = r.W * _baseW, Height = r.H * _baseH, Fill = HlBrush("#FF9800", 0x88),
                    Stroke = HlBrush("#E65100", 0xCC), StrokeThickness = 1, IsHitTestVisible = false
                };
                Canvas.SetLeft(rect, r.X * _baseW);
                Canvas.SetTop(rect, r.Y * _baseH);
                HlLayer.Children.Add(rect);
            }
        }
    }

    void ActivateLink(string url, int page)
    {
        if (page >= 0 && page < _src.PageCount) GoToPage(page);
        else if (!string.IsNullOrEmpty(url)) OpenUrl(url);
    }

    void LinkRect_Click(object sender, MouseButtonEventArgs e)
    {
        if (_mode != ToolMode.Read) return;
        if (((FrameworkElement)sender).Tag is not LinkItem l) return;
        var menu = new ContextMenu { Placement = System.Windows.Controls.Primitives.PlacementMode.MousePoint };
        var open = new MenuItem { Header = "링크 열기" };
        open.Click += (s, a) => ActivateLink(l.Url, l.TargetPage);
        menu.Items.Add(open);
        var edit = new MenuItem { Header = "링크 수정…" };
        edit.Click += (s, a) =>
        {
            var input = Dialogs.Prompt(Window.GetWindow(this), "링크 수정", "웹 주소 또는 이동할 페이지 번호",
                l.TargetPage >= 0 ? (l.TargetPage + 1).ToString() : l.Url);
            if (string.IsNullOrWhiteSpace(input)) return;
            ObjectControl.ParseTarget(input, out var url, out var tp);
            l.Url = url; l.TargetPage = tp; MarkDirty(); RebuildHighlights();
        };
        menu.Items.Add(edit);
        var del = new MenuItem { Header = "링크 삭제" };
        del.Click += (s, a) => { _ann.Links.Remove(l); MarkDirty(); RebuildHighlights(); };
        menu.Items.Add(del);
        menu.IsOpen = true;
        e.Handled = true;
    }

    void Highlight_Click(object sender, MouseButtonEventArgs e)
    {
        if (_mode != ToolMode.Read) return;
        if (((FrameworkElement)sender).Tag is not HighlightItem h) return;
        var menu = new ContextMenu { Placement = System.Windows.Controls.Primitives.PlacementMode.MousePoint };
        var note = new MenuItem { Header = string.IsNullOrEmpty(h.Note) ? "메모 추가" : "메모 편집" };
        note.Click += (s, a) =>
        {
            var t = Dialogs.Prompt(Window.GetWindow(this), "하이라이트 메모", "메모 내용", h.Note, true);
            if (t == null) return;
            h.Note = t; MarkDirty(); RebuildHighlights(); RefreshNotes();
        };
        menu.Items.Add(note);
        var copy = new MenuItem { Header = "텍스트 복사" };
        copy.Click += (s, a) => { SafeClipboard(h.Text); SetStatus("복사했습니다."); };
        menu.Items.Add(copy);
        var colorMenu = new MenuItem { Header = "색 변경" };
        foreach (var hex in HlColors)
        {
            var c = hex;
            var mi = new MenuItem
            {
                Header = new Shapes.Rectangle { Width = 40, Height = 14, Fill = HlBrush(c, 0xFF) }
            };
            mi.Click += (s, a) => { h.Color = c; MarkDirty(); RebuildHighlights(); };
            colorMenu.Items.Add(mi);
        }
        menu.Items.Add(colorMenu);
        var del = new MenuItem { Header = "삭제" };
        del.Click += (s, a) =>
        {
            _ann.Highlights.Remove(h); MarkDirty(); RebuildHighlights(); RefreshNotes();
        };
        menu.Items.Add(del);
        menu.IsOpen = true;
        e.Handled = true;
    }

    // =====================================================================
    //  Memos (post-it)
    // =====================================================================

    void RebuildMemos()
    {
        MemoLayer.Children.Clear();
        if (_hideMemos) return;
        foreach (var m in _ann.Memos.Where(x => x.Page == _page)) AddMemoControl(m);
    }

    MemoControl AddMemoControl(MemoItem m)
    {
        var c = new MemoControl(m);
        Canvas.SetLeft(c, m.X * _baseW);
        Canvas.SetTop(c, m.Y * _baseH);
        c.Changed += () => { MarkDirty(); _notesDirty = true; };
        c.Moved += mc =>
        {
            double x = Math.Clamp(Canvas.GetLeft(mc), -20, _baseW - 40);
            double y = Math.Clamp(Canvas.GetTop(mc), -10, _baseH - 24);
            Canvas.SetLeft(mc, x); Canvas.SetTop(mc, y);
            mc.Model.X = x / _baseW; mc.Model.Y = y / _baseH;
            MarkDirty();
        };
        c.DeleteRequested += mc =>
        {
            if (!string.IsNullOrWhiteSpace(mc.Model.Text) &&
                MessageBox.Show(Window.GetWindow(this), "이 메모를 삭제할까요?", "메모 삭제",
                    MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            _ann.Memos.Remove(mc.Model);
            MemoLayer.Children.Remove(mc);
            MarkDirty(); RefreshNotes();
        };
        MemoLayer.Children.Add(c);
        return c;
    }

    void AddMemoAt(Point p)
    {
        var m = new MemoItem
        {
            Page = _page,
            X = Math.Clamp(p.X / _baseW, 0, 0.78),
            Y = Math.Clamp(p.Y / _baseH, 0, 0.92)
        };
        _ann.Memos.Add(m);
        MarkDirty();
        _hideMemos = false; HideMemosChk.IsChecked = false;
        var c = AddMemoControl(m);
        Dispatcher.BeginInvoke(() => c.FocusText(), DispatcherPriority.Input);
        RefreshNotes();
    }

    // =====================================================================
    //  Outline / bookmarks / notes lists
    // =====================================================================

    void AddOutlineAt(Point p)
    {
        var title = Dialogs.Prompt(Window.GetWindow(this), "개요 추가", "이 위치의 제목");
        SetMode(ToolMode.Read);
        if (string.IsNullOrWhiteSpace(title)) return;
        _ann.Outline.Add(new OutlineItem { Page = _page, Y = Math.Clamp(p.Y / _baseH, 0, 1), Title = title.Trim() });
        MarkDirty();
        RefreshOutline();
        SideTabs.SelectedIndex = 1;
    }

    void RefreshOutline()
    {
        _outline.Clear();
        foreach (var o in _ann.Outline.OrderBy(x => x.Page).ThenBy(x => x.Y))
            _outline.Add(new OutlineEntry { Title = o.Title, Page = o.Page, Y = o.Y, IsUser = true, Id = o.Id });
        foreach (var o in _pdfOutline) _outline.Add(o);
    }

    void OutlineList_SelectionChanged(object s, SelectionChangedEventArgs e)
    {
        if (OutlineList.SelectedItem is not OutlineEntry o || o.Page < 0 || o.Page >= _src.PageCount) return;
        GoToPage(o.Page, o.Y >= 0 ? o.Y : null);
    }

    void OutlineDelete_Click(object s, RoutedEventArgs e)
    {
        if (OutlineList.SelectedItem is not OutlineEntry o || !o.IsUser) { SetStatus("내가 만든 개요만 삭제할 수 있습니다."); return; }
        _ann.Outline.RemoveAll(x => x.Id == o.Id);
        MarkDirty();
        RefreshOutline();
    }

    void RefreshBookmarks()
    {
        _bookmarks.Clear();
        foreach (var p in _ann.Bookmarks.OrderBy(x => x)) _bookmarks.Add(new BookmarkEntry { Page = p });
        _thumbView?.Refresh();
    }

    void Bookmark_Click(object s, RoutedEventArgs e)
    {
        if (_ann.Bookmarks.Contains(_page)) _ann.Bookmarks.Remove(_page); else _ann.Bookmarks.Add(_page);
        MarkDirty();
        RefreshBookmarks();
        if (_bmOnly) _thumbView.Refresh();
        UpdateNavUi();
    }

    void BookmarkList_SelectionChanged(object s, SelectionChangedEventArgs e)
    {
        if (BookmarkList.SelectedItem is BookmarkEntry b) GoToPage(b.Page);
    }

    void BookmarkDelete_Click(object s, RoutedEventArgs e)
    {
        if (BookmarkList.SelectedItem is not BookmarkEntry b) return;
        _ann.Bookmarks.Remove(b.Page);
        MarkDirty();
        RefreshBookmarks();
        UpdateNavUi();
    }

    void RefreshNotes()
    {
        _notes.Clear();
        var all = new List<NoteEntry>();
        foreach (var h in _ann.Highlights)
            all.Add(new NoteEntry { Kind = "하이라이트", Page = h.Page, Text = h.Text, Note = h.Note, Id = h.Id });
        foreach (var m in _ann.Memos)
            all.Add(new NoteEntry { Kind = "메모", Page = m.Page, Text = m.Text, Id = m.Id });
        foreach (var o in _ann.Objects.Where(o => o.Type == "text" && !string.IsNullOrWhiteSpace(o.Text)))
            all.Add(new NoteEntry { Kind = "타이핑", Page = o.Page, Text = o.Text, Id = o.Id });
        foreach (var n in all.OrderBy(x => x.Page)) _notes.Add(n);
    }

    void NotesList_SelectionChanged(object s, SelectionChangedEventArgs e)
    {
        if (NotesList.SelectedItem is not NoteEntry n) return;
        if (n.Page != _page) GoToPage(n.Page);
    }

    // =====================================================================
    //  Search
    // =====================================================================

    public void FocusSearch()
    {
        PanelToggle.IsChecked = true;
        SideTabs.SelectedItem = SearchTab;
        SearchBox.Focus();
        SearchBox.SelectAll();
    }

    public void FocusPageBox() { PageBox.Focus(); PageBox.SelectAll(); }

    void SearchBox_KeyDown(object s, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) { Search_Click(null, null); e.Handled = true; }
    }

    static List<(List<RectD> rects, string snippet)> FindMatches(List<WordBox> words, string q)
    {
        var res = new List<(List<RectD>, string)>();
        if (words.Count == 0) return res;
        var sb = new System.Text.StringBuilder();
        var starts = new int[words.Count];
        var ends = new int[words.Count];
        for (int i = 0; i < words.Count; i++)
        {
            starts[i] = sb.Length;
            sb.Append(words[i].Text);
            ends[i] = sb.Length;
            sb.Append(' ');
        }
        string text = sb.ToString();
        int pos = 0;
        while (pos < text.Length)
        {
            int idx = text.IndexOf(q, pos, StringComparison.OrdinalIgnoreCase);
            if (idx < 0) break;
            int endIdx = idx + q.Length;
            var hit = new List<WordBox>();
            for (int i = 0; i < words.Count; i++)
                if (ends[i] > idx && starts[i] < endIdx) hit.Add(words[i]);
            int a = Math.Max(0, idx - 24), b = Math.Min(text.Length, endIdx + 40);
            res.Add((MergeLines(hit), text.Substring(a, b - a).Trim()));
            pos = endIdx;
            if (res.Count > 40) break;
        }
        return res;
    }

    async void Search_Click(object s, RoutedEventArgs e)
    {
        var q = SearchBox.Text.Trim();
        _searchCts?.Cancel();
        _hits.Clear();
        _searchRects.Clear();
        RebuildHighlights();
        if (q.Length == 0) { SearchStatus.Text = ""; return; }

        var cts = _searchCts = new CancellationTokenSource();
        int total = _src.PageCount, found = 0;
        SearchStatus.Text = "검색 중…";
        try
        {
            for (int i = 0; i < total; i++)
            {
                if (cts.IsCancellationRequested) return;
                var words = await _src.GetWordsAsync(i, false);
                foreach (var (rects, snip) in FindMatches(words, q))
                {
                    _hits.Add(new SearchHit { Page = i, Snippet = snip });
                    if (!_searchRects.TryGetValue(i, out var list)) _searchRects[i] = list = new List<RectD>();
                    list.AddRange(rects);
                    found++;
                }
                if (i % 5 == 0) SearchStatus.Text = $"검색 중… {i + 1}/{total} · {found}건";
                if (found >= 500) break;
            }
            foreach (var m in _ann.Memos.Where(x => x.Text.Contains(q, StringComparison.OrdinalIgnoreCase)))
            { _hits.Add(new SearchHit { Page = m.Page, Snippet = "[메모] " + m.Text.Replace("\n", " ") }); found++; }
            foreach (var h in _ann.Highlights.Where(x => x.Note.Contains(q, StringComparison.OrdinalIgnoreCase)))
            { _hits.Add(new SearchHit { Page = h.Page, Snippet = "[하이라이트 메모] " + h.Note.Replace("\n", " ") }); found++; }
            foreach (var o in _ann.Objects.Where(x => x.Type == "text" && x.Text.Contains(q, StringComparison.OrdinalIgnoreCase)))
            { _hits.Add(new SearchHit { Page = o.Page, Snippet = "[타이핑] " + o.Text.Replace("\n", " ") }); found++; }
            SearchStatus.Text = found == 0
                ? "결과가 없습니다. (스캔 페이지는 글자 선택 도구의 OCR로만 인식됩니다)"
                : $"{found}건 찾음";
            RebuildHighlights();
        }
        catch (Exception ex) { SearchStatus.Text = "검색 오류: " + ex.Message; }
    }

    void SearchList_SelectionChanged(object s, SelectionChangedEventArgs e)
    {
        if (SearchList.SelectedItem is not SearchHit h) return;
        if (h.Page != _page) GoToPage(h.Page); else RebuildHighlights();
        SearchStatus.Text = $"{SearchList.SelectedIndex + 1} / {_hits.Count}";
    }

    void SearchStep(int d)
    {
        if (_hits.Count == 0) return;
        int i = SearchList.SelectedIndex;
        i = i < 0 ? (d > 0 ? 0 : _hits.Count - 1) : (i + d + _hits.Count) % _hits.Count;
        SearchList.SelectedIndex = i;
        SearchList.ScrollIntoView(_hits[i]);
    }

    void SearchNext_Click(object s, RoutedEventArgs e) => SearchStep(1);
    void SearchPrev_Click(object s, RoutedEventArgs e) => SearchStep(-1);

    // =====================================================================
    //  Export / backup
    // =====================================================================

    public async Task ExportPdfAsync()
    {
        CommitInk();
        var dlg = new SaveFileDialog { Filter = "PDF|*.pdf", FileName = _src.Title + " (주석 포함).pdf" };
        if (dlg.ShowDialog() != true) return;
        var owner = Window.GetWindow(this);
        try
        {
            if (owner != null) owner.IsEnabled = false;
            Mouse.OverrideCursor = Cursors.Wait;
            int px = Store.Settings.LowSpec ? 1400 : 1800;
            await Exporter.ExportPdfAsync(_src, _ann, dlg.FileName, px,
                i => { StatusText.Text = $"PDF 내보내는 중… {i}/{_src.PageCount}"; });
            StatusText.Text = "";
            SetStatus("PDF를 저장했습니다.", 5000);
            MessageBox.Show(owner, "주석이 포함된 PDF를 저장했습니다.\n(페이지가 이미지로 합쳐져 글자 선택은 되지 않습니다.)",
                "PDF 내보내기", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(owner, "내보내기에 실패했습니다.\n" + ex.Message, "PDF 내보내기", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally
        {
            Mouse.OverrideCursor = null;
            if (owner != null) owner.IsEnabled = true;
        }
    }

    void SaveText(string defaultName, string filter, string content, bool bom)
    {
        var dlg = new SaveFileDialog { Filter = filter, FileName = defaultName };
        if (dlg.ShowDialog() != true) return;
        File.WriteAllText(dlg.FileName, content, new System.Text.UTF8Encoding(bom));
        SetStatus("저장했습니다.");
    }

    public void ExportMarkdown() { CommitInk(); SaveText(_src.Title + " 노트.md", "Markdown|*.md", Exporter.ToMarkdown(_src.Title, _ann), false); }
    public void ExportCsv() { CommitInk(); SaveText(_src.Title + " 노트.csv", "CSV|*.csv", Exporter.ToCsv(_ann), true); }
    public void ExportAnki() { CommitInk(); SaveText(_src.Title + " Anki.txt", "Anki 가져오기(TSV)|*.txt", Exporter.ToAnkiTsv(_src.Title, _ann), false); }
    void ExportMd_Click(object s, RoutedEventArgs e) => ExportMarkdown();
    void ExportCsv_Click(object s, RoutedEventArgs e) => ExportCsv();
    void ExportAnki_Click(object s, RoutedEventArgs e) => ExportAnki();

    public void BackupAnnotations()
    {
        CommitInk();
        var dlg = new SaveFileDialog { Filter = "PDF Note 백업|*.pnotebackup.json", FileName = _src.Title + ".pnotebackup.json" };
        if (dlg.ShowDialog() != true) return;
        var copy = Store.DeserializeAnnotations(Store.SerializeAnnotations(_ann));
        copy.Recordings = new List<RecordingItem>();   // audio files are not part of the backup
        copy.MediaData = new Dictionary<string, string>();
        foreach (var o in copy.Objects.Where(o => o.Type == "image" && !string.IsNullOrEmpty(o.Media)))
        {
            var f = System.IO.Path.Combine(Store.MediaDir(_src.Key), o.Media);
            if (File.Exists(f)) copy.MediaData[o.Media] = Convert.ToBase64String(File.ReadAllBytes(f));
        }
        File.WriteAllText(dlg.FileName, Store.SerializeAnnotations(copy));
        SetStatus("주석 백업을 저장했습니다. (삽입한 사진 포함, 녹음 제외)");
    }

    public void RestoreAnnotations()
    {
        var dlg = new OpenFileDialog { Filter = "PDF Note 백업|*.json" };
        if (dlg.ShowDialog() != true) return;
        DocAnnotations restored;
        try { restored = Store.DeserializeAnnotations(File.ReadAllText(dlg.FileName)); }
        catch { restored = null; }
        if (restored == null) { MessageBox.Show("백업 파일을 읽을 수 없습니다.", "복원", MessageBoxButton.OK, MessageBoxImage.Warning); return; }
        int maxPage = new[]
        {
            restored.Ink.Keys.DefaultIfEmpty(0).Max(),
            restored.Highlights.Select(x => x.Page).DefaultIfEmpty(0).Max(),
            restored.Memos.Select(x => x.Page).DefaultIfEmpty(0).Max(),
            restored.Objects.Select(x => x.Page).DefaultIfEmpty(0).Max(),
            restored.Links.Select(x => x.Page).DefaultIfEmpty(0).Max()
        }.Max();
        if (maxPage >= _src.PageCount)
        {
            MessageBox.Show("백업의 페이지 범위가 이 문서보다 큽니다. 다른 문서의 백업일 수 있어 복원하지 않았습니다.",
                "복원", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (MessageBox.Show($"'{_src.Title}'의 현재 주석·노트를 백업 내용으로 교체합니다. 계속할까요?", "복원",
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        foreach (var kv in restored.MediaData)
        {
            try { File.WriteAllBytes(System.IO.Path.Combine(Store.MediaDir(_src.Key), System.IO.Path.GetFileName(kv.Key)), Convert.FromBase64String(kv.Value)); }
            catch (Exception ex) { Store.Log("restore media: " + ex.Message); }
        }
        restored.MediaData = new Dictionary<string, string>();
        restored.Recordings = _ann.Recordings;
        _ann = restored;
        _undo.Clear();
        _crop.Clear();
        _searchRects.Clear();
        MarkDirty();
        RefreshBookmarks(); RefreshNotes(); RefreshOutline(); RefreshRecs();
        _page = -1;
        GoToPage(Math.Clamp(_ann.LastPage, 0, _src.PageCount - 1));
        SetStatus("복원했습니다.");
    }

    // =====================================================================
    //  Keyboard
    // =====================================================================

    public bool HandleKey(KeyEventArgs e)
    {
        bool ctrl = Keyboard.Modifiers.HasFlag(ModifierKeys.Control);
        bool typing = Keyboard.FocusedElement is TextBox;

        if (ctrl)
        {
            switch (e.Key)
            {
                case Key.Z: if (typing) return false; Undo(); return true;
                case Key.Y: if (typing) return false; Redo(); return true;
                case Key.F: FocusSearch(); return true;
                case Key.G: FocusPageBox(); return true;
                case Key.V:
                    if (typing) return false;
                    if (Clipboard.ContainsImage()) { InsertClipboardImage(null); return true; }
                    return false;
                case Key.D0: case Key.NumPad0: FitWidth(); return true;
                case Key.OemPlus: case Key.Add: ApplyZoom(_zoom * 1.2); return true;
                case Key.OemMinus: case Key.Subtract: ApplyZoom(_zoom / 1.2); return true;
            }
            return false;
        }
        if (typing) return false;
        switch (e.Key)
        {
            case Key.PageDown: case Key.Right: NextPage(); return true;
            case Key.PageUp: case Key.Left: PrevPage(); return true;
            case Key.Home: GoToPage(0); return true;
            case Key.End: GoToPage(_src.PageCount - 1); return true;
            case Key.Escape: ClearTransient(); Tts.Stop(); SetMode(ToolMode.Read); return true;
            case Key.Down: Scroller.LineDown(); return true;
            case Key.Up: Scroller.LineUp(); return true;
        }
        return false;
    }
}
