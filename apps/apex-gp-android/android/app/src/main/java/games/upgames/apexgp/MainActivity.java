package games.upgames.apexgp;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

// Pantalla completa inmersiva, pantalla siempre encendida y audio sin esperar un toque.
// Además, voz nativa para la radio (window.ApexVoz) y guardado de fotos y vídeos (window.ApexArchivo).
public class MainActivity extends BridgeActivity {
    private VozNativa voz;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        WebView web = getBridge().getWebView();
        WebSettings ajustes = web.getSettings();
        ajustes.setMediaPlaybackRequiresUserGesture(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        voz = new VozNativa(this, web);
        web.addJavascriptInterface(voz, "ApexVoz");
        web.addJavascriptInterface(new ArchivoNativo(this), "ApexArchivo");
        modoInmersivo();
    }

    @Override
    public void onDestroy() {
        if (voz != null) voz.cerrar();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) modoInmersivo();
    }

    private void modoInmersivo() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
