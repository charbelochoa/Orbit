class OrbitMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(512);
    this.offset = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const sample of samples) {
      const clamped = Math.max(-1, Math.min(1, sample));
      this.chunk[this.offset++] = Math.round(clamped * (clamped < 0 ? 32768 : 32767));
      if (this.offset === this.chunk.length) {
        this.port.postMessage(this.chunk, [this.chunk.buffer]);
        this.chunk = new Int16Array(512);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('orbit-microphone', OrbitMicrophone);
