package games.upgames.studio;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

// Guarda los archivos que exporta Studio en Descargas › UpGames Studio. La página los manda por
// trozos en base64: abrir(nombre, tipo) → id, escribir(id, base64)…, cerrar(id).
public class ArchivoNativo {
    private final Context ctx;
    private final Map<String, Pendiente> abiertos = new HashMap<>();
    private int n = 0;

    private static class Pendiente { File tmp; FileOutputStream salida; String nombre; String tipo; }

    ArchivoNativo(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    @JavascriptInterface
    public synchronized String abrir(String nombre, String tipo) {
        try {
            Pendiente p = new Pendiente();
            p.nombre = nombre.replaceAll("[^A-Za-z0-9._-]", "_");
            p.tipo = tipo == null || tipo.isEmpty() ? "application/octet-stream" : tipo.split(";")[0];
            p.tmp = File.createTempFile("studio", ".tmp", ctx.getCacheDir());
            p.salida = new FileOutputStream(p.tmp);
            String id = "s" + (++n);
            abiertos.put(id, p);
            return id;
        } catch (Exception e) { return ""; }
    }

    @JavascriptInterface
    public synchronized boolean escribir(String id, String base64) {
        Pendiente p = abiertos.get(id);
        if (p == null) return false;
        try { p.salida.write(Base64.decode(base64, Base64.DEFAULT)); return true; }
        catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public synchronized boolean cerrar(String id) {
        Pendiente p = abiertos.remove(id);
        if (p == null) return false;
        try {
            p.salida.close();
            String donde;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = ctx.getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, p.nombre);
                v.put(MediaStore.MediaColumns.MIME_TYPE, p.tipo);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/UpGames Studio");
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return false;
                try (InputStream in = new FileInputStream(p.tmp); OutputStream out = cr.openOutputStream(uri)) { copiar(in, out); }
                donde = "Descargas/UpGames Studio";
            } else {
                File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                File dest = new File(dir, p.nombre);
                try (InputStream in = new FileInputStream(p.tmp); OutputStream out = new FileOutputStream(dest)) { copiar(in, out); }
                donde = dest.getAbsolutePath();
            }
            p.tmp.delete();
            final String msg = p.nombre + " guardado en " + donde;
            new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show());
            return true;
        } catch (Exception e) { p.tmp.delete(); return false; }
    }

    private static void copiar(InputStream in, OutputStream out) throws java.io.IOException {
        byte[] b = new byte[64 * 1024];
        int k;
        while ((k = in.read(b)) > 0) out.write(b, 0, k);
    }
}
