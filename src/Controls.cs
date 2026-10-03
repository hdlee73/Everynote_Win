using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Ink;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace PdfNote;

public static class InkIo
{
    public static string ToB64(StrokeCollection s)
    {
        using var ms = new MemoryStream();
        s.Save(ms);
        return Convert.ToBase64String(ms.ToArray());
    }

    public static StrokeCollection FromB64(string b64)
    {
        using var ms = new MemoryStream(Convert.FromBase64String(b64));
        return new StrokeCollection(ms);
    }
}

public class ThumbItem : INotifyPropertyChanged
{
    static readonly SemaphoreSlim Gate = new(2);
    readonly IPageSource _src;
    BitmapSource _img;
    bool _loading;

    public ThumbItem(IPageSource src, int index) { _src = src; Index = index; }
    public int Index { get; }
    public string Label => (Index + 1).ToString();
    public event PropertyChangedEventHandler PropertyChanged;

    public BitmapSource Image
    {
        get
        {
            if (_img == null && !_loading) { _loading = true; _ = LoadAsync(); }
            return _img;
        }
    }

    async Task LoadAsync()
    {
        await Gate.WaitAsync();
        try { _img = await _src.RenderAsync(Index, 150); }
        catch { }
        finally { Gate.Release(); }
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Image)));
    }
}

/// <summary>Draggable sticky note with minimize / delete.</summary>
public class MemoControl : Border
{
    public MemoItem Model { get; }
    public event Action Changed;
    public event Action<MemoControl> DeleteRequested;
    public event Action<MemoControl> Moved;

    readonly TextBox _tb;
    readonly TextBlock _title;
    readonly Border _header;
    bool _drag;
    Point _start, _orig;

    public MemoControl(MemoItem m)
    {
        Model = m;
        Width = 190;
        Background = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xFF, 0xF5, 0x9D));
        BorderBrush = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xC9, 0xB4, 0x00));
        BorderThickness = new Thickness(1);
        CornerRadius = new CornerRadius(3);

        var root = new StackPanel();
        _title = new TextBlock { Text = "메모", FontWeight = FontWeights.SemiBold, FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(6, 0, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis };

        var minBtn = MakeBtn("–", "접기/펼치기");
        var delBtn = MakeBtn("×", "삭제");
        var dock = new DockPanel { LastChildFill = true, Height = 22 };
        DockPanel.SetDock(delBtn, Dock.Right);
        DockPanel.SetDock(minBtn, Dock.Right);
        dock.Children.Add(delBtn);
        dock.Children.Add(minBtn);
        dock.Children.Add(_title);
        _header = new Border { Background = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xFF, 0xE8, 0x2E)),
            CornerRadius = new CornerRadius(3, 3, 0, 0), Cursor = Cursors.SizeAll, Child = dock };

        _tb = new TextBox
        {
            Text = m.Text, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap,
            Background = Brushes.Transparent, BorderThickness = new Thickness(0),
            MinHeight = 64, MaxHeight = 260, Padding = new Thickness(5, 3, 5, 3),
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto, FontSize = 13
        };
        root.Children.Add(_header);
        root.Children.Add(_tb);
        Child = root;

        _tb.TextChanged += (s, e) => { Model.Text = _tb.Text; UpdateTitle(); Changed?.Invoke(); };
        minBtn.Click += (s, e) => { Model.Minimized = !Model.Minimized; ApplyMin(); Changed?.Invoke(); };
        delBtn.Click += (s, e) => DeleteRequested?.Invoke(this);

        _header.MouseLeftButtonDown += (s, e) =>
        {
            if (Parent is not IInputElement p) return;
            _drag = true;
            _start = e.GetPosition(p);
            _orig = new Point(Canvas.GetLeft(this), Canvas.GetTop(this));
            _header.CaptureMouse();
            e.Handled = true;
        };
        _header.MouseMove += (s, e) =>
        {
            if (!_drag || Parent is not IInputElement p) return;
            var pos = e.GetPosition(p);
            Canvas.SetLeft(this, _orig.X + pos.X - _start.X);
            Canvas.SetTop(this, _orig.Y + pos.Y - _start.Y);
        };
        _header.MouseLeftButtonUp += (s, e) =>
        {
            if (!_drag) return;
            _drag = false;
            _header.ReleaseMouseCapture();
            Moved?.Invoke(this);
        };
        ApplyMin();
        UpdateTitle();
    }

    static Button MakeBtn(string text, string tip) => new()
    {
        Content = text, Width = 22, ToolTip = tip, Background = Brushes.Transparent,
        BorderThickness = new Thickness(0), Padding = new Thickness(0), FontWeight = FontWeights.Bold, Cursor = Cursors.Hand
    };

    void ApplyMin() => _tb.Visibility = Model.Minimized ? Visibility.Collapsed : Visibility.Visible;

    void UpdateTitle()
    {
        var t = (Model.Text ?? "").Replace('\n', ' ').Trim();
        _title.Text = t.Length == 0 ? "메모" : (t.Length > 14 ? t.Substring(0, 14) + "…" : t);
    }

    public void FocusText() { _tb.Focus(); Keyboard.Focus(_tb); }
}
