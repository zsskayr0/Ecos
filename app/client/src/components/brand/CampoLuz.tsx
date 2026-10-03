import { useEffect, useRef } from "react";

/**
 * Rastro de fumaça do cursor — porte do fundo "Flow gradient" do hero do Onlook (cena Unicorn Studio):
 *  1. simulação com feedback (ping-pong): cada quadro arrasta, desfoca e desvanece o quadro anterior e "desenha" o segmento
 *     que o mouse percorreu; a direção do movimento fica codificada no matiz;
 *  2. composição: o rastro vira fumaça (ciano → branco) e é deformado por ruído fbm, que dá o aspecto de líquido.
 * Em repouso o rastro se dissipa sozinho e o laço de animação para.
 */
const VERTEX = `#version 300 es
in vec2 p;
out vec2 vTextureCoord;
void main(){ vTextureCoord = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const SIMULACAO = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uPingPongTexture;
uniform vec2 uPreviousMousePos;
uniform vec2 uMousePos;
uniform vec2 uResolution;
uniform float uTime;
const float PI = 3.1415926;
const float TWOPI = 6.2831852;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10; return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
mat2 rot(float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)); }
vec2 angleToDir(float angle){ float rad = angle * 2.0 * PI; return vec2(cos(rad), sin(rad)); }

vec2 liquify(vec2 st, vec2 dir){
  float aspectRatio = uResolution.x / uResolution.y;
  st.x *= aspectRatio;
  float amplitude = 0.0025;
  float freq = 6.0;
  for (float i = 1.0; i <= 5.0; i++){
    st = st * rot(i / 5.0 * PI * 2.0);
    st += vec2(amplitude * cos(i * freq * st.y + uTime * 0.02 * dir.x), amplitude * sin(i * freq * st.x + uTime * 0.02 * dir.y));
  }
  st.x /= aspectRatio;
  return st;
}

vec3 contribuicao(vec2 mousePos, vec2 prevMousePos, vec2 uv, vec2 correctedUv, float aspectRatio, float radius){
  vec2 dir = (mousePos - prevMousePos) * vec2(aspectRatio, 1.0);
  float angle = atan(dir.y, dir.x);
  if (angle < 0.0) angle += TWOPI;
  vec2 mouseVec = mousePos - prevMousePos;
  float mouseLen = length(mouseVec);
  vec2 mouseDir = mouseLen > 0.0 ? mouseVec / mouseLen : vec2(0.0);
  vec2 posToUv = (correctedUv - prevMousePos) * vec2(aspectRatio, 1.0);
  float projection = clamp(dot(posToUv, mouseDir * vec2(aspectRatio, 1.0)), 0.0, mouseLen * aspectRatio);
  vec2 closestPoint = prevMousePos * vec2(aspectRatio, 1.0) + mouseDir * vec2(aspectRatio, 1.0) * projection;
  float distanceToLine = distance(correctedUv, closestPoint);
  float s = (1.0 + radius) / (distanceToLine + radius) * radius;
  vec3 pointColor = pow(hsv2rgb(vec3(angle / TWOPI, 1.0, 1.0)), vec3(2.2));
  return pointColor * pow(s, 10.0 * (1.0 - 0.5 + 0.1));
}

void main(){
  float aspectRatio = uResolution.x / uResolution.y;
  vec2 uv = vTextureCoord;
  vec2 correctedUv = uv * vec2(aspectRatio, 1.0);
  vec3 lastFrameColor = texture(uPingPongTexture, uv).rgb;
  vec3 hsv = rgb2hsv(lastFrameColor);
  vec3 hsvGamma = rgb2hsv(pow(lastFrameColor, vec3(2.2)));
  vec2 prevDir = angleToDir(hsv.x);
  float prevStrength = hsvGamma.z;
  vec2 dir = (uMousePos - uPreviousMousePos) * vec2(aspectRatio, 1.0);
  float dist = length(dir);
  float blurAmount = 0.03 * prevStrength;
  uv = uv - prevDir * blurAmount;
  uv = mix(uv, liquify(uv - prevDir * 0.005, prevDir), (1.0 - prevStrength) * 0.25);
  lastFrameColor = pow(texture(uPingPongTexture, uv).rgb, vec3(2.2));
  int numPoints = int(max(12.0, dist * 24.0));
  float speedFactor = clamp(dist, 0.7, 1.3);
  float radius = mix(0.1, 0.7, 0.528 * speedFactor);
  vec3 trailColor = vec3(0.0);
  int iter = min(numPoints, 24);
  for (int i = 0; i <= iter; i++){
    float t = float(i) / float(numPoints);
    vec2 interpPos = mix(uPreviousMousePos, uMousePos, t);
    vec2 prevInterpPos = i > 0 ? mix(uPreviousMousePos, uMousePos, float(i - 1) / float(numPoints)) : uPreviousMousePos;
    trailColor += contribuicao(interpPos, prevInterpPos, uv, correctedUv, aspectRatio, radius);
  }
  trailColor = trailColor / float(min(numPoints, 50) + 1);
  float clampedDist = clamp(length(trailColor) * dist, 0.0, 1.0);
  float br = 0.005;
  vec3 blurred = vec3(0.0);
  blurred += pow(texture(uPingPongTexture, uv + vec2(br, 0.0)).rgb, vec3(2.2)) * 0.2;
  blurred += pow(texture(uPingPongTexture, uv + vec2(-br, 0.0)).rgb, vec3(2.2)) * 0.2;
  blurred += pow(texture(uPingPongTexture, uv + vec2(0.0, br)).rgb, vec3(2.2)) * 0.2;
  blurred += pow(texture(uPingPongTexture, uv + vec2(0.0, -br)).rgb, vec3(2.2)) * 0.2;
  blurred += lastFrameColor * 0.2;
  vec3 draw = mix(blurred, trailColor, clampedDist);
  draw *= pow(0.5, 0.2);
  fragColor = vec4(pow(draw, vec3(1.0 / 2.2)), 1.0);
}`;

const COMPOSICAO = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uTrail;
uniform float uTime;
uniform vec2 uResolution;
const float PI = 3.14159265359;
out vec4 fragColor;

vec3 hash33(vec3 p3){
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
}
float perlin_noise(vec3 p){
  vec3 pi = floor(p);
  vec3 pf = p - pi;
  vec3 w = pf * pf * (3.0 - 2.0 * pf);
  float n000 = dot(pf - vec3(0.0, 0.0, 0.0), hash33(pi + vec3(0.0, 0.0, 0.0)));
  float n100 = dot(pf - vec3(1.0, 0.0, 0.0), hash33(pi + vec3(1.0, 0.0, 0.0)));
  float n010 = dot(pf - vec3(0.0, 1.0, 0.0), hash33(pi + vec3(0.0, 1.0, 0.0)));
  float n110 = dot(pf - vec3(1.0, 1.0, 0.0), hash33(pi + vec3(1.0, 1.0, 0.0)));
  float n001 = dot(pf - vec3(0.0, 0.0, 1.0), hash33(pi + vec3(0.0, 0.0, 1.0)));
  float n101 = dot(pf - vec3(1.0, 0.0, 1.0), hash33(pi + vec3(1.0, 0.0, 1.0)));
  float n011 = dot(pf - vec3(0.0, 1.0, 1.0), hash33(pi + vec3(0.0, 1.0, 1.0)));
  float n111 = dot(pf - vec3(1.0, 1.0, 1.0), hash33(pi + vec3(1.0, 1.0, 1.0)));
  float nx00 = mix(n000, n100, w.x); float nx01 = mix(n001, n101, w.x);
  float nx10 = mix(n010, n110, w.x); float nx11 = mix(n011, n111, w.x);
  return mix(mix(nx00, nx10, w.y), mix(nx01, nx11, w.y), w.z);
}
mat2 rot(float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)); }
const mat2 rotHalf = mat2(0.87758256, 0.47942554, -0.47942554, 0.87758256);
float fbm(in vec3 st){
  float value = 0.0;
  float amp = 0.25;
  float aM = 0.1 + 0.76 * 0.65;
  vec2 shift = vec2(100.0);
  for (int i = 0; i < 6; i++){ value += amp * perlin_noise(st); st.xy *= rotHalf * 2.5; st.xy += shift; amp *= aM; }
  return value;
}

// Rastro -> fumaça: matiz só guarda a direção, o brilho (valor) é a densidade. Cor: preto -> ciano -> branco.
vec3 fumaca(vec2 uv){
  vec3 t = texture(uTrail, uv).rgb;
  float v = max(t.r, max(t.g, t.b));
  float densidade = clamp(v * 2.5, 0.0, 1.0) * v;
  // Bordas ralas puxam para o violeta da marca, o corpo é ciano e só o núcleo vai a branco (sem estourar).
  vec3 tom = mix(vec3(0.30, 0.22, 0.85), vec3(0.05, 0.78, 1.0), smoothstep(0.04, 0.32, v));
  tom = mix(tom, vec3(0.92, 0.97, 1.0), smoothstep(0.35, 0.95, v));
  vec3 luz = tom * densidade * 1.7;
  // Tonemapping suave: o brilho satura devagar em vez de cortar, o que dá volume à fumaça.
  return 1.0 - exp(-luz * 1.35);
}

void main(){
  vec2 uv = vTextureCoord;
  float aspectRatio = uResolution.x / uResolution.y;
  float multiplier = 6.0 * (0.15 / ((aspectRatio + 1.0) / 2.0));
  vec2 pos = vec2(0.5685640362225097, 0.6510996119016818);
  vec2 st = ((uv - pos) * vec2(aspectRatio, 1.0)) * multiplier * aspectRatio;
  st = rot(0.135 * -1.0 * 2.0 * PI) * st;
  vec2 drift = vec2(uTime * 0.005) * (0.72 * 2.0);
  float time = uTime * 0.025;
  vec2 r = vec2(fbm(vec3(st - drift + vec2(1.7, 9.2), time)), fbm(vec3(st - drift + vec2(8.2, 1.3), time)));
  float f = fbm(vec3(st + r - drift, time)) * 0.31;
  vec2 offset = f * 2.0 + r * 0.31;
  vec3 cor = fumaca(uv + offset);
  // Esmaece nas bordas do painel para a fumaça não terminar em corte seco.
  vec2 borda = smoothstep(0.0, 0.12, uv) * smoothstep(0.0, 0.12, 1.0 - uv);
  cor *= borda.x * borda.y;
  // Ruído mínimo contra faixas (banding) nos degradês longos.
  cor += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0 * step(0.004, max(cor.r, max(cor.g, cor.b)));
  fragColor = vec4(max(cor, 0.0), 1.0);
}`;

function programa(gl: WebGL2RenderingContext, fs: string) {
  const compilar = (tipo: number, fonte: string) => {
    const sh = gl.createShader(tipo);
    if (!sh) return null;
    gl.shaderSource(sh, fonte);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };
  const v = compilar(gl.VERTEX_SHADER, VERTEX);
  const f = compilar(gl.FRAGMENT_SHADER, fs);
  const prog = gl.createProgram();
  if (!v || !f || !prog) return null;
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.bindAttribLocation(prog, 0, "p");
  gl.linkProgram(prog);
  gl.deleteShader(v);
  gl.deleteShader(f);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}

const ESCALA_TELA = 0.7;
const ESCALA_SIMULACAO = 0.5;
const QUADROS_PARADO_ATE_DORMIR = 150;

export function CampoLuz({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return;

    const progSim = programa(gl, SIMULACAO);
    const progTela = programa(gl, COMPOSICAO);
    if (!progSim || !progTela) return;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const u = (prog: WebGLProgram, nome: string) => gl.getUniformLocation(prog, nome);
    const sim = {
      textura: u(progSim, "uPingPongTexture"),
      anterior: u(progSim, "uPreviousMousePos"),
      atual: u(progSim, "uMousePos"),
      res: u(progSim, "uResolution"),
      tempo: u(progSim, "uTime"),
    };
    const tela = { trilha: u(progTela, "uTrail"), tempo: u(progTela, "uTime"), res: u(progTela, "uResolution") };

    // Dois alvos de renderização que se alternam (ping-pong).
    const alvos: { tex: WebGLTexture | null; fbo: WebGLFramebuffer | null }[] = [
      { tex: null, fbo: null },
      { tex: null, fbo: null },
    ];
    let simW = 0;
    let simH = 0;
    let leitura = 0;

    const criarAlvos = (w: number, h: number) => {
      for (const alvo of alvos) {
        if (alvo.tex) gl.deleteTexture(alvo.tex);
        if (alvo.fbo) gl.deleteFramebuffer(alvo.fbo);
        alvo.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, alvo.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        alvo.fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, alvo.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, alvo.tex, 0);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    const medir = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr * ESCALA_TELA));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr * ESCALA_TELA));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const sw = Math.max(1, Math.round(w * ESCALA_SIMULACAO));
      const sh = Math.max(1, Math.round(h * ESCALA_SIMULACAO));
      if (sw !== simW || sh !== simH) {
        simW = sw;
        simH = sh;
        criarAlvos(sw, sh);
      }
    };

    const anterior = { x: 0.5, y: 0.5 };
    const atual = { x: 0.5, y: 0.5 };
    let dentro = false;
    let parado = 0;
    let raf = 0;
    let visivel = true;
    const inicio = performance.now();

    const quadro = () => {
      raf = 0;
      if (!visivel) return;
      medir();
      const tempo = (performance.now() - inicio) / 1000;

      // 1) simulação: lê um alvo, escreve no outro.
      const escrita = 1 - leitura;
      gl.bindFramebuffer(gl.FRAMEBUFFER, alvos[escrita].fbo);
      gl.viewport(0, 0, simW, simH);
      gl.useProgram(progSim);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, alvos[leitura].tex);
      gl.uniform1i(sim.textura, 0);
      gl.uniform2f(sim.anterior, anterior.x, anterior.y);
      gl.uniform2f(sim.atual, atual.x, atual.y);
      gl.uniform2f(sim.res, simW, simH);
      gl.uniform1f(sim.tempo, tempo);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      leitura = escrita;

      // 2) composição na tela.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(progTela);
      gl.bindTexture(gl.TEXTURE_2D, alvos[leitura].tex);
      gl.uniform1i(tela.trilha, 0);
      gl.uniform1f(tela.tempo, tempo);
      gl.uniform2f(tela.res, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const moveu = anterior.x !== atual.x || anterior.y !== atual.y;
      anterior.x = atual.x;
      anterior.y = atual.y;
      parado = moveu ? 0 : parado + 1;
      // Sem movimento por um tempo o rastro já se dissipou: dorme até o próximo movimento.
      if (parado < QUADROS_PARADO_ATE_DORMIR) raf = requestAnimationFrame(quadro);
    };
    const iniciar = () => {
      if (!raf && visivel) raf = requestAnimationFrame(quadro);
    };

    const aoMover = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      const estaDentro = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      if (estaDentro) {
        if (!dentro) {
          anterior.x = x;
          anterior.y = y;
        }
        atual.x = x;
        atual.y = y;
        parado = 0;
        iniciar();
      }
      dentro = estaDentro;
    };
    const aoSair = () => {
      dentro = false;
    };

    const obs = new IntersectionObserver(([entrada]) => {
      visivel = entrada.isIntersecting && !document.hidden;
    });
    obs.observe(canvas);
    const aoVisibilidade = () => {
      visivel = !document.hidden;
    };
    document.addEventListener("visibilitychange", aoVisibilidade);
    window.addEventListener("pointermove", aoMover, { passive: true });
    document.documentElement.addEventListener("pointerleave", aoSair);

    medir();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      document.removeEventListener("visibilitychange", aoVisibilidade);
      window.removeEventListener("pointermove", aoMover);
      document.documentElement.removeEventListener("pointerleave", aoSair);
      for (const alvo of alvos) {
        gl.deleteTexture(alvo.tex);
        gl.deleteFramebuffer(alvo.fbo);
      }
      gl.deleteProgram(progSim);
      gl.deleteProgram(progTela);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
