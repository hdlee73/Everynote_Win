using System.IO;
using System.Windows;
using System.Windows.Controls;

namespace PdfNote;

public static class Dialogs
{
    public static string Prompt(Window owner, string title, string label, string initial = "", bool multiline = false)
    {
        var win = new Window
        {
            Title = title, Owner = owner, WindowStartupLocation = WindowStartupLocation.CenterOwner,
            SizeToContent = SizeToContent.Height, Width = 420, ResizeMode = ResizeMode.NoResize,
            ShowInTaskbar = false, FontFamily = new System.Windows.Media.FontFamily("Segoe UI, Malgun Gothic")
        };
        var sp = new StackPanel { Margin = new Thickness(16) };
        sp.Children.Add(new TextBlock { Text = label, Margin = new Thickness(0, 0, 0, 6) });
        var tb = new TextBox
        {
            Text = initial, Padding = new Thickness(4), AcceptsReturn = multiline,
            TextWrapping = TextWrapping.Wrap, MinHeight = multiline ? 110 : 0,
            VerticalScrollBarVisibility = multiline ? ScrollBarVisibility.Auto : ScrollBarVisibility.Disabled
        };
        sp.Children.Add(tb);
        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 12, 0, 0) };
        var ok = new Button { Content = "확인", Width = 80, Padding = new Thickness(0, 4, 0, 4), IsDefault = !multiline };
        var cancel = new Button { Content = "취소", Width = 80, Padding = new Thickness(0, 4, 0, 4),
            Margin = new Thickness(8, 0, 0, 0), IsCancel = true };
        row.Children.Add(ok);
        row.Children.Add(cancel);
        sp.Children.Add(row);
        win.Content = sp;
        string result = null;
        ok.Click += (s, e) => { result = tb.Text; win.DialogResult = true; };
        win.Loaded += (s, e) => { tb.Focus(); tb.SelectAll(); };
        return win.ShowDialog() == true ? result : null;
    }

    static readonly (string name, string hex)[] PaperColors =
    {
        ("흰색", "#FFFFFF"), ("크림", "#FFF8E1"), ("연노랑", "#FFFDE7"),
        ("연초록", "#F1F8E9"), ("연파랑", "#E3F2FD"), ("연회색", "#ECEFF1")
    };

    public static NotebookMeta NewNote(Window owner)
    {
        var win = new Window
        {
            Title = "새 노트", Owner = owner, WindowStartupLocation = WindowStartupLocation.CenterOwner,
            SizeToContent = SizeToContent.Height, Width = 380, ResizeMode = ResizeMode.NoResize,
            ShowInTaskbar = false, FontFamily = new System.Windows.Media.FontFamily("Segoe UI, Malgun Gothic")
        };
        var sp = new StackPanel { Margin = new Thickness(16) };
        sp.Children.Add(new TextBlock { Text = "노트 이름" });
        var name = new TextBox { Text = "새 노트 " + DateTime.Now.ToString("MM-dd HH.mm"), Padding = new Thickness(4),
            Margin = new Thickness(0, 4, 0, 10) };
        sp.Children.Add(name);
        sp.Children.Add(new TextBlock { Text = "종이" });
        var paper = new ComboBox { Margin = new Thickness(0, 4, 0, 10) };
        paper.Items.Add("줄 노트"); paper.Items.Add("백지"); paper.Items.Add("모눈종이");
        paper.SelectedIndex = 0;
        sp.Children.Add(paper);
        sp.Children.Add(new TextBlock { Text = "배경색" });
        var color = new ComboBox { Margin = new Thickness(0, 4, 0, 4) };
        foreach (var c in PaperColors) color.Items.Add(c.name);
        color.SelectedIndex = 0;
        sp.Children.Add(color);
        sp.Children.Add(new TextBlock { Text = "페이지는 1장으로 시작하며, 마지막 장에서 넘기면 자동으로 추가됩니다.",
            Foreground = System.Windows.Media.Brushes.Gray, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) });
        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 14, 0, 0) };
        var ok = new Button { Content = "만들기", Width = 80, Padding = new Thickness(0, 4, 0, 4), IsDefault = true };
        var cancel = new Button { Content = "취소", Width = 80, Padding = new Thickness(0, 4, 0, 4),
            Margin = new Thickness(8, 0, 0, 0), IsCancel = true };
        row.Children.Add(ok); row.Children.Add(cancel);
        sp.Children.Add(row);
        win.Content = sp;
        NotebookMeta result = null;
        ok.Click += (s, e) =>
        {
            result = new NotebookMeta
            {
                Title = string.IsNullOrWhiteSpace(name.Text) ? "새 노트" : name.Text.Trim(),
                Paper = paper.SelectedIndex switch { 1 => "blank", 2 => "grid", _ => "lined" },
                Color = PaperColors[Math.Max(0, color.SelectedIndex)].hex,
                Pages = 1
            };
            win.DialogResult = true;
        };
        win.Loaded += (s, e) => { name.Focus(); name.SelectAll(); };
        return win.ShowDialog() == true ? result : null;
    }
}
