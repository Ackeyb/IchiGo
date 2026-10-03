export type SoundCue =
  | 'ui'
  | 'roll'
  | 'impact'
  | 'scoring'
  | 'out'
  | 'turn-end'
  | 'complete'
  | 'sudden-death'
  | 'loser-reveal'
  | 'penalty';

export interface SoundPlayer {
  play(cue: SoundCue): void;
  dispose(): void;
}

type AudioContextFactory = new () => AudioContext;

// Pattern tuples are [frequencyHz, delaySeconds, durationSeconds].
const patterns: Readonly<Record<SoundCue, readonly (readonly [number, number, number])[]>> = {
  ui: [[660, 0, 0.06]],
  roll: [[180, 0, 0.07], [240, 0.07, 0.08]],
  impact: [[120, 0, 0.09]],
  scoring: [[660, 0, 0.08], [880, 0.08, 0.11]],
  out: [[260, 0, 0.08], [130, 0.07, 0.18]],
  'turn-end': [[220, 0, 0.12], [165, 0.1, 0.2]],
  complete: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.22]],
  'sudden-death': [[196, 0, 0.14], [294, 0.13, 0.14], [392, 0.26, 0.2]],
  'loser-reveal': [[330, 0, 0.12], [247, 0.12, 0.2]],
  penalty: [[196, 0, 0.1], [392, 0.1, 0.1], [196, 0.2, 0.2]],
};

/** Presentation-only synthesized effects. Every browser/audio failure is intentionally fail-open. */
export class WebAudioSoundPlayer implements SoundPlayer {
  private context: AudioContext | undefined;

  play(cue: SoundCue): void {
    try {
      const AudioContextClass = (window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: AudioContextFactory }).webkitAudioContext);
      if (!AudioContextClass) return;
      const context = this.context ?? new AudioContextClass();
      this.context = context;
      const start = () => {
        try {
          for (const [frequency, delay, duration] of patterns[cue]) this.tone(context, frequency, delay, duration);
        } catch { /* sound never blocks gameplay */ }
      };
      if (context.state === 'suspended') void context.resume().then(start).catch(() => undefined);
      else start();
    } catch { /* AudioContext construction may be unavailable or denied */ }
  }

  dispose(): void {
    const context = this.context;
    this.context = undefined;
    if (!context) return;
    try { void context.close().catch(() => undefined); } catch { /* page teardown continues */ }
  }

  private tone(context: AudioContext, frequency: number, delay: number, duration: number): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = frequency < 200 ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
}
