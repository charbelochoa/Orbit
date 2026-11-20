class OrbitAudio {
  constructor() {
    this.playing = new Set();
    this.nextSampleTime = 0;
    this.capture = null;
    this.starting = false;
  }

  async start(onChunk, onLimit) {
    if (this.capture || this.starting) return false;
    this.starting = true;
    this.stopPlayback();
    let stream;
    let context;
    try {
      this.output ||= new AudioContext();
      await this.output.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
      context = new AudioContext({ sampleRate: 16000 });
      if (context.sampleRate !== 16000) throw new Error('La captura requiere audio a 16 kHz.');
      await context.audioWorklet.addModule('/microphone.js');
      await context.resume();
      const node = new AudioWorkletNode(context, 'orbit-microphone');
      const source = context.createMediaStreamSource(stream);
      const silence = context.createGain();
      silence.gain.value = 0;
      const capture = { stream, context, source, node, silence, chunks: [], samples: 0, pending: 0, onChunk };
      this.capture = capture;
      node.port.onmessage = ({ data }) => {
        if (this.capture !== capture) return;
        if (data === 'flushed') {
          capture.completeTail?.();
          return;
        }
        const remaining = 480000 - capture.samples;
        const chunk = data.subarray(0, remaining);
        capture.chunks.push(chunk);
        capture.samples += chunk.length;
        capture.pending += chunk.length;
        if (capture.pending >= 2560) this.flush(capture);
        if (capture.samples === 480000) onLimit();
      };
      source.connect(node).connect(silence).connect(context.destination);
      return true;
    } catch (error) {
      this.capture = null;
      stream?.getTracks().forEach(track => track.stop());
      if (context) void context.close().catch(() => {});
      throw error;
    } finally {
      this.starting = false;
    }
  }

  stop(flush = false) {
    const capture = this.capture;
    if (!capture) return;
    this.capture = null;
    capture.completeTail?.();
    capture.node.port.close();
    capture.source.disconnect();
    capture.node.disconnect();
    capture.silence.disconnect();
    capture.stream.getTracks().forEach(track => track.stop());
    void capture.context.close().catch(() => {});
    if (flush) this.flush(capture);
  }

  async finish() {
    const capture = this.capture;
    if (!capture) return;
    capture.stream.getTracks().forEach(track => track.stop());
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 100);
      capture.completeTail = () => { clearTimeout(timer); resolve(); };
      capture.node.port.postMessage('flush');
    });
    if (this.capture === capture) this.stop(true);
  }

  flush(capture) {
    if (!capture.pending) return;
    const bytes = new Uint8Array(capture.pending * 2);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    for (const chunk of capture.chunks) {
      for (const sample of chunk) {
        view.setInt16(offset, sample, true);
        offset += 2;
      }
    }
    capture.chunks.length = 0;
    capture.pending = 0;
    capture.onChunk(btoa(String.fromCharCode(...bytes)));
  }

  play(pcm, sampleRate) {
    if (!this.output || this.output.state !== 'running') return;
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) return;
    if (typeof pcm !== 'string' || !pcm.length || pcm.length > 262144) return;
    let bytes;
    try {
      bytes = Uint8Array.from(atob(pcm), byte => byte.charCodeAt(0));
    } catch {
      return;
    }
    if (!bytes.length || bytes.length % 2) return;
    const source = this.output.createBufferSource();
    const buffer = this.output.createBuffer(1, Math.floor(bytes.length / 2), sampleRate);
    const view = new DataView(bytes.buffer);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
    source.buffer = buffer;
    source.connect(this.output.destination);
    const start = Math.max(this.output.currentTime, this.nextSampleTime);
    this.nextSampleTime = start + buffer.duration;
    this.playing.add(source);
    source.onended = () => {
      source.disconnect();
      this.playing.delete(source);
    };
    source.start(start);
  }

  stopPlayback() {
    for (const source of this.playing) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.playing.clear();
    this.nextSampleTime = 0;
  }
}
