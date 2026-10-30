package games.upgames.apexgp;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.util.Locale;

// Voz del ingeniero y de la megafonía: el WebView de Android no trae speechSynthesis,
// así que el juego habla con el motor de voz del sistema a través de window.ApexVoz.
public class VozNativa implements TextToSpeech.OnInitListener {
    private final TextToSpeech tts;
    private final WebView web;
    private volatile boolean listo = false;

    VozNativa(Context ctx, WebView web) {
        this.web = web;
        this.tts = new TextToSpeech(ctx.getApplicationContext(), this);
    }

    @Override
    public void onInit(int estado) {
        if (estado != TextToSpeech.SUCCESS) return;
        int r = tts.setLanguage(new Locale("es", "ES"));
        if (r < 0) r = tts.setLanguage(new Locale("es"));
        if (r < 0) tts.setLanguage(Locale.getDefault());
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { }
            @Override public void onDone(String id) { avisar(id); }
            @Override public void onError(String id) { avisar(id); }
        });
        listo = true;
    }

    private void avisar(String id) {
        if (id == null || !id.matches("[a-z0-9]{1,16}")) return;
        web.post(() -> web.evaluateJavascript("window.__vozFin && window.__vozFin('" + id + "')", null));
    }

    @JavascriptInterface
    public boolean disponible() { return listo; }

    @JavascriptInterface
    public void hablar(String texto, String id, float velocidad, float tono) {
        if (!listo || texto == null) { avisar(id); return; }
        tts.setSpeechRate(Math.max(0.5f, Math.min(2f, velocidad)));
        tts.setPitch(Math.max(0.5f, Math.min(2f, tono)));
        Bundle b = new Bundle();
        tts.speak(texto.length() > 400 ? texto.substring(0, 400) : texto, TextToSpeech.QUEUE_FLUSH, b, id);
    }

    @JavascriptInterface
    public void callar() { if (listo) tts.stop(); }

    void cerrar() { tts.shutdown(); }
}
