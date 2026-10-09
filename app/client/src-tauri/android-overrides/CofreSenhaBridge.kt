package app.ecos.client

import android.app.Activity
import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

/**
 * "Lembrar a senha do Cofre neste aparelho" (equivalente ao Gerenciador de Credenciais do Windows).
 *
 * A senha é cifrada com uma chave AES-GCM que nasce e fica dentro do Android Keystore (hardware do aparelho) e só
 * é liberada a cada uso por biometria forte ou, a partir do Android 11, pelo PIN/padrão do aparelho. O texto cifrado
 * fica em SharedPreferences privado do app; sem a biometria, ele não vale nada. Cadastrar uma digital nova invalida a
 * chave (a pessoa digita a senha uma vez e lembra de novo). Os resultados voltam ao front em
 * `window.__ecosCofreSenha(pedido, json)`, porque a confirmação biométrica é assíncrona.
 *
 * Usa a API de framework (`android.hardware.biometrics`, Android 9+; confirmação por PIN só no 11+) para não
 * precisar de dependência nova no Gradle; em aparelhos mais antigos o recurso simplesmente não é oferecido.
 */
class CofreSenhaBridge(private val atividade: Activity) {
    private var webView: WebView? = null
    private val prefs get() = atividade.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun anexar(webView: WebView) { this.webView = webView }

    @JavascriptInterface
    fun suportado(): Boolean {
        if (Build.VERSION.SDK_INT < 29) return false
        val gerente = atividade.getSystemService(BiometricManager::class.java) ?: return false
        val resultado = if (Build.VERSION.SDK_INT >= 30) gerente.canAuthenticate(AUTENTICADORES) else gerente.canAuthenticate()
        return resultado == BiometricManager.BIOMETRIC_SUCCESS
    }

    @JavascriptInterface
    fun tem(chave: String): Boolean = prefs.contains(chave)

    @JavascriptInterface
    fun esquecer(chave: String) { prefs.edit().remove(chave).apply() }

    @JavascriptInterface
    fun salvar(pedido: Int, chave: String, senha: String) {
        if (chave.isBlank() || senha.isEmpty() || senha.length > 512) return responder(pedido, "erro")
        atividade.runOnUiThread {
            try {
                val cifra = Cipher.getInstance(TRANSFORMACAO).apply { init(Cipher.ENCRYPT_MODE, obterChave()) }
                confirmar(pedido, cifra) { c ->
                    c.updateAAD(chave.toByteArray())
                    val cifrado = c.doFinal(senha.toByteArray())
                    val valor = Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(cifrado, Base64.NO_WRAP)
                    prefs.edit().putString(chave, valor).apply()
                    null
                }
            } catch (e: Exception) { responder(pedido, "erro") }
        }
    }

    @JavascriptInterface
    fun ler(pedido: Int, chave: String) {
        val guardado = prefs.getString(chave, null) ?: return responder(pedido, "vazio")
        val partes = guardado.split(":")
        if (partes.size != 2) return responder(pedido, "erro")
        atividade.runOnUiThread {
            try {
                val iv = Base64.decode(partes[0], Base64.NO_WRAP)
                val cifrado = Base64.decode(partes[1], Base64.NO_WRAP)
                val cifra = Cipher.getInstance(TRANSFORMACAO).apply { init(Cipher.DECRYPT_MODE, obterChave(), GCMParameterSpec(128, iv)) }
                confirmar(pedido, cifra) { c ->
                    c.updateAAD(chave.toByteArray())
                    String(c.doFinal(cifrado))
                }
            } catch (e: KeyPermanentlyInvalidatedException) {
                // Biometria do aparelho mudou: a chave não existe mais, então a senha guardada é inútil.
                prefs.edit().remove(chave).apply()
                responder(pedido, "invalidada")
            } catch (e: Exception) { responder(pedido, "erro") }
        }
    }

    private fun confirmar(pedido: Int, cifra: Cipher, usar: (Cipher) -> String?) {
        val executor = atividade.mainExecutor
        val construtor = BiometricPrompt.Builder(atividade)
            .setTitle("Cofre do Ecos")
            .setSubtitle("Confirme que é você para abrir o Cofre")
        if (Build.VERSION.SDK_INT >= 30) construtor.setAllowedAuthenticators(AUTENTICADORES)
        else construtor.setNegativeButton("Cancelar", executor) { _, _ -> responder(pedido, "cancelado") }
        construtor.build().authenticate(BiometricPrompt.CryptoObject(cifra), CancellationSignal(), executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(resultado: BiometricPrompt.AuthenticationResult) {
                    try { responder(pedido, "ok", usar(resultado.cryptoObject!!.cipher!!)) } catch (e: Exception) { responder(pedido, "erro") }
                }
                override fun onAuthenticationError(codigo: Int, mensagem: CharSequence?) {
                    // 5 = cancelado pelo sistema, 10 = a pessoa fechou, 13 = botão "Cancelar".
                    responder(pedido, if (codigo == 5 || codigo == 10 || codigo == 13) "cancelado" else "erro")
                }
            })
    }

    private fun obterChave(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        // Autenticação a cada uso (nunca "destravou há pouco, vale por X segundos").
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
        else spec.setUserAuthenticationValidityDurationSeconds(-1)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec.build()) }.generateKey()
    }

    private fun responder(pedido: Int, estado: String, valor: String? = null) {
        val json = JSONObject().put("estado", estado).apply { if (valor != null) put("valor", valor) }
        webView?.post { webView?.evaluateJavascript("window.__ecosCofreSenha&&window.__ecosCofreSenha($pedido,${JSONObject.quote(json.toString())})", null) }
    }

    companion object {
        private const val PREFS = "cofre_senhas"
        private const val ALIAS = "ecos_cofre_senha"
        private const val TRANSFORMACAO = "AES/GCM/NoPadding"
        private val AUTENTICADORES = if (Build.VERSION.SDK_INT >= 30) BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL else 0
    }
}
