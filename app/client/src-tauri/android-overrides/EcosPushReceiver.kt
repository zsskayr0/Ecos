package app.ecos.client

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import org.unifiedpush.android.connector.MessagingReceiver

/**
 * Avisos do servidor Ecos por UnifiedPush (o distribuidor, como o ntfy, entrega aqui mesmo com o app fechado).
 *
 * - `onNewEndpoint`: o distribuidor deu (ou trocou) o endereço deste aparelho. Fica guardado; o front envia ao
 *   servidor (`PUT /notificacoes/aparelho`) na próxima vez que estiver aberto, porque só ele tem a sessão.
 * - `onMessage`: o JSON do servidor (`id`, `titulo`, `corpo`, `categoria`, `url`) vira uma notificação do Android.
 *   Tocar nela abre o app na rota `url` e marca o aviso como lido (ver [PushBridge]).
 */
class EcosPushReceiver : MessagingReceiver() {
    override fun onNewEndpoint(context: Context, endpoint: String, instance: String) {
        PushBridge.guardarEndpoint(context, endpoint)
    }

    override fun onUnregistered(context: Context, instance: String) {
        PushBridge.guardarEndpoint(context, null)
    }

    override fun onRegistrationFailed(context: Context, instance: String) {
        PushBridge.guardarEndpoint(context, null)
    }

    override fun onMessage(context: Context, message: ByteArray, instance: String) {
        val json = try { JSONObject(String(message, Charsets.UTF_8)) } catch (_: Exception) { return }
        val id = json.optString("id")
        val titulo = json.optString("titulo").ifBlank { "Ecos" }
        val corpo = json.optString("corpo")
        val url = json.optString("url").takeIf { it.isNotBlank() && it != "null" }
        mostrar(context, id, titulo, corpo, url)
    }

    private fun mostrar(context: Context, id: String, titulo: String, corpo: String, url: String?) {
        criarCanal(context)
        val abrir = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(PushBridge.EXTRA_ID, id)
            if (url != null) putExtra(PushBridge.EXTRA_URL, url)
        }
        // O mesmo aviso (mesmo id) substitui o anterior em vez de empilhar.
        val codigo = if (id.isNotBlank()) id.hashCode() else System.currentTimeMillis().toInt()
        val pendente = PendingIntent.getActivity(context, codigo, abrir, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val aviso = NotificationCompat.Builder(context, CANAL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(titulo)
            .setContentText(corpo)
            .setStyle(NotificationCompat.BigTextStyle().bigText(corpo))
            .setContentIntent(pendente)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(codigo, aviso)
        } catch (_: SecurityException) {
            // Sem a permissão de notificações (Android 13+): o aviso continua na caixa do app.
        }
    }

    companion object {
        const val CANAL = "avisos"

        fun criarCanal(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val gerente = context.getSystemService(NotificationManager::class.java) ?: return
            if (gerente.getNotificationChannel(CANAL) != null) return
            gerente.createNotificationChannel(NotificationChannel(CANAL, "Avisos do Ecos", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Prazos, início de tarefas, equipes e sincronização."
            })
        }
    }
}
