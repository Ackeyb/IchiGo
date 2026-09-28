// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAudioSoundPlayer } from '../../src/app/sound';

afterEach(() => vi.unstubAllGlobals());

describe('Web Audio failure boundary', () => {
  it.each(['creation', 'resume', 'playback', 'scheduling'] as const)('contains %s failure', async (failure) => {
    const fail = () => { throw new Error(failure); };
    const schedule = vi.fn(fail);
    const oscillator = { frequency: { setValueAtTime: schedule } };
    const context = {
      state: failure === 'resume' ? 'suspended' : 'running',
      resume: vi.fn(async () => { throw new Error('resume'); }),
      createOscillator: vi.fn(() => failure === 'playback' ? fail() : oscillator),
      createGain: vi.fn(() => ({})),
      close: vi.fn(async () => undefined),
    };
    vi.stubGlobal('AudioContext', class {
      constructor() { if (failure === 'creation') fail(); return context; }
    });
    const sound = new WebAudioSoundPlayer();
    expect(() => sound.play('roll')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    if (failure === 'resume') {
      expect(context.resume).toHaveBeenCalledOnce();
      expect(context.createOscillator).not.toHaveBeenCalled();
    }
    if (failure === 'scheduling') expect(schedule).toHaveBeenCalledOnce();
    expect(() => sound.dispose()).not.toThrow();
  });
});
