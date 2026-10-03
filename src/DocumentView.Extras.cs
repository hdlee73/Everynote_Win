using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;

namespace PdfNote;

public partial class DocumentView
{
    // =====================================================================
    //  Typing (text boxes) + page objects
    // =====================================================================

    public bool IsRecording => _recorder?.IsRecording == true;

    void BuildTypingPanel()
    {
        foreach (var (_, name) in ObjStyle.Fonts) TFontBox.Items.Add(name);
        TFontBox.SelectedIndex = 0;
        foreach (var sz in ObjStyle.Sizes) TSizeBox.Items.Add(sz.ToString());
        TSizeBox.SelectedItem = "18";
        foreach (var hex in ObjStyle.TextColors)
        {
            var c = hex;
            TColorPanel.Children.Add(MakeColorBtn(c, () => { _tColor = c; ApplyFormatToLast(); }));
        }
    }

    void TFormat_Changed(object s, RoutedEventArgs e)
    {
        if (!_ready || _uiUpdating) return;
        if (TFontBox.SelectedIndex >= 0) _tFont = ObjStyle.Fonts[TFontBox.SelectedIndex].key;
        _tBold = TBoldBtn.IsChecked == true;
        _tItalic = TItalicBtn.IsChecked == true;
        if (TSizeBox.SelectedItem is string str && double.TryParse(str, out var sz)) _tSize = sz;
        ApplyFormatToLast();
    }

    void ApplyFormatToLast()
    {
        var c = _lastText;
        if (c == null || !ObjLayer.Children.Contains(c) || c.Model.Type != "text") return;
        var m = c.Model;
        m.Font = _tFont; m.Bold = _tBold; m.Italic = _tItalic; m.Size = _tSize; m.Color = _tColor;
        c.Refresh();
        MarkDirty();
        Dispatcher.BeginInvoke(() => c.FocusContent(), DispatcherPriority.Input);
    }

    void SyncTypingUi(ObjectItem m)
    {
        _uiUpdating = true;
        try
        {
            int fi = Array.FindIndex(ObjStyle.Fonts, f => f.key == m.Font);
            TFontBox.SelectedIndex = fi < 0 ? 0 : fi;
            TBoldBtn.IsChecked = m.Bold;
            TItalicBtn.IsChecked = m.Italic;
            TSizeBox.SelectedItem = ((int)Math.Round(m.Size)).ToString();
            _tFont = m.Font; _tBold = m.Bold; _tItalic = m.Italic; _tSize = m.Size; _tColor = m.Color;
        }
        finally { _uiUpdating = false; }
    }

    void RebuildObjects()
    {
        ObjLayer.Children.Clear();
        _lastText = null;
        foreach (var o in _ann.Objects.Where(x => x.Page == _page)) AddObjectControl(o);
    }

    ObjectControl AddObjectControl(ObjectItem o)
    {
        var c = new ObjectControl(o, _baseW, _baseH, _src.Key);
        Canvas.SetLeft(c, o.X * _baseW);
        Canvas.SetTop(c, o.Y * _baseH);
        c.Changed += () => { MarkDirty(); _notesDirty = true; };
        c.Moved += oc =>
        {
            double x = Math.Clamp(Canvas.GetLeft(oc), -20, _baseW - 30);
            double y = Math.Clamp(Canvas.GetTop(oc), -10, _baseH - 20);
            Canvas.SetLeft(oc, x); Canvas.SetTop(oc, y);
            oc.Model.X = x / _baseW; oc.Model.Y = y / _baseH;
            MarkDirty();
        };
        c.DeleteRequested += oc =>
        {
            _ann.Objects.Remove(oc.Model);
            ObjLayer.Children.Remove(oc);
            if (ReferenceEquals(_lastText, oc)) _lastText = null;
            MarkDirty(); _notesDirty = true;
        };
        c.LinkActivated += m => ActivateLink(m.Url, m.LinkPage);
        c.GotKeyboardFocus += (s, e) =>
        {
            if (c.Model.Type == "text") { _lastText = c; SyncTypingUi(c.Model); }
        };
        ObjLayer.Children.Add(c);
        return c;
    }

    ObjectControl AddObject(ObjectItem o)
    {
        o.Page = _page;
        _ann.Objects.Add(o);
        MarkDirty(); _notesDirty = true;
        return AddObjectControl(o);
    }

    void PruneEmptyTexts(bool ignoreFocus = false)
    {
        var dead = ObjLayer.Children.OfType<ObjectControl>()
            .Where(c => c.Model.Type == "text" && string.IsNullOrWhiteSpace(c.Model.Text) &&
                        (ignoreFocus || !c.IsKeyboardFocusWithin)).ToList();
        foreach (var c in dead)
        {
            _ann.Objects.Remove(c.Model);
            ObjLayer.Children.Remove(c);
            if (ReferenceEquals(_lastText, c)) _lastText = null;
        }
        // objects of other pages with empty text (e.g. after quick page change)
        _ann.Objects.RemoveAll(o => o.Type == "text" && string.IsNullOrWhiteSpace(o.Text) &&
                                    !ObjLayer.Children.OfType<ObjectControl>().Any(c => c.Model == o));
        if (dead.Count > 0) MarkDirty();
    }

    void AddTextAt(Point p)
    {
        PruneEmptyTexts(true);
        var o = new ObjectItem
        {
            Type = "text",
            X = Math.Clamp(p.X / _baseW, 0, 0.9), Y = Math.Clamp(p.Y / _baseH, 0, 0.95),
            W = 0.36, H = 0.05,
            Font = _tFont, Bold = _tBold, Italic = _tItalic, Size = _tSize, Color = _tColor
        };
        var c = AddObject(o);
        _lastText = c;
        Dispatcher.BeginInvoke(() => c.FocusContent(), DispatcherPriority.Input);
    }

    Point ViewCenterInPage()
    {
        try
        {
            var pt = Scroller.TranslatePoint(new Point(Scroller.ViewportWidth / 2, Scroller.ViewportHeight / 3), PageGrid);
            return new Point(Math.Clamp(pt.X, 0, _baseW), Math.Clamp(pt.Y, 0, _baseH));
        }
        catch { return new Point(_baseW / 3, _baseH / 3); }
    }

    void Insert_Click(object s, RoutedEventArgs e) => ShowInsertMenu(ViewCenterInPage(), InsertBtn);

    void ShowInsertMenu(Point p, UIElement target = null)
    {
        var menu = new ContextMenu();
        if (target != null)
        {
            menu.PlacementTarget = target;
            menu.Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom;
        }
        else menu.Placement = System.Windows.Controls.Primitives.PlacementMode.MousePoint;

        MenuItem Item(string h, Action a)
        {
            var mi = new MenuItem { Header = h };
            mi.Click += (s, e) => a();
            return mi;
        }
        double X(double w) => Math.Clamp((p.X - w * _baseW / 2) / _baseW, 0, 1 - w);
        double Y(double h) => Math.Clamp((p.Y - h * _baseH / 2) / _baseH, 0, 1 - h);

        menu.Items.Add(Item("텍스트 상자", () => { SetMode(ToolMode.Typing); AddTextAt(p); }));
        menu.Items.Add(Item("이미지…", () => InsertImageDialog(p)));
        if (Clipboard.ContainsImage()) menu.Items.Add(Item("클립보드 이미지 붙여넣기", () => InsertClipboardImage(p)));

        var st = new MenuItem { Header = "스티커" };
        foreach (var (group, items) in ObjStyle.Stickers)
        {
            var g = new MenuItem { Header = group };
            var wrap = new WrapPanel { Width = 240 };
            foreach (var em in items)
            {
                var emoji = em;
                var b = new Button
                {
                    Content = emoji, FontSize = 22, Width = 38, Height = 38, Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0), Cursor = Cursors.Hand
                };
                b.Click += (s, e) =>
                {
                    menu.IsOpen = false;
                    double w = 0.12, h = w * _baseW / _baseH;
                    AddObject(new ObjectItem { Type = "sticker", Text = emoji, X = X(w), Y = Y(h), W = w, H = h });
                    SetMode(ToolMode.Read);
                };
                wrap.Children.Add(b);
            }
            g.Items.Add(new MenuItem { Header = wrap, StaysOpenOnClick = true, Focusable = false });
            st.Items.Add(g);
        }
        menu.Items.Add(st);

        var sh = new MenuItem { Header = "도형" };
        foreach (var (key, name) in ObjStyle.ShapeKinds)
        {
            var k = key;
            sh.Items.Add(Item(name, () =>
            {
                bool lineLike = k is "line" or "arrow";
                double w = 0.25, h = lineLike ? 0.04 : 0.15;
                AddObject(new ObjectItem
                {
                    Type = "shape", Shape = k, X = X(w), Y = Y(h), W = w, H = h, Color = "#E53935", Thick = 3
                });
                SetMode(ToolMode.Read);
            }));
        }
        menu.Items.Add(sh);

        var tb = new MenuItem { Header = "표" };
        foreach (var (r, c) in new[] { (2, 2), (3, 3), (3, 4), (4, 4), (5, 3), (6, 4) })
        {
            int rows = r, cols = c;
            tb.Items.Add(Item($"{rows} × {cols}", () =>
            {
                double w = 0.6;
                AddObject(new ObjectItem
                {
                    Type = "table", Rows = rows, Cols = cols, X = X(w), Y = Y(0.04 * rows), W = w, H = 0.04 * rows,
                    Size = 14, Color = "#111111", Thick = 1
                });
                SetMode(ToolMode.Read);
            }));
        }
        menu.Items.Add(tb);

        menu.Items.Add(Item("링크…", () =>
        {
            var input = Dialogs.Prompt(Window.GetWindow(this), "링크 넣기", "웹 주소 또는 이동할 페이지 번호");
            if (string.IsNullOrWhiteSpace(input)) return;
            var title = Dialogs.Prompt(Window.GetWindow(this), "링크 이름", "표시할 이름 (비워 두면 주소 표시)") ?? "";
            ObjectControl.ParseTarget(input, out var url, out var page);
            double w = 0.3, h = 0.04;
            AddObject(new ObjectItem
            {
                Type = "link", Text = title.Trim(), Url = url, LinkPage = page, X = X(w), Y = Y(h), W = w, H = h,
                Size = 16, Color = "#1565C0"
            });
            SetMode(ToolMode.Read);
        }));
        menu.IsOpen = true;
    }

    // ---- images ----

    void InsertImageDialog(Point p)
    {
        var dlg = new OpenFileDialog
        {
            Title = "이미지 삽입",
            Filter = "이미지|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.webp;*.tif;*.tiff|모든 파일|*.*"
        };
        if (dlg.ShowDialog(Window.GetWindow(this)) == true) InsertImageFile(dlg.FileName, p);
    }

    public void InsertImageFile(string path, Point? at = null)
    {
        if (_src == null) return;
        try
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext.Length == 0 || ext.Length > 6) ext = ".png";
            string name = Guid.NewGuid().ToString("N") + ext;
            File.Copy(path, Path.Combine(Store.MediaDir(_src.Key), name), true);
            var fr = BitmapFrame.Create(new Uri(path), BitmapCreateOptions.DelayCreation, BitmapCacheOption.None);
            PlaceImage(name, fr.PixelWidth, fr.PixelHeight, at);
        }
        catch (Exception ex)
        {
            Store.Log("InsertImage: " + ex.Message);
            SetStatus("이미지를 넣을 수 없습니다: " + ex.Message, 6000);
        }
    }

    void InsertClipboardImage(Point? at)
    {
        if (_src == null) return;
        try
        {
            var img = Clipboard.GetImage();
            if (img == null) return;
            string name = Guid.NewGuid().ToString("N") + ".png";
            using (var fs = File.Create(Path.Combine(Store.MediaDir(_src.Key), name)))
            {
                var enc = new PngBitmapEncoder();
                enc.Frames.Add(BitmapFrame.Create(img));
                enc.Save(fs);
            }
            PlaceImage(name, img.PixelWidth, img.PixelHeight, at);
        }
        catch (Exception ex) { Store.Log("Paste image: " + ex.Message); SetStatus("붙여넣기 실패: " + ex.Message, 5000); }
    }

    void PlaceImage(string mediaName, int pw, int ph, Point? at)
    {
        var p = at ?? ViewCenterInPage();
        double w = Math.Min(0.5, Math.Max(0.12, pw / _baseW * 0.5));
        if (pw <= 0 || ph <= 0) { pw = 4; ph = 3; }
        double h = w * _baseW * ph / pw / _baseH;
        if (h > 0.8) { h = 0.8; w = h * _baseH * pw / ph / _baseW; }
        double x = Math.Clamp((p.X / _baseW) - w / 2, 0, Math.Max(0, 1 - w));
        double y = Math.Clamp((p.Y / _baseH) - h / 2, 0, Math.Max(0, 1 - h));
        AddObject(new ObjectItem { Type = "image", Media = mediaName, X = x, Y = y, W = w, H = h });
        SetMode(ToolMode.Read);
    }

    // ---- long press in Read mode -> insert menu ----

    void Host_PreviewMouseDown(object s, MouseButtonEventArgs e)
    {
        if (_mode != ToolMode.Read || _src == null) return;
        if (e.OriginalSource is DependencyObject d && (IsInside<ObjectControl>(d) || IsInside<MemoControl>(d))) return;
        _lpStart = e.GetPosition(Scroller);
        _lpPos = e.GetPosition(PageGrid);
        _lpTimer.Stop();
        _lpTimer.Start();
    }

    void Host_PreviewMouseMove(object s, MouseEventArgs e)
    {
        if (!_lpTimer.IsEnabled) return;
        var p = e.GetPosition(Scroller);
        if (Math.Abs(p.X - _lpStart.X) > 8 || Math.Abs(p.Y - _lpStart.Y) > 8) _lpTimer.Stop();
    }

    void Host_PreviewMouseUp(object s, MouseButtonEventArgs e) => _lpTimer.Stop();

    static bool IsInside<T>(DependencyObject d) where T : DependencyObject
    {
        while (d != null)
        {
            if (d is T) return true;
            d = d is Visual || d is System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(d) : LogicalTreeHelper.GetParent(d);
        }
        return false;
    }

    // =====================================================================
    //  Page thumbnails, add / delete page (notebooks)
    // =====================================================================

    void RebuildThumbs()
    {
        _thumbs.Clear();
        if (_src == null) return;
        for (int i = 0; i < _src.PageCount; i++) _thumbs.Add(new ThumbItem(_src, i));
        PageTotal.Text = " / " + _src.PageCount;
        _thumbView.Refresh();
    }

    void ThumbFilter_Changed(object s, RoutedEventArgs e)
    {
        if (!_ready) return;
        _bmOnly = ThumbBmOnly.IsChecked == true;
        _thumbView.Refresh();
        UpdateNavUi();
    }

    void ShiftPages(int from, int delta)
    {
        int Map(int p) => p >= from ? p + delta : p;
        _ann.Ink = _ann.Ink.ToDictionary(kv => Map(kv.Key), kv => kv.Value);
        foreach (var h in _ann.Highlights) h.Page = Map(h.Page);
        foreach (var m in _ann.Memos) m.Page = Map(m.Page);
        foreach (var o in _ann.Objects) o.Page = Map(o.Page);
        foreach (var l in _ann.Links) l.Page = Map(l.Page);
        foreach (var r in _ann.Recordings) r.Page = Map(r.Page);
        foreach (var o in _ann.Outline) o.Page = Map(o.Page);
        _ann.Bookmarks = _ann.Bookmarks.Select(Map).ToList();
        _crop.Clear();
        _undo.Clear();
        _cache.Clear(); _cacheOrder.Clear();
    }

    void RemovePageData(int d)
    {
        _ann.Ink.Remove(d);
        _ann.Highlights.RemoveAll(x => x.Page == d);
        _ann.Memos.RemoveAll(x => x.Page == d);
        _ann.Objects.RemoveAll(x => x.Page == d);
        _ann.Links.RemoveAll(x => x.Page == d);
        _ann.Outline.RemoveAll(x => x.Page == d);
        _ann.Bookmarks.RemoveAll(x => x == d);
        foreach (var r in _ann.Recordings.Where(x => x.Page == d).ToList())
        {
            try { File.Delete(Path.Combine(Store.AudioDir(_src.Key), r.File)); } catch { }
            _ann.Recordings.Remove(r);
        }
    }

    void AddPage_Click(object s, RoutedEventArgs e)
    {
        if (_src is not NotebookSource nb) return;
        CommitInk();
        int at = _page + 1;
        ShiftPages(at, +1);
        nb.Meta.Pages++;
        nb.Save();
        MarkDirty();
        RebuildThumbs();
        GoToPage(at);
        RefreshBookmarks(); RefreshNotes(); RefreshOutline(); RefreshRecs();
    }

    void DelPage_Click(object s, RoutedEventArgs e)
    {
        if (_src is not NotebookSource nb) return;
        if (nb.PageCount <= 1) { SetStatus("마지막 한 페이지는 삭제할 수 없습니다."); return; }
        if (MessageBox.Show(Window.GetWindow(this), $"{_page + 1}페이지를 삭제할까요? 이 페이지의 필기·메모·녹음도 함께 지워집니다.",
                "페이지 삭제", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        int d = _page;
        _inkDirty = false;
        RemovePageData(d);
        ShiftPages(d + 1, -1);
        nb.Meta.Pages--;
        nb.Save();
        MarkDirty();
        RebuildThumbs();
        _page = -1;
        GoToPage(Math.Min(d, nb.PageCount - 1));
        RefreshBookmarks(); RefreshNotes(); RefreshOutline(); RefreshRecs();
    }

    // =====================================================================
    //  Voice recording
    // =====================================================================

    void RefreshRecs()
    {
        _recs.Clear();
        foreach (var r in _ann.Recordings.OrderBy(x => x.Page)) _recs.Add(r);
    }

    async void Rec_Click(object s, RoutedEventArgs e)
    {
        if (_src == null) return;
        if (_recorder?.IsRecording == true) { await StopRecordingAsync(); return; }
        try
        {
            _recId = Guid.NewGuid().ToString("N");
            _recFile = _recId + ".m4a";
            _recPage = _page;
            _recorder = new AudioRecorder();
            RecBtn.IsEnabled = false;
            await _recorder.StartAsync(Path.Combine(Store.AudioDir(_src.Key), _recFile));
            _recStart = DateTime.Now;
            _recTimer.Start();
            RecBtn.Content = "■ 녹음 중지";
            RecStatus.Text = "녹음 중…";
        }
        catch (Exception ex)
        {
            Store.Log("Rec start: " + ex.Message);
            _recorder = null;
            RecStatus.Text = "";
            SetStatus("녹음을 시작할 수 없습니다. 설정 → 개인 정보 → 마이크에서 데스크톱 앱의 마이크 사용을 허용하세요.", 8000);
        }
        finally { RecBtn.IsEnabled = true; }
    }

    public async Task StopRecordingAsync()
    {
        if (_recorder == null || !_recorder.IsRecording) return;
        _recTimer.Stop();
        double secs = 0;
        try { secs = await _recorder.StopAsync(); }
        catch (Exception ex) { Store.Log("Rec stop: " + ex.Message); }
        _recorder = null;
        RecBtn.Content = "● 녹음 시작";
        RecStatus.Text = "";
        string path = Path.Combine(Store.AudioDir(_src.Key), _recFile);
        if (!File.Exists(path) || new FileInfo(path).Length == 0) { SetStatus("녹음된 내용이 없습니다."); return; }
        _ann.Recordings.Add(new RecordingItem
        {
            Id = _recId, Page = _recPage, Seconds = secs, File = _recFile,
            Name = "녹음 " + DateTime.Now.ToString("MM-dd HH:mm")
        });
        MarkDirty();
        RefreshRecs();
        SetStatus("녹음을 저장했습니다.");
    }

    void PlayRec(RecordingItem r)
    {
        if (r == null) return;
        string path = Path.Combine(Store.AudioDir(_src.Key), r.File);
        if (!File.Exists(path)) { SetStatus("녹음 파일을 찾을 수 없습니다."); return; }
        _player ??= new MediaPlayer();
        _player.Open(new Uri(path));
        _player.Play();
    }

    void RecPlay_Click(object s, RoutedEventArgs e) => PlayRec(RecList.SelectedItem as RecordingItem);
    void RecStop_Click(object s, RoutedEventArgs e) { try { _player?.Stop(); } catch { } }

    void RecList_DoubleClick(object s, MouseButtonEventArgs e)
    {
        if (RecList.SelectedItem is not RecordingItem r) return;
        if (r.Page != _page) GoToPage(r.Page);
        PlayRec(r);
    }

    void RecDelete_Click(object s, RoutedEventArgs e)
    {
        if (RecList.SelectedItem is not RecordingItem r) return;
        if (MessageBox.Show(Window.GetWindow(this), "선택한 녹음을 삭제할까요?", "녹음 삭제",
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        try { _player?.Close(); } catch { }
        try { File.Delete(Path.Combine(Store.AudioDir(_src.Key), r.File)); } catch { }
        _ann.Recordings.Remove(r);
        MarkDirty();
        RefreshRecs();
    }
}
