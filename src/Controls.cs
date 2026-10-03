using System.IO;
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

/// <summary>Draggable sticky note with minimize / delete and color, text size, box size options.</summary>
public class MemoControl : Border
{
    public static readonly string[] Colors = { "#FFF59D", "#F8BBD0", "#C8E6C9", "#BBDEFB", "#FFE0B2", "#E1BEE7", "#FFFFFF" };
    public static readonly double[] FontSizes = { 9, 10, 11, 12, 13, 14, 16, 18, 22, 28 };

    public static double WidthFor(string size) => size switch { "small" => 150, "large" => 270, _ => 190 };

    public MemoItem Model { get; }
    public event Action Changed;
    public event Action<MemoControl> DeleteRequested;
    public event Action<MemoControl> Moved;

    readonly TextBox _tb;
    readonly TextBlock _title;
    readonly Border _header;
    bool _drag;
    Point _start, _orig;

    static SolidColorBrush Br(string hex, double darken = 0)
    {
        var c = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hex);
        byte f(byte v) => (byte)Math.Clamp(v * (1 - darken), 0, 255);
        return new SolidColorBrush(System.Windows.Media.Color.FromRgb(f(c.R), f(c.G), f(c.B)));
    }

    public MemoControl(MemoItem m)
    {
        Model = m;
        CornerRadius = new CornerRadius(3);
        BorderThickness = new Thickness(1);

        var root = new StackPanel();
        _title = new TextBlock { Text = "메모", FontWeight = FontWeights.SemiBold, FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(6, 0, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis };

        var minBtn = MakeBtn("–", "접기/펼치기");
        var delBtn = MakeBtn("×", "삭제");
        var optBtn = MakeBtn("⋯", "색·크기 설정");
        var dock = new DockPanel { LastChildFill = true, Height = 22 };
        DockPanel.SetDock(delBtn, Dock.Right);
        DockPanel.SetDock(minBtn, Dock.Right);
        DockPanel.SetDock(optBtn, Dock.Right);
        dock.Children.Add(delBtn);
        dock.Children.Add(minBtn);
        dock.Children.Add(optBtn);
        dock.Children.Add(_title);
        _header = new Border { CornerRadius = new CornerRadius(3, 3, 0, 0), Cursor = Cursors.SizeAll, Child = dock };

        _tb = new TextBox
        {
            Text = m.Text, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap,
            Background = Brushes.Transparent, BorderThickness = new Thickness(0),
            MinHeight = 64, MaxHeight = 300, Padding = new Thickness(5, 3, 5, 3),
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        };
        root.Children.Add(_header);
        root.Children.Add(_tb);
        Child = root;
        ApplyStyle();

        _tb.TextChanged += (s, e) => { Model.Text = _tb.Text; UpdateTitle(); Changed?.Invoke(); };
        minBtn.Click += (s, e) => { Model.Minimized = !Model.Minimized; ApplyMin(); Changed?.Invoke(); };
        delBtn.Click += (s, e) => DeleteRequested?.Invoke(this);
        optBtn.Click += (s, e) => OpenOptions(optBtn);

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

    void ApplyStyle()
    {
        string color = string.IsNullOrEmpty(Model.Color) ? "#FFF59D" : Model.Color;
        Width = WidthFor(Model.Size);
        Background = Br(color);
        BorderBrush = Br(color, 0.35);
        _header.Background = Br(color, 0.08);
        _tb.FontSize = Model.FontSize < 8 ? 13 : Model.FontSize;
    }

    void OpenOptions(FrameworkElement target)
    {
        var menu = new ContextMenu { PlacementTarget = target, Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom };

        var colors = new MenuItem { Header = "색상" };
        foreach (var hex in Colors)
        {
            var c = hex;
            var mi = new MenuItem
            {
                Header = new System.Windows.Shapes.Rectangle { Width = 44, Height = 14, Fill = Br(c), Stroke = Brushes.Gray, StrokeThickness = 0.5 },
                IsChecked = string.Equals(Model.Color, c, StringComparison.OrdinalIgnoreCase)
            };
            mi.Click += (s, e) => { Model.Color = c; ApplyStyle(); Changed?.Invoke(); };
            colors.Items.Add(mi);
        }
        menu.Items.Add(colors);

        var sizes = new MenuItem { Header = "글자 크기" };
        foreach (var z in FontSizes)
        {
            var zz = z;
            var mi = new MenuItem { Header = $"{z:0}pt", IsChecked = Math.Abs(Model.FontSize - z) < 0.1 };
            mi.Click += (s, e) => { Model.FontSize = zz; ApplyStyle(); Changed?.Invoke(); };
            sizes.Items.Add(mi);
        }
        menu.Items.Add(sizes);

        var box = new MenuItem { Header = "메모 크기" };
        foreach (var (key, name) in new[] { ("small", "작게"), ("normal", "보통"), ("large", "크게") })
        {
            var k = key;
            var mi = new MenuItem { Header = name, IsChecked = Model.Size == k };
            mi.Click += (s, e) => { Model.Size = k; ApplyStyle(); Changed?.Invoke(); };
            box.Items.Add(mi);
        }
        menu.Items.Add(box);
        menu.IsOpen = true;
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
        _title.Text = t.Length == 0 ? "메모" : (t.Length > 12 ? t.Substring(0, 12) + "…" : t);
    }

    public void FocusText() { _tb.Focus(); Keyboard.Focus(_tb); }
}
