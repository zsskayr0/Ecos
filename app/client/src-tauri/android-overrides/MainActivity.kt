package app.ecos.client

import android.content.Intent
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private val compartilhar by lazy { CompartilharBridge(applicationContext) }
  private val cofreSenha by lazy { CofreSenhaBridge(this) }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    compartilhar.receber(intent)
  }

  // `singleTask`: compartilhar de novo com o app já aberto chega aqui, não em onCreate.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    compartilhar.receber(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    compartilhar.anexar(webView)
    webView.addJavascriptInterface(compartilhar, "EcosCompartilhar")
    cofreSenha.anexar(webView)
    webView.addJavascriptInterface(cofreSenha, "EcosCofreSenha")
  }
}
