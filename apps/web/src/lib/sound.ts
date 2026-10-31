"use client";

import { getSettings } from "@/lib/settings";

/**
 * Move sounds, made on the spot with the Web Audio API.
 *
 * Synthesised rather than recorded: no audio files to ship, license or load,
 * and the app stays usable offline. A move is a short knock of filtered noise -
 * a piece set down on wood - a capture is two, and a check adds a soft tone.
 */

export type MoveSound = "move" | "capture" | "check";

/** Which sound a move in SAN makes: "Qxf7+" is a check, "Nxe5" a capture. */
export function soundFor(san: string): MoveSound {
  if (/[+#]/.test(san)) return "check";
  if (san.includes("x")) return "capture";
  return "move";
}

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  // Browsers start a context suspended until the page has had a gesture; a
  // move is one, so resuming here is what lets the first click make a sound.
  if (context.state === "suspended") void context.resume();
  return context;
}

function knock(ac: AudioContext, at: number, frequency: number, volume: number, seconds: number) {
  const length = Math.ceil(ac.sampleRate * seconds);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 4;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = 1.4;
  const gain = ac.createGain();
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(ac.destination);
  source.start(at);
}

function tone(ac: AudioContext, at: number, frequency: number, volume: number, seconds: number) {
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.value = frequency;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(ac.destination);
  osc.start(at);
  osc.stop(at + seconds);
}

/** Play `kind`, unless move sounds are switched off. Never throws. */
export function playMoveSound(kind: MoveSound): void {
  if (!getSettings().moveSounds) return;
  try {
    const ac = audio();
    if (!ac) return;
    const now = ac.currentTime + 0.005;
    if (kind === "capture") {
      knock(ac, now, 1500, 0.9, 0.08);
      knock(ac, now + 0.045, 1100, 0.6, 0.09);
      tone(ac, now, 170, 0.18, 0.08);
    } else {
      knock(ac, now, 1900, 0.7, 0.07);
      tone(ac, now, 210, 0.14, 0.06);
      if (kind === "check") tone(ac, now + 0.06, 880, 0.07, 0.22);
    }
  } catch {
    /* no audio device, or the browser refused: a silent move is still a move */
  }
}
