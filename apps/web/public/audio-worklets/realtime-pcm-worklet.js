class SignalRoomPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options.processorOptions || {};
    this.targetRate = Number(processorOptions.targetRate) || 24000;
    this.frameSamples = Number(processorOptions.frameSamples) || 2400;
    this.pending = [];
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "flush") {
        this.flush(this.pending.length);
      }
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    const ratio = sampleRate / this.targetRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    for (let index = 0; index < outputLength; index += 1) {
      const sourceIndex = Math.min(input.length - 1, Math.floor(index * ratio));
      this.pending.push(Math.max(-1, Math.min(1, input[sourceIndex] || 0)));
    }

    while (this.pending.length >= this.frameSamples) {
      this.flush(this.frameSamples);
    }

    return true;
  }

  flush(sampleCount) {
    if (sampleCount <= 0) return;
    const samples = this.pending.splice(0, sampleCount);
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    this.port.postMessage(bytes.buffer, [bytes.buffer]);
  }
}

registerProcessor("signal-room-pcm-capture", SignalRoomPcmCaptureProcessor);
