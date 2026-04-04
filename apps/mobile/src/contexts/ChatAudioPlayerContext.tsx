import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useAudioPlayer, useAudioPlayerStatus, AudioModule } from 'expo-audio';

const PLAYBACK_START_EPSILON_S = 0.05;

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
  /** SharedValue: track is resolving/loading before real playback has started. */
  isPreparingSV: SharedValue<boolean>;
  /** SharedValue: playback has audibly started (time has advanced). */
  hasPlaybackStartedSV: SharedValue<boolean>;
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
  const prevCurrentTimeRef = useRef(0);
  const prevFractionRef = useRef(0);
  const pauseRequestedRef = useRef(false);

  // ── SharedValues: the ONLY channel consumers observe ───────────────────
  const activeMessageId = useSharedValue<string | null>(null);
  const isPreparingSV = useSharedValue(false);
  const hasPlaybackStartedSV = useSharedValue(false);
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
    const prevCurrent = prevCurrentTimeRef.current;
    const fraction = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;
    const wasPlaying = prevPlayingRef.current;
    const justStopped = wasPlaying && !status.playing;
    const currentAdvanced = current > PLAYBACK_START_EPSILON_S || current > prevCurrent + 0.01;

    if (status.playing) {
      if (currentAdvanced) {
        hasPlaybackStartedSV.value = true;
        isPreparingSV.value = false;
      } else {
        isPreparingSV.value = true;
      }
    } else {
      isPreparingSV.value = false;
      if (current <= PLAYBACK_START_EPSILON_S) {
        hasPlaybackStartedSV.value = false;
      }
    }

    if (duration > 0) {
      const visualFraction = hasPlaybackStartedSV.value ? fraction : 0;

      if (status.playing) {
        // Keep progress tied to the actual reported playback position.
        smoothProgress.value = withTiming(visualFraction, { duration: 90 });
      } else if (justStopped) {
        const endedNaturally =
          !pauseRequestedRef.current &&
          hasPlaybackStartedSV.value &&
          Math.max(fraction, prevFractionRef.current) >= 0.97;
        smoothProgress.value = endedNaturally ? 1 : visualFraction;
      } else {
        smoothProgress.value = visualFraction;
      }

      prevFractionRef.current =
        !status.playing &&
        justStopped &&
        !pauseRequestedRef.current &&
        hasPlaybackStartedSV.value &&
        Math.max(fraction, prevFractionRef.current) >= 0.97
          ? 1
          : visualFraction;
    } else if (!status.playing) {
      smoothProgress.value = 0;
      prevFractionRef.current = 0;
    }

    prevPlayingRef.current = status.playing;
    prevCurrentTimeRef.current = current;
    if (!status.playing) {
      pauseRequestedRef.current = false;
    }
  }, [
    status.playing,
    status.currentTime,
    status.duration,
    isPlayingSV,
    currentTimeSV,
    durationSV,
    smoothProgress,
    hasPlaybackStartedSV,
    isPreparingSV,
  ]);

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
      const s = statusRef.current;
      const resumingSameTrack =
        uri === activeUriRef.current &&
        activeMessageId.value === messageId &&
        s.duration > 0 &&
        s.currentTime > PLAYBACK_START_EPSILON_S &&
        s.currentTime < s.duration - 0.15;

      if (resumingSameTrack) {
        hasPlaybackStartedSV.value = true;
        isPreparingSV.value = false;
      } else {
        hasPlaybackStartedSV.value = false;
        isPreparingSV.value = true;
      }

      if (uri !== activeUriRef.current) {
        setActiveUri(uri);
        smoothProgress.value = 0;
        prevFractionRef.current = 0;
        prevCurrentTimeRef.current = 0;
        // useAudioPlayer will create a new player for this URI.
        // The auto-play effect below starts playback once it loads.
      } else {
        if (switchingMessage) {
          await playerRef.current.seekTo(0);
        } else if (s.duration > 0 && s.currentTime >= s.duration - 0.1) {
          await playerRef.current.seekTo(0);
        }
        playerRef.current.play();
      }
    } catch (err) {
      isPreparingSV.value = false;
      console.error('[ChatAudioPlayer] Play error:', err);
    }
  }, [activeMessageId, hasPlaybackStartedSV, isPreparingSV, smoothProgress]);

  // Auto-play when URI changes (new track loaded)
  const prevUriRef = useRef(activeUri);
  useEffect(() => {
    if (activeUri && activeUri !== prevUriRef.current) {
      prevUriRef.current = activeUri;
      playerRef.current.play();
    }
  }, [activeUri]);

  const pause = useCallback(() => {
    pauseRequestedRef.current = true;
    isPreparingSV.value = false;
    playerRef.current.pause();
  }, [isPreparingSV]);

  const toggle = useCallback((messageId: string, uri: string) => {
    if (activeMessageId.value === messageId && statusRef.current.playing) {
      pauseRequestedRef.current = true;
      isPreparingSV.value = false;
      playerRef.current.pause();
    } else {
      play(messageId, uri);
    }
  }, [activeMessageId, isPreparingSV, play]);

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
      isPreparingSV,
      hasPlaybackStartedSV,
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
