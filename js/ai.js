// Transcripción de escritura a mano con Claude (opcional, de pago por uso).
// Solo funciona si se pone una clave de API propia en Ajustes. La clave se guarda
// únicamente en este navegador y la imagen de la página se envía a Anthropic.
import { state } from './store.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';

// Precios por millón de tokens (entrada / salida) según la referencia de Anthropic de 06/10/2026.
export const AI_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (el más preciso)', price: '4 $ / 20 $ por millón de tokens', fallback: true },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (equilibrado)', price: '2 $ / 10 $ por millón de tokens', fallback: true },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (el más barato)', price: '0,10 $ / 0,50 $ por millón de tokens', fallback: false },
];

const PROMPT = `Transcribe literalmente todo el texto escrito a mano de esta imagen (apuntes en español, a veces con términos técnicos de ingeniería).
- Respeta el orden de lectura y los saltos de línea.
- No añadas comentarios, títulos ni explicaciones: devuelve solo el texto.
- Si una palabra es ilegible, escribe [?].
- Si hay fórmulas, escríbelas en texto plano (por ejemplo: P = V · I · cos φ).
- Si hay esquemas o dibujos, ignóralos salvo sus rótulos.
- Si no hay texto manuscrito, devuelve exactamente: (sin texto)`;

let sdkP = null;
function loadSdk() {
  if (!sdkP) sdkP = import(SDK_URL).then(m => m.default || m.Anthropic).catch(e => { sdkP = null; throw new Error('No se pudo cargar la conexión con Claude. ¿Hay internet? (' + e.message + ')'); });
  return sdkP;
}

export const aiEnabled = () => !!(state.settings.aiKey || '').trim();

async function client() {
  const key = (state.settings.aiKey || '').trim();
  if (!key) throw new Error('Falta la clave de API de Anthropic (Ajustes > Transcripción con IA).');
  const Anthropic = await loadSdk();
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}

function canvasToBase64(canvas) {
  return canvas.toDataURL('image/png').split(',')[1];
}

// canvas: imagen de la página (o de la selección). Devuelve el texto.
export async function transcribe(canvas, { extra = '' } = {}) {
  const c = await client();
  const model = state.settings.aiModel || 'claude-opus-5-5';
  const info = AI_MODELS.find(m => m.id === model);
  const req = {
    model,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: canvasToBase64(canvas) } },
        { type: 'text', text: PROMPT + (extra ? '\n' + extra : '') },
      ],
    }],
  };
  let res;
  try {
    res = info?.fallback
      ? await c.beta.messages.create({ ...req, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await c.messages.create(req);
  } catch (e) {
    const status = e?.status;
    if (status === 401) throw new Error('La clave de API no es válida.');
    if (status === 429) throw new Error('Demasiadas peticiones o sin saldo. Prueba en un rato.');
    if (status === 400) throw new Error('Petición rechazada por la API: ' + (e?.error?.error?.message || e.message));
    throw new Error('Error al contactar con Claude: ' + (e?.message || e));
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude no ha querido procesar esta página.');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return text === '(sin texto)' ? '' : text;
}

export async function testKey() {
  const c = await client();
  const res = await c.messages.create({
    model: state.settings.aiModel || 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: 'Responde solo con la palabra: correcto' }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Rechazado');
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}
