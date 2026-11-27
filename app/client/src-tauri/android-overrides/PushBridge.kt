package app.ecos.client

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.UnifiedPush
import java.util.UUID

/**
 * Ponte do push para o front (`window.EcosPush`). O registro é pelo UnifiedPush: a pessoa instala um distribuidor
 * (ntfy etc.), escolhe ele aqui e o distribuidor devolve um endereço ([EcosPushReceiver.onNewEndpoint]). O front
 * lê o endereço e o manda ao servidor; quando ele muda, o evento `ecos:push-endpoint` avisa o front.
 *
 * Tocar numa notificação abre a `MainActivity` com [EXTRA_URL]/[EXTRA_ID]; a ponte guarda o pedido e avisa o front
 * (`ecos:abrir-aviso`), que navega e marca o aviso como lido. Com o app fechado, o front busca o pedido em
 * [avisoPendente] ao iniciar.
 */
class PushBridge(private val activity: Activity) {
    private var webView: WebView? = null
    private var aviso: JSONObject? = null

    fun anexar(webView: WebView) {
        this.webView = webView
        atual = this
    }

    /** Chamado pela `MainActivity` na abertura e a cada nova intent. */
    fun receber(intent: Intent?) {
        val id = intent?.getStringExtra(EXTRA_ID) ?: return
        aviso = JSONObject().put("id", id).put("url", intent.getStringExtra(EXTRA_URL) ?: JSONObject.NULL)
        intent.removeExtra(EXTRA_ID)
        webView?.post { webView?.evaluateJavascript("window.dispatchEvent(new Event('ecos:abrir-aviso'))", null) }
    }

    @JavascriptInterface
    fun avisoPendente(): String {
        val a = aviso ?: return ""
        aviso = null
        return a.toString()
    }

    /** Distribuidores instalados: `[{pacote, nome}]`. */
    @JavascriptInterface
    fun distribuidores(): String {
        val pm = activity.packageManager
        val lista = JSONArray()
        for (pacote in UnifiedPush.getDistributors(activity)) {
            val nome = try { pm.getApplicationLabel(pm.getApplicationInfo(pacote, 0)).toString() } catch (_: Exception) { pacote }
            lista.put(JSONObject().put("pacote", pacote).put("nome", nome))
        }
        return lista.toString()
    }

    /** Estado: `{distribuidor, endpoint, instalacao, permissao}`. */
    @JavascriptInterface
    fun estado(): String = JSONObject()
        .put("distribuidor", UnifiedPush.getAckDistributor(activity) ?: JSONObject.NULL)
        .put("endpoint", prefs(activity).getString(CHAVE_ENDPOINT, null) ?: JSONObject.NULL)
        .put("instalacao", instalacao(activity))
        .put("permissao", temPermissao())
        .toString()

    @JavascriptInterface
    fun registrar(pacote: String) {
        pedirPermissao()
        UnifiedPush.saveDistributor(activity, pacote)
        UnifiedPush.registerApp(activity)
    }

    @JavascriptInterface
    fun desligar() {
        UnifiedPush.unregisterApp(activity)
        guardarEndpoint(activity, null)
    }

    private fun temPermissao() = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun pedirPermissao() {
        if (!temPermissao()) activity.runOnUiThread { ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4090) }
    }

    companion object {
        const val EXTRA_ID = "ecos_aviso_id"
        const val EXTRA_URL = "ecos_aviso_url"
        private const val CHAVE_ENDPOINT = "endpoint"
        private const val CHAVE_INSTALACAO = "instalacao"

        /** Ponte viva (app aberto), para avisar o front quando o endereço muda. */
        @Volatile private var atual: PushBridge? = null

        private fun prefs(context: Context) = context.getSharedPreferences("ecos_push", Context.MODE_PRIVATE)

        /** Identificador desta instalação, criado uma vez; o servidor usa para não duplicar o aparelho. */
        fun instalacao(context: Context): String {
            val p = prefs(context)
            return p.getString(CHAVE_INSTALACAO, null) ?: UUID.randomUUID().toString().also { p.edit().putString(CHAVE_INSTALACAO, it).apply() }
        }

        fun guardarEndpoint(context: Context, endpoint: String?) {
            prefs(context).edit().apply { if (endpoint == null) remove(CHAVE_ENDPOINT) else putString(CHAVE_ENDPOINT, endpoint) }.apply()
            atual?.webView?.let { w -> w.post { w.evaluateJavascript("window.dispatchEvent(new Event('ecos:push-endpoint'))", null) } }
        }
    }
}
