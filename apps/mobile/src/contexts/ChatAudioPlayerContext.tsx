import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useAudioPlayer, useAudioPlayerStatus, AudioModule } from 'expo-audio';

/**
 * Centralised audio player for the chat screen — **zero-re-render edition**.
 *
 * One native audio player is shared across all AUDIO bubbles. Rapidly-changing
 * status values (isPlaying, currentTime, duration) live ONLY in SharedValues so
 * consumer components never re-render from context changes. The context value
 * object is created once and its reference never changes, meaning React never
 * propagates a context update to consumers.
 *
 * `useAudioPlayerStatus` re-renders *this* Provider ~60×/sec during playback,
 * but because the children are passed as props (not created inline) and the
 * context value ref is stable, React's reconciler bails out and never
 * re-renders the subtree.
 */

interface ChatAudioPlayerContextType {
  /** SharedValue: message ID currently loaded (null = idle). UI-thread readable. */
  activeMessageId: SharedValue<string | null>;
  /** SharedValue: whether the player is currently playing. UI-thread readable. */
  isPlayingSV: SharedValue<boolean>;
  /** SharedValue: current playback time in seconds. UI-thread readable. */
  currentTimeSV: SharedValue<number>;
  /** SharedValue: total track duration in seconds. UI-thread readable. */
  durationSV: SharedValue<number>;
  /** Smooth progress [0–1] driven on the UI thread via withTiming. */
  smoothProgress: SharedValue<number>;
  /** Start/resume playback of the given message's audio. Switches track if needed. */
  play: (messageId: string, uri: string) => void;
  /** Pause playback. */
  pause: () => void;
  /** Toggle play/pause. Switches track if a different messageId is passed. */
  toggle: (messageId: string, uri: string) => void;
  /** Seek to a fraction [0–1] within the current track. */
  seek: (fraction: number) => void;
}

const ChatAudioPlayerContext = createContext<ChatAudioPlayerContextType | null>(null);

export function ChatAudioPlayerProvider({ children }: { children: React.ReactNode }) {
  // ── React state: only for the URI (drives useAudioPlayer hook). ─────────
  // Changes RARELY — only when the user taps a different audio message.
  const [activeUri, setActiveUri] = useState<string | null>(null);

  const player = useAudioPlayer(activeUri);
  const status = useAudioPlayerStatus(player);

  // ── Refs for synchronous reads inside stable callbacks ─────────────────
  const playerRef = useRef(player);
  playerRef.current = player;
  const statusRef = useRef(status);
  statusRef.current = status;
  const activeUriRef = useRef(activeUri);
  activeUriRef.current = activeUri;
  const prevPlayingRef = useRef(false);
  const prevFractionRef = useRef(0);
  const pauseRequestedRef = useRef(false);

  // ── SharedValues: the ONLY channel consumers observe ───────────────────
  const activeMessageId = useSharedValue<string | null>(null);
  const isPlayingSV = useSharedValue(false);
  const currentTimeSV = useSharedValue(0);
  const durationSV = useSharedValue(0);
  const smoothProgress = useSharedValue(0);

  // ── Sync native status → SharedValues (runs inside provider only) ──────
  // The provider re-renders from useAudioPlayerStatus, but children never
  // re-render because the context value reference is stable.
  useEffect(() => {
    isPlayingSV.value = status.playing;
    currentTimeSV.value = status.currentTime;
    durationSV.value = status.duration;

    const duration = status.duration;
    const current = status.currentTime;
    const fraction = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;
    const wasPlaying = prevPlayingRef.current;
    const justStopped = wasPlaying && !status.playing;

    if (duration > 0) {
      if (status.playing) {
        const remainingMs = Math.max(0, Math.round((duration - current) * 1000));
        smoothProgress.value = withTiming(1, { duration: Math.max(80, remainingMs) });
      } else if (justStopped) {
        const endedNaturally =
          !pauseRequestedRef.current && Math.max(fraction, prevFractionRef.current) >= 0.97;
        smoothProgress.value = endedNaturally ? 1 : fraction;
      } else {
        smoothProgress.value = fraction;
      }

      prevFractionRef.current =
        !status.playing && justStopped && !pauseRequestedRef.current && Math.max(fraction, prevFractionRef.current) >= 0.97
          ? 1
          : fraction;
    } else if (!status.playing) {
      smoothProgress.value = 0;
      prevFractionRef.current = 0;
    }

    prevPlayingRef.current = status.playing;
    if (!status.playing) {
      pauseRequestedRef.current = false;
    }
  }, [status.playing, status.currentTime, status.duration, isPlayingSV, currentTimeSV, durationSV, smoothProgress]);

  // ── Stable callbacks (only reference refs / SharedValues) ──────────────
  const play = useCallback(async (messageId: string, uri: string) => {
    try {
      await AudioModule.setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const switchingMessage = activeMessageId.value !== null && activeMessageId.value !== messageId;
      if (switchingMessage && statusRef.current.playing) {
        // Ensure only one recording can ever play at a time when users tap rapidly.
        playerRef.current.pause();
      }

      activeMessageId.value = messageId;

      if (uri !== activeUriRef.current) {
        setActiveUri(uri);
        smoothProgress.value = 0;
        prevFractionRef.current = 0;
        // useAudioPlayer will create a new player for this URI.
        // The auto-play effect below starts playback once it loads.
      } else {
        const s = statusRef.current;
        if (switchingMessage) {
          await playerRef.current.seekTo(0);
        } else if (s.duration > 0 && s.currentTime >= s.duration - 0.1) {
          await playerRef.current.seekTo(0);
        }
        playerRef.current.play();
      }
    } catch (err) {
      console.error('[ChatAudioPlayer] Play error:', err);
    }
  }, [activeMessageId, smoothProgress]);

  // Auto-play when URI changes (new track loaded)
  const prevUriRef = useRef(activeUri);
  useEffect(() => {
    if (activeUri && activeUri !== prevUriRef.current) {
      prevUriRef.current = activeUri;
      const timer = setTimeout(() => {
        playerRef.current.play();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeUri]);

  const pause = useCallback(() => {
    pauseRequestedRef.current = true;
    playerRef.current.pause();
  }, []);

  const toggle = useCallback((messageId: string, uri: string) => {
    if (activeMessageId.value === messageId && statusRef.current.playing) {
      pauseRequestedRef.current = true;
      playerRef.current.pause();
    } else {
      play(messageId, uri);
    }
  }, [activeMessageId, play]);

  const seek = useCallback((fraction: number) => {
    const dur = statusRef.current.duration;
    if (dur <= 0) return;
    playerRef.current.seekTo(Math.max(0, Math.min(1, fraction)) * dur);
  }, []);

  // ── Context value: created ONCE, never changes ────────────────────────
  // All fields are stable refs (SharedValues) or stable callbacks (deps are
  // only other stable refs). The object ref never changes → React never
  // propagates a context update → zero consumer re-renders.
  const value = useRef<ChatAudioPlayerContextType>(null!);
  if (value.current === null) {
    value.current = {
      activeMessageId,
      isPlayingSV,
      currentTimeSV,
      durationSV,
      smoothProgress,
      play,
      pause,
      toggle,
      seek,
    };
  }

  return (
    <ChatAudioPlayerContext.Provider value={value.current}>
      {children}
    </ChatAudioPlayerContext.Provider>
  );
}

export function useChatAudioPlayer() {
  const ctx = useContext(ChatAudioPlayerContext);
  if (!ctx) throw new Error('useChatAudioPlayer must be used inside ChatAudioPlayerProvider');
  return ctx;
}
