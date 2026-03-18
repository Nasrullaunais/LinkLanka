export type AudibilityStatus =
  | 'calibrating'
  | 'tooShort'
  | 'silence'
  | 'lowVoice'
  | 'noisy'
  | 'good';

export interface AudibilityAnalysis {
  status: AudibilityStatus;
  canSend: boolean;
  confidence: number;
  metrics: {
    noiseFloorDb: number;
    voiceThresholdDb: number;
    peakDb: number;
    p95Db: number;
    speechRatio: number;
    strongSpeechRatio: number;
    nearSilentRatio: number;
    longestVoicedStreak: number;
    sampleCount: number;
  };
}

export interface FeedbackCopy {
  title: string;
  message: string;
  actionLabel: string;
}

const DB_MIN = -80;
const DB_MAX = 0;
const MIN_ANALYSIS_SAMPLES = 6;
const MIN_DURATION_MS = 900;
const CALIBRATION_MIN_MS = 350;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return DB_MIN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * clamp(q, 0, 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] == null) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function sanitizeDbSamples(samples: number[]): number[] {
  return samples
    .filter((v) => Number.isFinite(v))
    .map((v) => clamp(v, DB_MIN, DB_MAX));
}

function longestStreak(flags: boolean[]): number {
  let best = 0;
  let current = 0;
  for (const flag of flags) {
    if (flag) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

export function analyzeAudibility(
  rawSamples: number[],
  durationMs: number,
): AudibilityAnalysis {
  const samples = sanitizeDbSamples(rawSamples);
  const sampleCount = samples.length;

  const noiseFloorDb = quantile(samples, 0.2);
  const peakDb = sampleCount > 0 ? Math.max(...samples) : DB_MIN;
  const p95Db = quantile(samples, 0.95);

  const voiceThresholdDb = clamp(Math.max(noiseFloorDb + 12, -42), -50, -20);
  const strongVoiceThresholdDb = clamp(voiceThresholdDb + 6, -45, -14);
  const nearSilentThresholdDb = clamp(Math.max(noiseFloorDb + 5, -55), -65, -25);

  const voicedFlags = samples.map((db) => db >= voiceThresholdDb);
  const strongVoicedFlags = samples.map((db) => db >= strongVoiceThresholdDb);
  const nearSilentFlags = samples.map((db) => db < nearSilentThresholdDb);

  const speechRatio =
    sampleCount > 0 ? voicedFlags.filter(Boolean).length / sampleCount : 0;
  const strongSpeechRatio =
    sampleCount > 0 ? strongVoicedFlags.filter(Boolean).length / sampleCount : 0;
  const nearSilentRatio =
    sampleCount > 0 ? nearSilentFlags.filter(Boolean).length / sampleCount : 1;
  const longestVoicedStreak = longestStreak(voicedFlags);

  let status: AudibilityStatus = 'good';
  let canSend = true;
  let confidence = 0.9;

  if (
    durationMs < MIN_DURATION_MS ||
    sampleCount < MIN_ANALYSIS_SAMPLES ||
    durationMs < CALIBRATION_MIN_MS
  ) {
    status = 'tooShort';
    canSend = false;
    confidence = 0.98;
  } else if (
    nearSilentRatio >= 0.9 &&
    peakDb < Math.max(noiseFloorDb + 9, -42) &&
    p95Db < Math.max(noiseFloorDb + 7, -46)
  ) {
    status = 'silence';
    canSend = false;
    confidence = 0.99;
  } else if (
    speechRatio < 0.12 &&
    strongSpeechRatio < 0.04 &&
    noiseFloorDb > -40 &&
    peakDb > -30
  ) {
    // Loud environment but not enough speech energy above the local floor.
    status = 'noisy';
    canSend = false;
    confidence = 0.92;
  } else if (
    speechRatio < 0.2 ||
    longestVoicedStreak < 3 ||
    p95Db < voiceThresholdDb
  ) {
    status = 'lowVoice';
    canSend = false;
    confidence = 0.9;
  }

  return {
    status,
    canSend,
    confidence,
    metrics: {
      noiseFloorDb,
      voiceThresholdDb,
      peakDb,
      p95Db,
      speechRatio,
      strongSpeechRatio,
      nearSilentRatio,
      longestVoicedStreak,
      sampleCount,
    },
  };
}

export function getLiveHint(status: AudibilityStatus): string {
  switch (status) {
    case 'calibrating':
      return 'Listening...';
    case 'silence':
      return 'No voice detected yet';
    case 'lowVoice':
      return 'Speak a bit louder';
    case 'noisy':
      return 'Background noise is high';
    case 'good':
      return 'Great level';
    case 'tooShort':
      return 'Hold to record';
    default:
      return 'Listening...';
  }
}

export function getBlockedFeedback(status: AudibilityStatus): FeedbackCopy {
  switch (status) {
    case 'silence':
      return {
        title: 'No voice captured',
        message:
          'We could not hear your voice in that clip. Try again and speak near the microphone.',
        actionLabel: 'Try again',
      };
    case 'lowVoice':
      return {
        title: 'Voice is too quiet',
        message:
          'Your message was very quiet and may be hard to understand. Try speaking a little louder.',
        actionLabel: 'Record again',
      };
    case 'noisy':
      return {
        title: 'Too much background noise',
        message:
          'We heard noise but not clear speech. Try moving to a quieter spot or hold the phone closer.',
        actionLabel: 'Try in quieter spot',
      };
    case 'tooShort':
      return {
        title: 'Recording too short',
        message: 'Hold the mic a bit longer so we can capture a clear voice message.',
        actionLabel: 'Record longer',
      };
    default:
      return {
        title: 'Audio needs another try',
        message: 'Please record again so your message is clear and audible.',
        actionLabel: 'Try again',
      };
  }
}
