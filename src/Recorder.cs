using System.IO;
using Windows.Media.Capture;
using Windows.Media.MediaProperties;
using Windows.Storage;

namespace PdfNote;

/// <summary>Records microphone audio to an .m4a file using the Windows media stack.</summary>
public sealed class AudioRecorder
{
    MediaCapture _cap;
    DateTime _start;
    public bool IsRecording { get; private set; }

    public async Task StartAsync(string path)
    {
        _cap = new MediaCapture();
        await _cap.InitializeAsync(new MediaCaptureInitializationSettings
        {
            StreamingCaptureMode = StreamingCaptureMode.Audio
        });
        File.WriteAllBytes(path, Array.Empty<byte>());
        var file = await StorageFile.GetFileFromPathAsync(path);
        await _cap.StartRecordToStorageFileAsync(MediaEncodingProfile.CreateM4a(AudioEncodingQuality.Medium), file);
        _start = DateTime.Now;
        IsRecording = true;
    }

    public async Task<double> StopAsync()
    {
        if (_cap == null) return 0;
        try { await _cap.StopRecordAsync(); }
        finally
        {
            IsRecording = false;
            _cap.Dispose();
            _cap = null;
        }
        return (DateTime.Now - _start).TotalSeconds;
    }
}
