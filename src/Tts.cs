using System.Globalization;
using System.Speech.Synthesis;

namespace PdfNote;

/// <summary>Offline text-to-speech using the voices installed in Windows.</summary>
public static class Tts
{
    static SpeechSynthesizer _synth;

    public static List<string> Voices()
    {
        try
        {
            using var s = new SpeechSynthesizer();
            return s.GetInstalledVoices().Where(v => v.Enabled)
                .Select(v => v.VoiceInfo.Name).ToList();
        }
        catch { return new List<string>(); }
    }

    public static bool IsSpeaking => _synth != null && _synth.State == SynthesizerState.Speaking;

    public static void Stop() { try { _synth?.SpeakAsyncCancelAll(); } catch { } }

    public static void Speak(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        try
        {
            _synth ??= new SpeechSynthesizer();
            _synth.SpeakAsyncCancelAll();
            bool voiceSet = false;
            var wanted = Store.Settings.Voice;
            if (!string.IsNullOrEmpty(wanted))
            {
                try { _synth.SelectVoice(wanted); voiceSet = true; } catch { }
            }
            if (!voiceSet)
            {
                int hangul = text.Count(c => c >= 0xAC00 && c <= 0xD7A3);
                var culture = hangul > text.Length * 0.25 ? "ko-KR" : "en-US";
                try { _synth.SelectVoiceByHints(VoiceGender.NotSet, VoiceAge.NotSet, 0, new CultureInfo(culture)); }
                catch { }
            }
            _synth.SpeakAsync(text);
        }
        catch (Exception ex) { Store.Log("TTS: " + ex.Message); }
    }
}
