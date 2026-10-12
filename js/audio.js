// Grabación de audio con transcripción en directo (si el navegador la permite).
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechSupported = !!SR;
export const recordSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

export class Recorder {
  constructor({ onText, onTick } = {}) {
    this.onText = onText;
    this.onTick = onTick;
    this.final = '';
    this.interim = '';
  }

  async start({ transcribe = true } = {}) {
    if (!recordSupported) throw new Error('Este navegador no permite grabar audio aquí. Hace falta abrir la app con https o en este mismo equipo.');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];
    const mime = types.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.t0 = Date.now();
    this.timer = setInterval(() => this.onTick?.((Date.now() - this.t0) / 1000), 500);
    this.running = true;
    if (transcribe && SR) this.startSpeech();
  }

  startSpeech() {
    try {
      const r = new SR();
      r.lang = 'es-ES';
      r.continuous = true;
      r.interimResults = true;
      r.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) this.final += (this.final && !this.final.endsWith(' ') ? ' ' : '') + res[0].transcript.trim();
          else interim += res[0].transcript;
        }
        this.interim = interim;
        this.onText?.(this.final, interim);
      };
      r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.speechDenied = true; };
      r.onend = () => { if (this.running && !this.speechDenied) { try { r.start(); } catch { /* nada */ } } };
      r.start();
      this.sr = r;
    } catch (e) { console.warn('Dictado no disponible', e); }
  }

  stop() {
    return new Promise(res => {
      this.running = false;
      clearInterval(this.timer);
      try { this.sr?.stop(); } catch { /* nada */ }
      const finish = () => {
        this.stream?.getTracks().forEach(t => t.stop());
        const type = this.rec?.mimeType || this.chunks[0]?.type || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        const text = (this.final + (this.interim ? ' ' + this.interim : '')).trim();
        res({ blob, mime: type, duration: (Date.now() - this.t0) / 1000, transcript: text });
      };
      if (this.rec && this.rec.state !== 'inactive') {
        this.rec.onstop = () => setTimeout(finish, 300);
        this.rec.stop();
      } else finish();
    });
  }
}
