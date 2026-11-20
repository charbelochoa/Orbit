class OrbitMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(512);
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data !== 'flush') return;
      if (this.offset) this.emitChunk();
      this.port.postMessage('flushed');
    };
  }

  emitChunk() {
    const samples = this.chunk.subarray(0, this.offset);
    this.port.postMessage(samples, [samples.buffer]);
    this.chunk = new Int16Array(512);
    this.offset = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const sample of samples) {
      const clamped = Math.max(-1, Math.min(1, sample));
      this.chunk[this.offset++] = Math.round(clamped * (clamped < 0 ? 32768 : 32767));
      if (this.offset === this.chunk.length) this.emitChunk();
    }
    return true;
  }
}

registerProcessor('orbit-microphone', OrbitMicrophone);
