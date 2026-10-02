package app.ecos.client

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID

/**
 * Arquivos recebidos pelo menu "Compartilhar" do Android. Há dois destinos no menu: "Ecos" (imagens viram anexo de
 * uma nota) e "Ecos Cofre" (imagens e PDF viram comprovante; é o `activity-alias` [DESTINO_COFRE] do manifesto).
 *
 * A permissão de leitura do URI recebido é temporária, então cada imagem é copiada pro cache do app assim que a
 * intent chega. O front (WebView) pega a lista por `window.EcosCompartilhar` e lê os bytes em pedaços, pra não
 * passar uma imagem inteira de uma vez pela ponte JS. Imagens (e PDF, só para o Cofre), até [LIMITE_BYTES] cada. O limite de 8 MB do Cofre é conferido no front.
 */
class CompartilharBridge(private val contexto: Context) {
    private class Item(val id: String, val nome: String, val mime: String, val arquivo: File, val destino: String)

    private val pendentes = LinkedHashMap<String, Item>()
    private var webView: WebView? = null
    private val pasta: File get() = File(contexto.cacheDir, "compartilhados").also { it.mkdirs() }

    fun anexar(webView: WebView) { this.webView = webView }

    /** Chamado pela `MainActivity` na abertura e a cada nova intent (`singleTask`). */
    fun receber(intent: Intent?) {
        val uris = uris(intent)
        if (uris.isEmpty()) return
        // O alias do manifesto dá o nome do destino escolhido no menu; sem ele, é o "Ecos" comum (nota).
        val destino = if (intent?.component?.className?.endsWith(".$DESTINO_COFRE") == true) "cofre" else "nota"
        Thread {
            limparAntigos()
            var recebeu = false
            for (uri in uris) if (copiar(uri, destino)) recebeu = true
            if (recebeu) webView?.post { webView?.evaluateJavascript("window.dispatchEvent(new Event('ecos:compartilhado'))", null) }
        }.start()
    }

    @Suppress("DEPRECATION")
    private fun uris(intent: Intent?): List<Uri> {
        if (intent == null) return emptyList()
        val lista: List<Uri?> = when (intent.action) {
            Intent.ACTION_SEND -> listOf(
                if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            )
            Intent.ACTION_SEND_MULTIPLE ->
                (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)) ?: emptyList<Uri>()
            else -> emptyList()
        }
        return lista.filterNotNull()
    }

    private fun copiar(uri: Uri, destino: String): Boolean {
        return try {
            val mime = contexto.contentResolver.getType(uri) ?: return false
            val aceito = mime.startsWith("image/") || (destino == "cofre" && mime == "application/pdf")
            if (!aceito) return false
            val id = UUID.randomUUID().toString()
            val destinoArquivo = File(pasta, id)
            val leu = contexto.contentResolver.openInputStream(uri)?.use { entrada ->
                destinoArquivo.outputStream().use { saida ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val n = entrada.read(buffer)
                        if (n < 0) break
                        total += n
                        if (total > LIMITE_BYTES) return@use false
                        saida.write(buffer, 0, n)
                    }
                    true
                }
            } ?: false
            if (!leu || destinoArquivo.length() == 0L) { destinoArquivo.delete(); return false }
            synchronized(pendentes) { pendentes[id] = Item(id, nomeDe(uri, mime), mime, destinoArquivo, destino) }
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun nomeDe(uri: Uri, mime: String): String {
        val nome = try {
            contexto.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0) else null
            }
        } catch (e: Exception) { null }
        if (!nome.isNullOrBlank()) return nome
        if (mime == "application/pdf") return "comprovante.pdf"
        return "imagem." + mime.substringAfter('/').substringBefore('+').ifBlank { "jpg" }
    }

    private fun limparAntigos() {
        val limite = System.currentTimeMillis() - 24L * 60 * 60 * 1000
        pasta.listFiles()?.forEach { f ->
            if (f.lastModified() < limite && synchronized(pendentes) { pendentes.values.none { it.arquivo == f } }) f.delete()
        }
    }

    /** JSON `[{id, nome, mime, tamanho, destino}]` dos arquivos à espera; `destino` é "nota" ou "cofre". */
    @JavascriptInterface
    fun pendentes(): String {
        val arr = JSONArray()
        synchronized(pendentes) {
            for (i in pendentes.values) arr.put(JSONObject().put("id", i.id).put("nome", i.nome).put("mime", i.mime).put("tamanho", i.arquivo.length()).put("destino", i.destino))
        }
        return arr.toString()
    }

    /** Um pedaço do arquivo em Base64 (sem quebras de linha). */
    @JavascriptInterface
    fun parte(id: String, inicio: Int, tamanho: Int): String {
        val item = synchronized(pendentes) { pendentes[id] } ?: return ""
        if (tamanho <= 0 || tamanho > 2 * 1024 * 1024) return ""
        return try {
            RandomAccessFile(item.arquivo, "r").use { f ->
                if (inicio < 0 || inicio >= f.length()) return ""
                f.seek(inicio.toLong())
                val bytes = ByteArray(minOf(tamanho.toLong(), f.length() - inicio).toInt())
                f.readFully(bytes)
                Base64.encodeToString(bytes, Base64.NO_WRAP)
            }
        } catch (e: Exception) { "" }
    }

    /** O front já tem os bytes (ou desistiu): apaga a cópia. */
    @JavascriptInterface
    fun descartar(id: String) {
        val item = synchronized(pendentes) { pendentes.remove(id) } ?: return
        item.arquivo.delete()
    }

    companion object {
        const val LIMITE_BYTES = 40L * 1024 * 1024
        /** Nome do `activity-alias` do manifesto que representa "Ecos Cofre" no menu Compartilhar. */
        const val DESTINO_COFRE = "CompartilharCofre"
    }
}
