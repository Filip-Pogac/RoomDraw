"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import Image from "next/image";
import {
  Copy,
  Crown,
  Loader2,
  LogOut,
  Play,
  Plus,
  QrCode,
  RotateCcw,
  Send,
  Settings,
  SkipForward,
  UserMinus,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { DrawingCanvas } from "@/components/DrawingCanvas";
import {
  BackgroundDoodles,
  CloudDoodle,
  Confetti,
  CrayonMascot,
  PaletteMascot,
  PencilDoodle,
  RainbowDoodle,
  SquiggleDoodle,
  StarDoodle,
} from "@/components/Doodles";
import { DrawingReplayModal } from "@/components/DrawingReplayModal";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  MAX_PLAYERS_PER_ROOM,
  ROUND_SECONDS,
  WORD_PACK_LABELS,
  broadcastDrawingEvent,
  createRoom,
  endRound,
  fetchRoomSettings,
  fetchRoundHistory,
  fetchRoomSnapshot,
  getWordChoices,
  joinRoom,
  joinSpectator,
  kickPlayer,
  leaveSpectator,
  normalizeRoomCode,
  prepareNextRound,
  removePlayer,
  removePlayerOnExit,
  resetRound,
  restartRoom,
  saveFinalResult,
  saveRoundSummary,
  startRound,
  submitGuess,
  subscribeToRoom,
  updateRoomSettings,
} from "@/lib/supabase/rooms";
import type { WordPack } from "@/lib/supabase/rooms";
import type {
  DrawingEvent,
  Guess,
  Player,
  Room,
  RoomSettings as DbRoomSettings,
  SavedRoundSummary,
} from "@/types/game";

type ViewState = "join" | "room";
type WordSource = WordPack | "custom";
type ScoringMode = "speed" | "flat" | "off";
type RoomLanguage = "English" | "Croatian" | "Mixed";

type RoomSettings = {
  roundSeconds: number;
  totalRounds: number;
  language: RoomLanguage;
  wordSource: WordSource;
  maxPlayers: number;
  scoringMode: ScoringMode;
  hideIncorrectGuesses: boolean;
};

type RoundSummary = {
  round: number;
  word: string;
  drawerName: string;
  winners: Array<{ name: string; points: number }>;
  savedAt: number;
};

const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  roundSeconds: ROUND_SECONDS,
  totalRounds: 5,
  language: "English",
  wordSource: "easy",
  maxPlayers: MAX_PLAYERS_PER_ROOM,
  scoringMode: "speed",
  hideIncorrectGuesses: true,
};

/** Fun animal badge for each seat in the player list. */
const PLAYER_AVATARS = ["\u{1F98A}", "\u{1F43C}", "\u{1F438}", "\u{1F984}", "\u{1F419}", "\u{1F41D}", "\u{1F428}", "\u{1F996}"];

const MEDALS = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];

const LANGUAGE_LABELS: Record<RoomLanguage, string> = {
  English: "English",
  Croatian: "Croatian",
  Mixed: "Mixed",
};

const SCORING_LABELS: Record<ScoringMode, string> = {
  speed: "Speed 100/70/40",
  flat: "Flat 50",
  off: "No score",
};

const WORD_SOURCE_LABELS: Record<WordSource, string> = {
  ...WORD_PACK_LABELS,
  custom: "Custom words",
};

function scoreForRank(mode: ScoringMode, rank: number) {
  if (mode === "flat") {
    return 50;
  }

  if (mode === "off") {
    return 0;
  }

  return [100, 70, 40][rank - 1] ?? 0;
}

function parseCustomWords(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 2)
        .map((word) => word.slice(0, 32)),
    ),
  ];
}

function shuffledWords(words: string[]) {
  return [...words].sort(() => Math.random() - 0.5);
}

function choicesForSource(source: WordSource, customWords: string[]) {
  if (source === "custom") {
    return shuffledWords(customWords).slice(0, 3);
  }

  return getWordChoices(source);
}

function playerNameForGuess(guess: Guess, players: Player[]) {
  return players.find((player) => player.id === guess.player_id)?.name ?? "Player";
}

function newSystemDrawingEvent(): DrawingEvent {
  return {
    id: `system-${Date.now()}`,
    type: "clear",
    senderId: "system",
    at: Date.now(),
  };
}

function getRoomSessionKey() {
  if (typeof window === "undefined") {
    return "";
  }

  const stored = window.localStorage.getItem("roomdraw:session_key");

  if (stored) {
    return stored;
  }

  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  window.localStorage.setItem("roomdraw:session_key", next);
  return next;
}

function dbSettingsToUi(settings: DbRoomSettings): RoomSettings {
  return {
    hideIncorrectGuesses: true,
    language:
      settings.language === "hr"
        ? "Croatian"
        : settings.language === "mixed"
          ? "Mixed"
          : "English",
    maxPlayers: settings.max_players,
    roundSeconds: settings.round_seconds,
    scoringMode: settings.scoring_mode,
    totalRounds: settings.round_limit,
    wordSource: (settings.word_pack as WordSource) || "easy",
  };
}

function roomSettingsPatch(settings: RoomSettings, customWords: string[]) {
  return {
    custom_words: customWords,
    language:
      settings.language === "Croatian"
        ? "hr"
        : settings.language === "Mixed"
          ? "mixed"
          : "en",
    max_players: settings.maxPlayers,
    round_limit: settings.totalRounds,
    round_seconds: settings.roundSeconds,
    scoring_mode: settings.scoringMode,
    word_pack: settings.wordSource,
  };
}

function standingsForPlayers(players: Player[]) {
  return players.map((item, index) => ({
    player_id: item.id,
    player_name: item.name,
    rank: index + 1,
    score: item.score,
  }));
}

function savedSummaryToRoundSummary(summary: SavedRoundSummary): RoundSummary {
  return {
    drawerName: "Saved round",
    round: summary.round_number,
    savedAt: Date.parse(summary.created_at),
    winners: summary.results.slice(0, 3).map((entry) => ({
      name: entry.player_name,
      points: entry.points,
    })),
    word: summary.word,
  };
}

export function GameClient() {
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const resetRoundRef = useRef(false);
  const endRoundRef = useRef(false);
  const lastGuessAtRef = useRef(0);
  const lastWarningSecondRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousRoomStatusRef = useRef<Room["status"] | null>(null);
  const roundDrawingEventsRef = useRef<DrawingEvent[]>([]);
  const lastPersistedSettingsRef = useRef("");
  const savedFinalKeysRef = useRef(new Set<string>());
  const savedRoundKeysRef = useRef(new Set<string>());
  const [view, setView] = useState<ViewState>("join");
  const [name, setName] = useState(() =>
    typeof window === "undefined" ? "" : window.localStorage.getItem("roomdraw:name") ?? "",
  );
  const [joinCode, setJoinCode] = useState(() =>
    typeof window === "undefined"
      ? ""
      : normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? ""),
  );
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [player, setPlayer] = useState<Player | null>(null);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [guessText, setGuessText] = useState("");
  const [incomingDrawingEvents, setIncomingDrawingEvents] = useState<DrawingEvent[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [onlinePlayerIds, setOnlinePlayerIds] = useState<string[] | null>(null);
  const [isChoosingWord, setIsChoosingWord] = useState(false);
  const [wordChoices, setWordChoices] = useState<string[]>([]);
  const [isReplayOpen, setIsReplayOpen] = useState(false);
  const [replayEvents, setReplayEvents] = useState<DrawingEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [fallbackRoundDeadline, setFallbackRoundDeadline] = useState<{
    endsAt: number;
    key: string;
  } | null>(null);
  const [roomSettings, setRoomSettings] = useState<RoomSettings>(DEFAULT_ROOM_SETTINGS);
  const [customWordsText, setCustomWordsText] = useState("");
  const [joinAsSpectator, setJoinAsSpectator] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  const [spectatorId, setSpectatorId] = useState<string | null>(null);
  const [lastGuessHint, setLastGuessHint] = useState("");
  const [guessFeedback, setGuessFeedback] = useState<{
    kind: "wrong" | "close" | "correct";
    text: string;
    at: number;
    round: number;
  } | null>(null);
  const [roundSummaries, setRoundSummaries] = useState<RoundSummary[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(() =>
    typeof window === "undefined" ? true : window.localStorage.getItem("roomdraw:sound") !== "off",
  );
  const [copiedInvite, setCopiedInvite] = useState<"link" | "code" | "results" | null>(null);

  const supabaseReady = isSupabaseConfigured();

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  const currentPlayer = useMemo(
    () => players.find((item) => item.id === player?.id) ?? player,
    [player, players],
  );
  const presenceReady = onlinePlayerIds !== null;
  const activePlayers = useMemo(() => {
    if (!onlinePlayerIds) {
      return players;
    }

    const onlineIds = new Set(onlinePlayerIds);
    return players.filter((item) => onlineIds.has(item.id) || item.id === player?.id);
  }, [onlinePlayerIds, player?.id, players]);
  const playingPlayers = useMemo(
    () => activePlayers.filter((item) => item.id !== player?.id || !isSpectator),
    [activePlayers, isSpectator, player?.id],
  );
  const activePlayerIds = useMemo(
    () => new Set(playingPlayers.map((item) => item.id)),
    [playingPlayers],
  );
  const sortedPlayers = useMemo(
    () => [...playingPlayers].sort((first, second) => second.score - first.score),
    [playingPlayers],
  );
  const host = playingPlayers[0] ?? null;
  const drawer = playingPlayers.find((item) => item.id === room?.drawer_player_id) ?? null;
  const isHost = Boolean(currentPlayer && host?.id === currentPlayer.id);
  const isDrawer = Boolean(currentPlayer && room?.drawer_player_id === currentPlayer.id);
  const nextDrawer = useMemo(() => {
    if (!room || playingPlayers.length === 0) {
      return null;
    }

    const currentDrawerIndex = playingPlayers.findIndex(
      (item) => item.id === room.drawer_player_id,
    );
    return playingPlayers[(currentDrawerIndex + 1 + playingPlayers.length) % playingPlayers.length];
  }, [playingPlayers, room]);
  const isNextDrawer = Boolean(currentPlayer && nextDrawer?.id === currentPlayer.id);
  const roomLink =
    typeof window === "undefined" || !room
      ? ""
      : `${window.location.origin}?room=${room.code}`;
  const qrCodeUrl = roomLink
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=12&data=${encodeURIComponent(roomLink)}`
    : "";
  const roundEndsAt = room?.round_ends_at ? Date.parse(room.round_ends_at) : null;
  const fallbackRoundKey =
    room?.status === "playing" && !roundEndsAt && room.code
      ? `${room.code}:${room.round_number}`
      : null;
  const fallbackRoundEndsAt =
    fallbackRoundDeadline?.key === fallbackRoundKey ? fallbackRoundDeadline.endsAt : null;
  const effectiveRoundEndsAt = roundEndsAt ?? fallbackRoundEndsAt;
  const secondsLeft =
    room?.status === "playing" && effectiveRoundEndsAt
      ? Math.max(0, Math.ceil((effectiveRoundEndsAt - now) / 1_000))
      : roomSettings.roundSeconds;
  const leader = sortedPlayers[0] ?? null;
  const parsedCustomWords = useMemo(() => parseCustomWords(customWordsText), [customWordsText]);
  const correctGuesses = useMemo(
    () => guesses.filter((guess) => guess.is_correct),
    [guesses],
  );
  const visibleGuesses = useMemo(() => {
    // The drawer already knows the word, so there is nothing to hide from them -
    // watching everyone guess wrong is half the fun of drawing.
    if (!roomSettings.hideIncorrectGuesses || isDrawer) {
      return guesses;
    }

    return guesses.filter((guess) => guess.is_correct || guess.player_id === currentPlayer?.id);
  }, [currentPlayer?.id, guesses, isDrawer, roomSettings.hideIncorrectGuesses]);
  const showWinner =
    room?.status === "round_end" && room.round_number >= roomSettings.totalRounds && leader;
  const effectiveMaxPlayers = Math.min(roomSettings.maxPlayers, MAX_PLAYERS_PER_ROOM);
  const guessFeedRef = useRef<HTMLDivElement | null>(null);

  // Guess feedback is a quick flash, not a permanent label.
  useEffect(() => {
    if (!guessFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => setGuessFeedback(null), 3_500);

    return () => window.clearTimeout(timeoutId);
  }, [guessFeedback]);

  // Keep the newest guess in view as the feed fills up during a round.
  useEffect(() => {
    const feed = guessFeedRef.current;

    if (feed) {
      feed.scrollTop = feed.scrollHeight;
    }
  }, [visibleGuesses.length]);

  const playTone = useCallback(
    (frequency: number, duration = 0.12) => {
      if (!soundEnabled || typeof window === "undefined") {
        return;
      }

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextClass) {
        return;
      }

      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    },
    [soundEnabled],
  );

  useEffect(() => {
    if (!room?.code || !player?.id || isSpectator) {
      return;
    }

    const handleExit = () => removePlayerOnExit(room.code, player.id);
    window.addEventListener("pagehide", handleExit);
    window.addEventListener("beforeunload", handleExit);

    return () => {
      window.removeEventListener("pagehide", handleExit);
      window.removeEventListener("beforeunload", handleExit);
    };
  }, [isSpectator, player?.id, room?.code]);

  useEffect(() => {
    window.localStorage.setItem("roomdraw:sound", soundEnabled ? "on" : "off");
  }, [soundEnabled]);

  useEffect(() => {
    if (!room?.code || !isHost || room.status === "playing") {
      return;
    }

    const payload = roomSettingsPatch(roomSettings, parsedCustomWords);
    const payloadKey = JSON.stringify(payload);

    if (lastPersistedSettingsRef.current === payloadKey) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      lastPersistedSettingsRef.current = payloadKey;
      void updateRoomSettings(room.code, payload).catch(() => undefined);
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [isHost, parsedCustomWords, room?.code, room?.status, roomSettings]);

  useEffect(() => {
    let cancelled = false;

    const timeoutId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      if (!room?.code) {
        setRoundSummaries([]);
        return;
      }

      const stored = window.localStorage.getItem(`roomdraw:rounds:${room.code}`);

      if (!stored) {
        setRoundSummaries([]);
        return;
      }

      try {
        setRoundSummaries(JSON.parse(stored) as RoundSummary[]);
      } catch {
        setRoundSummaries([]);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [room?.code]);

  useEffect(() => {
    if (!room?.code) {
      return;
    }

    if (roundSummaries.length === 0) {
      return;
    }

    window.localStorage.setItem(
      `roomdraw:rounds:${room.code}`,
      JSON.stringify(roundSummaries.slice(-20)),
    );
  }, [room?.code, roundSummaries]);

  useEffect(() => {
    if (room?.status !== "playing") {
      return;
    }

    const intervalId = window.setInterval(() => setNow(Date.now()), 500);

    return () => window.clearInterval(intervalId);
  }, [room?.status]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setFallbackRoundDeadline((current) => {
        if (!fallbackRoundKey) {
          return current ? null : current;
        }

        if (current?.key === fallbackRoundKey) {
          return current;
        }

        return {
          endsAt: Date.now() + roomSettings.roundSeconds * 1_000,
          key: fallbackRoundKey,
        };
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [fallbackRoundKey, roomSettings.roundSeconds]);

  useEffect(() => {
    if (room?.status !== "playing" || secondsLeft > 10 || secondsLeft <= 0) {
      lastWarningSecondRef.current = null;
      return;
    }

    if (lastWarningSecondRef.current === secondsLeft) {
      return;
    }

    lastWarningSecondRef.current = secondsLeft;
    playTone(220, 0.08);
  }, [playTone, room?.status, secondsLeft]);

  useEffect(() => {
    if (view !== "room" || !player || isSpectator || players.length === 0) {
      return;
    }

    if (players.some((item) => item.id === player.id)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      unsubscribeRef.current?.();
      realtimeChannelRef.current = null;
      unsubscribeRef.current = null;
      roundDrawingEventsRef.current = [];
      previousRoomStatusRef.current = null;
      setRoom(null);
      setPlayers([]);
      setPlayer(null);
      setGuesses([]);
      setIncomingDrawingEvents([]);
      setOnlinePlayerIds(null);
      setIsChoosingWord(false);
      setWordChoices([]);
      setIsReplayOpen(false);
      setReplayEvents([]);
      setView("join");
      setNotice("");
      setError("You were removed from the room.");
      window.history.replaceState(null, "", window.location.pathname);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isSpectator, player, players, view]);

  const loadSnapshot = useCallback(async (code: string) => {
    const snapshot = await fetchRoomSnapshot(code);
    setRoom(snapshot.room);
    setPlayers(snapshot.players);
    setGuesses(snapshot.guesses);
  }, []);

  const loadRoomHistory = useCallback(async (code: string) => {
    try {
      const history = await fetchRoundHistory(code);

      if (history.length > 0) {
        setRoundSummaries(
          history
            .map(savedSummaryToRoundSummary)
            .sort((first, second) => first.round - second.round),
        );
      }
    } catch {
      // Older rooms can run before the persistence migration is applied.
    }
  }, []);

  const loadRemoteRoomSettings = useCallback(async (code: string) => {
    try {
      const settings = await fetchRoomSettings(code);
      setRoomSettings(dbSettingsToUi(settings));
      setCustomWordsText(settings.custom_words.join("\n"));
    } catch {
      // Keep local defaults if the room_settings table is not available yet.
    }
  }, []);

  useEffect(() => {
    if (view !== "room" || !room?.code) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadSnapshot(room.code).catch(() => undefined);
    }, room.status === "playing" && room.round_ends_at ? 2_000 : 1_500);

    return () => window.clearInterval(intervalId);
  }, [loadSnapshot, room?.code, room?.round_ends_at, room?.status, view]);

  useEffect(() => {
    if (!room || room.status !== "playing" || secondsLeft > 0) {
      if (room?.status !== "playing") {
        endRoundRef.current = false;
      }

      return;
    }

    if (endRoundRef.current) {
      return;
    }

    endRoundRef.current = true;

    void endRound(room.code)
      .then(() => loadSnapshot(room.code))
      .then(() => setNotice("Time is up. Round ended."))
      .catch((caught) => {
        endRoundRef.current = false;
        setError(caught instanceof Error ? caught.message : "Could not end round.");
      });
  }, [loadSnapshot, room, secondsLeft]);

  const rememberDrawingEvent = useCallback((event: DrawingEvent) => {
    if (event.type === "clear") {
      roundDrawingEventsRef.current = [event];
      return;
    }

    roundDrawingEventsRef.current = [...roundDrawingEventsRef.current, event].slice(-2_500);
  }, []);

  const queueDrawingEvent = useCallback((event: DrawingEvent) => {
    rememberDrawingEvent(event);
    setIncomingDrawingEvents((events) => [...events.slice(-300), event]);
  }, [rememberDrawingEvent]);

  useEffect(() => {
    const previousStatus = previousRoomStatusRef.current;

    if (room?.status === "round_end" && previousStatus === "playing") {
      playTone(330, 0.16);

      const replayableEvents = roundDrawingEventsRef.current.filter(
        (event) => event.type !== "clear",
      );

      if (replayableEvents.length > 0) {
        setReplayEvents(roundDrawingEventsRef.current);
        setIsReplayOpen(true);
      }
    }

    if (room?.status === "playing" && previousStatus !== "playing") {
      playTone(660, 0.1);

      setIsReplayOpen(false);
      setReplayEvents([]);
    }

    previousRoomStatusRef.current = room?.status ?? null;
  }, [playTone, room?.status]);

  useEffect(() => {
    if (!room || room.status !== "round_end" || !room.current_word) {
      return;
    }

    const drawerName =
      players.find((item) => item.id === room.drawer_player_id)?.name ?? "Unknown";
    const winners = correctGuesses.map((guess, index) => ({
      name: playerNameForGuess(guess, players),
      points: scoreForRank(roomSettings.scoringMode, index + 1),
    }));
    const summary: RoundSummary = {
      drawerName,
      round: room.round_number,
      savedAt: Date.now(),
      winners,
      word: room.current_word,
    };
    const roundKey = `${room.code}:${room.round_number}`;

    if (isHost && !savedRoundKeysRef.current.has(roundKey)) {
      savedRoundKeysRef.current.add(roundKey);
      void saveRoundSummary({
        drawerPlayerId: room.drawer_player_id,
        drawingEvents: roundDrawingEventsRef.current,
        endedReason: correctGuesses.length > 0 ? "guessed" : secondsLeft <= 0 ? "timer" : "manual",
        results: correctGuesses.slice(0, 3).map((guess, index) => ({
          guessed_at: guess.created_at,
          player_id: guess.player_id,
          player_name: playerNameForGuess(guess, players),
          points: scoreForRank(roomSettings.scoringMode, index + 1),
          rank: index + 1,
        })),
        roomCode: room.code,
        roundNumber: room.round_number,
        standings: standingsForPlayers(sortedPlayers),
        word: room.current_word,
      })
        .then(() => loadRoomHistory(room.code))
        .catch(() => undefined);
    }

    const finalKey = `${room.code}:${roomSettings.totalRounds}`;

    if (
      isHost &&
      leader &&
      room.round_number >= roomSettings.totalRounds &&
      !savedFinalKeysRef.current.has(finalKey)
    ) {
      savedFinalKeysRef.current.add(finalKey);
      void saveFinalResult({
        roomCode: room.code,
        roundsPlayed: room.round_number,
        sharePayload: {
          roomCode: room.code,
          winner: leader.name,
          winnerScore: leader.score,
        },
        standings: standingsForPlayers(sortedPlayers),
        winnerPlayerId: leader.id,
      }).catch(() => undefined);
    }

    const timeoutId = window.setTimeout(() => {
      setRoundSummaries((summaries) => {
        const withoutCurrent = summaries.filter((item) => item.round !== summary.round);
        return [...withoutCurrent, summary].sort((first, second) => first.round - second.round);
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    correctGuesses,
    isHost,
    leader,
    loadRoomHistory,
    players,
    room,
    roomSettings.scoringMode,
    roomSettings.totalRounds,
    secondsLeft,
    sortedPlayers,
  ]);

  useEffect(() => {
    if (!presenceReady || !room || room.status !== "playing") {
      resetRoundRef.current = false;
      return;
    }

    const drawerLeft = Boolean(
      room.drawer_player_id && !activePlayerIds.has(room.drawer_player_id),
    );
    const tooFewPlayers = playingPlayers.length < 2;

    if (!drawerLeft && !tooFewPlayers) {
      resetRoundRef.current = false;
      return;
    }

    if (resetRoundRef.current) {
      return;
    }

    resetRoundRef.current = true;
    const clearEvent = newSystemDrawingEvent();
    queueDrawingEvent(clearEvent);

    void broadcastDrawingEvent(realtimeChannelRef.current, clearEvent)
      .then(() => resetRound(room.code))
      .then(() => loadSnapshot(room.code))
      .then(() => {
        setIsChoosingWord(false);
        setWordChoices([]);
        setNotice(
          tooFewPlayers
            ? "Round restarted. Add another player before playing."
            : "Drawer left. Round restarted.",
        );
      })
      .catch((caught) => {
        resetRoundRef.current = false;
        setError(caught instanceof Error ? caught.message : "Could not reset round.");
      });
  }, [
    activePlayerIds,
    playingPlayers.length,
    loadSnapshot,
    presenceReady,
    queueDrawingEvent,
    room,
  ]);

  const enterRoom = useCallback(
    async (nextRoom: Room, nextPlayer: Player) => {
      unsubscribeRef.current?.();
      realtimeChannelRef.current = null;
      roundDrawingEventsRef.current = [];
      previousRoomStatusRef.current = nextRoom.status;
      setIncomingDrawingEvents([]);
      setOnlinePlayerIds(null);
      setIsChoosingWord(false);
      setWordChoices([]);
      setIsReplayOpen(false);
      setReplayEvents([]);
      setRoom(nextRoom);
      setPlayer(nextPlayer);
      setView("room");
      setError("");
      setNotice("Room ready. Share the code and start drawing.");
      window.localStorage.setItem("roomdraw:name", nextPlayer.name);
      window.history.replaceState(null, "", `?room=${nextRoom.code}`);

      await loadSnapshot(nextRoom.code);
      void loadRemoteRoomSettings(nextRoom.code);
      void loadRoomHistory(nextRoom.code);

      const subscription = subscribeToRoom(nextRoom.code, nextPlayer, {
        onHistoryChange: () => {
          void loadRoomHistory(nextRoom.code);
        },
        onRoomChange: (nextRoom) => {
          setRoom(nextRoom);

          if (nextRoom.status === "playing" || nextRoom.status === "round_end") {
            void loadSnapshot(nextRoom.code).catch(() => undefined);
          }
        },
        onSettingsChange: (settings) => {
          setRoomSettings(dbSettingsToUi(settings));
          setCustomWordsText(settings.custom_words.join("\n"));
        },
        onSnapshotNeeded: () => {
          void loadSnapshot(nextRoom.code);
        },
        onDrawingEvent: queueDrawingEvent,
        onPresenceChange: setOnlinePlayerIds,
        onRealtimeStatus: (status) => {
          if (status === "SUBSCRIBED") {
            setNotice("Realtime connected.");
          }

          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setError("Realtime connection is not ready. Refresh or check Supabase setup.");
          }
        },
      });

      realtimeChannelRef.current = subscription.channel;
      unsubscribeRef.current = subscription.unsubscribe;
    },
    [loadRemoteRoomSettings, loadRoomHistory, loadSnapshot, queueDrawingEvent],
  );

  const handleCreateRoom = useCallback(async () => {
    if (!name.trim()) {
      setError("Add your name first.");
      return;
    }

    setIsBusy(true);
    setError("");

    try {
      const result = await createRoom(name, getRoomSessionKey());
      setIsSpectator(false);
      setSpectatorId(null);
      await enterRoom(result.room, result.player);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create room.");
    } finally {
      setIsBusy(false);
    }
  }, [enterRoom, name]);

  const handleJoinRoom = useCallback(async () => {
    if (!name.trim()) {
      setError("Add your name first.");
      return;
    }

    if (!joinCode.trim()) {
      setError("Add a room code.");
      return;
    }

    setIsBusy(true);
    setError("");

    try {
      if (joinAsSpectator) {
        const snapshot = await fetchRoomSnapshot(joinCode);
        const sessionKey = getRoomSessionKey();
        let nextSpectatorId = `spectator-${sessionKey}`;

        try {
          const spectator = await joinSpectator(joinCode, name, sessionKey);
          nextSpectatorId = spectator.id;
        } catch {
          // Spectator persistence is optional until the migration is applied.
        }

        setSpectatorId(nextSpectatorId);
        setIsSpectator(true);
        await enterRoom(snapshot.room, {
          id: nextSpectatorId,
          joined_at: new Date().toISOString(),
          name: name.trim().slice(0, 24) || "Spectator",
          room_code: snapshot.room.code,
          score: 0,
        });
        return;
      }

      setIsSpectator(false);
      setSpectatorId(null);
      const nextPlayer = await joinRoom(joinCode, name, getRoomSessionKey());
      const snapshot = await fetchRoomSnapshot(joinCode);
      await enterRoom(snapshot.room, nextPlayer);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join room.");
    } finally {
      setIsBusy(false);
    }
  }, [enterRoom, joinAsSpectator, joinCode, name]);

  const handleCopyLink = useCallback(async () => {
    if (!roomLink) {
      return;
    }

    await navigator.clipboard.writeText(roomLink);
    setCopiedInvite("link");
    setNotice("Room link copied.");
  }, [roomLink]);

  const handleCopyCode = useCallback(async () => {
    if (!room) {
      return;
    }

    await navigator.clipboard.writeText(room.code);
    setCopiedInvite("code");
    setNotice("Room code copied.");
  }, [room]);

  const handleCopyResults = useCallback(async () => {
    if (!room || !leader) {
      return;
    }

    const standings = sortedPlayers
      .slice(0, 5)
      .map((item, index) => `${index + 1}. ${item.name} - ${item.score}`)
      .join("\n");

    await navigator.clipboard.writeText(
      `RoomDraw ${room.code}\nWinner: ${leader.name}\n${standings}`,
    );
    setCopiedInvite("results");
    setNotice("Results copied.");
  }, [leader, room, sortedPlayers]);

  const handleLeaveRoom = useCallback(async () => {
    if (!room || !player) {
      return;
    }

    setIsBusy(true);
    setError("");

    try {
      if (!isSpectator) {
        await removePlayer(room.code, player.id);
      } else if (spectatorId) {
        await leaveSpectator(room.code, spectatorId).catch(() => undefined);
      }
      unsubscribeRef.current?.();
      realtimeChannelRef.current = null;
      unsubscribeRef.current = null;
      setRoom(null);
      setPlayers([]);
      setPlayer(null);
      setGuesses([]);
      setIncomingDrawingEvents([]);
      roundDrawingEventsRef.current = [];
      previousRoomStatusRef.current = null;
      setOnlinePlayerIds(null);
      setIsChoosingWord(false);
      setWordChoices([]);
      setIsReplayOpen(false);
      setReplayEvents([]);
      setLastGuessHint("");
      setSpectatorId(null);
      setView("join");
      setNotice("");
      window.history.replaceState(null, "", window.location.pathname);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not leave room.");
    } finally {
      setIsBusy(false);
    }
  }, [isSpectator, player, room, spectatorId]);

  const handleKickPlayer = useCallback(
    async (targetPlayer: Player) => {
      if (!room || !isHost || !currentPlayer || targetPlayer.id === currentPlayer.id) {
        return;
      }

      setIsBusy(true);
      setError("");

      try {
        await kickPlayer(room.code, currentPlayer.id, targetPlayer.id);
        await loadSnapshot(room.code);
        setNotice(`${targetPlayer.name} was removed.`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not remove player.");
      } finally {
        setIsBusy(false);
      }
    },
    [currentPlayer, isHost, loadSnapshot, room],
  );

  const handleRestartRoom = useCallback(async () => {
    if (!room || !isHost || !currentPlayer) {
      return;
    }

    const clearEvent = newSystemDrawingEvent();
    setIsBusy(true);
    setError("");

    try {
      queueDrawingEvent(clearEvent);
      await broadcastDrawingEvent(realtimeChannelRef.current, clearEvent);
      await restartRoom(room.code, currentPlayer.id);
      roundDrawingEventsRef.current = [];
      previousRoomStatusRef.current = null;
      setIsChoosingWord(false);
      setWordChoices([]);
      setIsReplayOpen(false);
      setReplayEvents([]);
      await loadSnapshot(room.code);
      setNotice("Room restarted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restart room.");
    } finally {
      setIsBusy(false);
    }
  }, [currentPlayer, isHost, loadSnapshot, queueDrawingEvent, room]);

  const handleNextRound = useCallback(async () => {
    if (!room || !isHost || !currentPlayer || room.status === "playing") {
      return;
    }

    const clearEvent = newSystemDrawingEvent();
    setIsBusy(true);
    setError("");

    try {
      queueDrawingEvent(clearEvent);
      await broadcastDrawingEvent(realtimeChannelRef.current, clearEvent);
      await prepareNextRound(room.code, currentPlayer.id);
      roundDrawingEventsRef.current = [];
      setIsChoosingWord(false);
      setWordChoices([]);
      setIsReplayOpen(false);
      setReplayEvents([]);
      await loadSnapshot(room.code);
      setNotice("Next round is ready.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare next round.");
    } finally {
      setIsBusy(false);
    }
  }, [currentPlayer, isHost, loadSnapshot, queueDrawingEvent, room]);

  const handlePrepareRound = useCallback(() => {
    if (!room || !presenceReady) {
      setNotice("Connecting players. Try again in a moment.");
      return;
    }

    if (playingPlayers.length < 2) {
      setNotice("Add a second player before starting the round.");
      return;
    }

    if (!isNextDrawer || !nextDrawer) {
      setNotice(`${nextDrawer?.name ?? "Next player"} must choose the word.`);
      return;
    }

    const nextChoices = choicesForSource(roomSettings.wordSource, parsedCustomWords);

    if (nextChoices.length < 3) {
      setNotice("Add at least three custom words, or choose a word pack.");
      return;
    }

    setWordChoices(nextChoices);
    setIsChoosingWord(true);
    setNotice("Choose one word to draw.");
  }, [
    isNextDrawer,
    nextDrawer,
    parsedCustomWords,
    playingPlayers.length,
    presenceReady,
    room,
    roomSettings.wordSource,
  ]);

  const handleStartRound = useCallback(async (word: string) => {
    if (!room || !nextDrawer || !presenceReady || playingPlayers.length < 2 || !word) {
      return;
    }

    const clearEvent = newSystemDrawingEvent();

    setIsBusy(true);
    setError("");

    try {
      await updateRoomSettings(room.code, roomSettingsPatch(roomSettings, parsedCustomWords)).catch(
        () => undefined,
      );
      queueDrawingEvent(clearEvent);
      const broadcasted = await broadcastDrawingEvent(realtimeChannelRef.current, clearEvent);

      if (!broadcasted) {
        setError("Drawing broadcast is not connected yet.");
      }

      await startRound(
        room.code,
        nextDrawer.id,
        word,
        currentPlayer?.id ?? nextDrawer.id,
        roomSettings.roundSeconds,
        roomSettings.maxPlayers,
      );
      await loadSnapshot(room.code);
      setIsChoosingWord(false);
      setWordChoices([]);
      setNotice(`${nextDrawer.name} is drawing.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start round.");
    } finally {
      setIsBusy(false);
    }
  }, [
    currentPlayer,
    loadSnapshot,
    nextDrawer,
    playingPlayers.length,
    presenceReady,
    queueDrawingEvent,
    room,
    roomSettings,
    parsedCustomWords,
  ]);

  const handleDrawingEvent = useCallback((event: DrawingEvent) => {
    rememberDrawingEvent(event);

    void broadcastDrawingEvent(realtimeChannelRef.current, event).then((broadcasted) => {
      if (!broadcasted) {
        setError("Drawing broadcast is not connected yet.");
      }
    });
  }, [rememberDrawingEvent]);

  const handleGuessSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!room || !currentPlayer || !guessText.trim() || isDrawer || isSpectator) {
        return;
      }

      const text = guessText;
      const nowMs = Date.now();

      if (nowMs - lastGuessAtRef.current < 1_000) {
        setLastGuessHint("Slow down a little.");
        return;
      }

      lastGuessAtRef.current = nowMs;
      setGuessText("");
      setError("");
      setLastGuessHint("");

      try {
        const result = await submitGuess(room.code, currentPlayer.id, text);
        await loadSnapshot(room.code);
        if (result.alreadyCorrect) {
          setGuessFeedback({
            kind: "correct",
            text: "You already got it!",
            at: Date.now(),
            round: room.round_number,
          });
          setNotice("");
        } else if (result.isCorrect && result.points > 0) {
          playTone(880, 0.14);
          setGuessFeedback({
            kind: "correct",
            text: `Correct! +${result.points} points${result.typoAccepted ? " (typo accepted)" : ""}`,
            at: Date.now(),
            round: room.round_number,
          });
          setNotice("");
        } else if (result.isCorrect) {
          setGuessFeedback({
            kind: "correct",
            text: `Correct! No speed bonus left${result.typoAccepted ? " (typo accepted)" : ""}`,
            at: Date.now(),
            round: room.round_number,
          });
          setNotice("");
        } else if (result.close) {
          playTone(320, 0.1);
          setGuessFeedback({
            kind: "close",
            text: `"${text}" is not it - but you are very close!`,
            at: Date.now(),
            round: room.round_number,
          });
          setNotice("");
        } else {
          playTone(180, 0.14);
          setGuessFeedback({
            kind: "wrong",
            text: `"${text}" is not the word. Try again!`,
            at: Date.now(),
            round: room.round_number,
          });
          setNotice("");
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not send guess.");
      }
    },
    [currentPlayer, guessText, isDrawer, isSpectator, loadSnapshot, playTone, room],
  );

  if (!supabaseReady) {
    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <BackgroundDoodles />
        <section className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-3xl flex-col justify-center gap-6">
          <div className="pop-card animate-pop-in p-8 text-center">
            <CrayonMascot className="mx-auto w-24 animate-wiggle" />
            <div className="mt-4 flex items-center justify-center gap-3 text-ink">
              <WifiOff aria-hidden className="h-6 w-6" />
              <h1 className="text-3xl font-bold">Oops! Missing Supabase keys</h1>
            </div>
            <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-ink/70">
              Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY locally and
              on Vercel, then run the SQL in supabase/schema.sql. The app is built, but
              rooms need Supabase Realtime to sync between browsers.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const inRoom = view === "room" && room && currentPlayer;
  const timerRatio =
    room && room.status === "playing"
      ? Math.max(0, Math.min(1, secondsLeft / Math.max(roomSettings.roundSeconds, 1)))
      : 1;
  const timerIsLow = room?.status === "playing" && secondsLeft <= 10;
  const showWordPicker = Boolean(
    room && room.status !== "playing" && isChoosingWord && isNextDrawer,
  );

  return (
    <main className="min-h-screen text-ink">
      <BackgroundDoodles />
      {showWinner ? <Confetti /> : null}

      {/* ---------- Full-screen word picker: the drawer's one and only job ---------- */}
      {showWordPicker ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/85 px-4 py-8 backdrop-blur-sm">
          <div className="pop-card animate-pop-in relative w-full max-w-4xl overflow-hidden bg-[linear-gradient(140deg,#fff2c9_0%,#ffe0ef_50%,#d8f2ff_100%)] p-6 text-center sm:p-10">
            <StarDoodle className="absolute left-6 top-6 w-10 animate-wiggle" />
            <StarDoodle className="absolute right-8 top-10 w-8 animate-wiggle [animation-delay:0.5s]" />
            <CrayonMascot className="mx-auto w-20 animate-bounce-soft sm:w-24" />
            <p className="mt-3 text-sm font-bold uppercase tracking-[0.3em] text-candy sm:text-base">
              You are the drawer
            </p>
            <h2 className="mt-1 text-5xl font-bold leading-none tracking-tight text-ink sm:text-7xl">
              Pick your word!
            </h2>
            <p className="mt-3 text-lg font-semibold text-ink/60">
              Everyone else is waiting for you &#128064;
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {wordChoices.map((word, index) => (
                <button
                  className={`pop-btn flex min-h-28 items-center justify-center rounded-3xl px-4 text-2xl font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-36 sm:text-3xl ${
                    ["bg-candy/70", "bg-sunny", "bg-mint"][index % 3]
                  }`}
                  disabled={isBusy}
                  key={word}
                  onClick={() => void handleStartRound(word)}
                  type="button"
                >
                  {word}
                </button>
              ))}
            </div>

            <details className="group mt-6 text-left">
              <summary className="mx-auto w-fit cursor-pointer list-none rounded-full px-4 py-2 text-sm font-bold text-ink/50 transition hover:bg-ink/5 hover:text-ink">
                &#128218; Different word pack?
              </summary>
              <select
                aria-label="Word pack"
                className="pop-field mx-auto mt-3 block h-11 w-full max-w-xs px-3 text-sm font-bold text-ink"
                onChange={(event) => {
                  const nextSource = event.target.value as WordSource;
                  setRoomSettings((settings) => ({
                    ...settings,
                    wordSource: nextSource,
                  }));
                  setWordChoices(choicesForSource(nextSource, parsedCustomWords));
                }}
                value={roomSettings.wordSource}
              >
                {Object.entries(WORD_SOURCE_LABELS).map(([pack, label]) => (
                  <option key={pack} value={pack}>
                    {label}
                  </option>
                ))}
              </select>
            </details>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-3 sm:px-6 lg:px-8">
        {/* ---------- Header: full-size on the join screen, slim once you are playing ---------- */}
        {inRoom && room ? (
          <header className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="flex items-center gap-2">
              <CrayonMascot className="w-8 shrink-0 animate-wiggle" />
              <span className="rainbow-text text-2xl font-bold tracking-tight">RoomDraw</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border-[3px] border-ink/20 bg-white/70 px-3 py-1.5 font-mono text-base font-bold tracking-widest text-ink/70">
                {room.code}
              </span>
              <button
                className="rounded-full border-[3px] border-ink/20 bg-white/70 px-3 py-1.5 text-xs font-bold text-ink/60 transition hover:border-ink hover:text-ink"
                onClick={handleCopyCode}
                type="button"
              >
                {copiedInvite === "code" ? "Copied!" : "Copy code"}
              </button>
              <button
                className="rounded-full border-[3px] border-ink/20 bg-white/70 px-3 py-1.5 text-xs font-bold text-ink/60 transition hover:border-ink hover:text-ink"
                onClick={handleCopyLink}
                type="button"
              >
                {copiedInvite === "link" ? "Copied!" : "Copy link"}
              </button>
              <button
                aria-label={soundEnabled ? "Mute sounds" : "Enable sounds"}
                className="grid h-9 w-9 place-items-center rounded-full border-[3px] border-ink/20 bg-white/70 text-ink/60 transition hover:border-ink hover:text-ink"
                onClick={() => setSoundEnabled((enabled) => !enabled)}
                type="button"
              >
                {soundEnabled ? (
                  <Volume2 aria-hidden className="h-4 w-4" />
                ) : (
                  <VolumeX aria-hidden className="h-4 w-4" />
                )}
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-full border-[3px] border-candy bg-candy/10 px-4 text-sm font-bold text-candy transition hover:bg-candy hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isBusy}
                onClick={handleLeaveRoom}
                type="button"
              >
                <LogOut aria-hidden className="h-4 w-4" />
                Leave the room
              </button>
            </div>
          </header>
        ) : (
          <>
            <header className="flex flex-col items-center gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <CrayonMascot className="w-14 shrink-0 animate-wiggle sm:w-16" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.28em] text-candy">
                    &#10024; Let&apos;s play &#10024;
                  </p>
                  <h1 className="rainbow-text text-4xl font-bold leading-none tracking-tight sm:text-5xl">
                    RoomDraw
                  </h1>
                  <p className="text-sm font-semibold text-ink/60">Draw it. Guess it. Giggle!</p>
                </div>
              </div>
              <div className="pop-card flex items-center gap-2 rounded-full bg-mint px-4 py-2 text-sm font-bold text-ink">
                <Wifi aria-hidden className="h-5 w-5" />
                Share a code and play together &#127881;
              </div>
            </header>
            <SquiggleDoodle className="h-4 w-full text-grape/40" />
          </>
        )}

        {view === "join" ? (
          <section className="grid flex-1 items-center gap-6 py-6 lg:grid-cols-[1fr_420px]">
            <div className="pop-card relative min-h-[460px] overflow-hidden bg-[linear-gradient(140deg,#fff2c9_0%,#ffe0ef_50%,#d8f2ff_100%)]">
              <StarDoodle className="absolute right-8 top-8 w-12 animate-wiggle" />
              <CloudDoodle className="absolute left-6 top-6 w-24 opacity-80 animate-floaty" />
              <PaletteMascot className="absolute -bottom-4 -right-4 w-44 -rotate-6 animate-floaty" />
              <div className="relative flex h-full min-h-[460px] items-center justify-center p-8">
                <div className="w-full max-w-lg">
                  <div className="pop-card mb-5 inline-flex items-center gap-2 rounded-full bg-sunny px-4 py-2 text-sm font-bold text-ink">
                    <Users aria-hidden className="h-5 w-5" />
                    Quick &amp; easy. No signup needed!
                  </div>
                  <h2 className="text-5xl font-bold leading-[1.05] tracking-tight text-ink sm:text-6xl">
                    Draw it <span className="text-candy">fast</span>.
                    <br />
                    Guess it <span className="text-sky">faster</span>!
                  </h2>
                  <p className="mt-5 max-w-md text-lg font-medium leading-8 text-ink/70">
                    Make a room, share the code with friends and play a super speedy round
                    with live drawing, guessing and points. &#128397;
                  </p>
                  <PencilDoodle className="mt-6 w-32 -rotate-6" />
                </div>
              </div>
            </div>

            <form
              className="pop-card animate-pop-in bg-white p-6"
              onSubmit={(event) => {
                event.preventDefault();
                void handleJoinRoom();
              }}
            >
              <label className="block text-base font-bold text-ink" htmlFor="name">
                &#128587; Your name
              </label>
              <input
                className="pop-field mt-2 h-12 w-full px-4 text-lg font-semibold text-ink placeholder:text-ink/30"
                id="name"
                maxLength={24}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ada"
                value={name}
              />

              <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
                <div>
                  <label className="block text-base font-bold text-ink" htmlFor="join-code">
                    &#128273; Room code
                  </label>
                  <input
                    className="pop-field mt-2 h-12 w-full px-4 font-mono text-lg font-bold uppercase tracking-widest text-ink placeholder:text-ink/30"
                    id="join-code"
                    maxLength={5}
                    onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
                    placeholder="A7K2Q"
                    value={joinCode}
                  />
                </div>
                <button
                  className="pop-btn mt-9 inline-flex h-12 items-center justify-center gap-2 bg-sky px-5 text-base font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isBusy}
                  type="submit"
                >
                  {isBusy ? (
                    <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send aria-hidden className="h-5 w-5" />
                  )}
                  Join
                </button>
              </div>

              <button
                className="pop-btn mt-5 inline-flex h-14 w-full items-center justify-center gap-2 bg-candy px-4 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isBusy}
                onClick={handleCreateRoom}
                type="button"
              >
                {isBusy ? (
                  <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
                ) : (
                  <Plus aria-hidden className="h-5 w-5" />
                )}
                Create a room!
              </button>

              <label className="pop-field mt-5 flex cursor-pointer items-center gap-3 px-4 py-3 text-base font-semibold text-ink">
                <input
                  checked={joinAsSpectator}
                  className="h-5 w-5 accent-grape"
                  onChange={(event) => setJoinAsSpectator(event.target.checked)}
                  type="checkbox"
                />
                &#128064; Just watching this time
              </label>

              {error ? (
                <p className="pop-card mt-4 bg-candy/15 p-3 text-base font-bold text-candy">
                  {error}
                </p>
              ) : null}
            </form>
          </section>
        ) : null}

        {inRoom && room && currentPlayer ? (
          <section className="grid flex-1 min-h-0 gap-4 py-2 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* ================= PRIMARY COLUMN: action bar + canvas ================= */}
            <div className="flex min-h-0 flex-col gap-3">
              {/* ---- The one thing you need to do right now, in line with the canvas ---- */}
              {room.status === "playing" ? (
                isDrawer ? (
                  <div className="pop-card flex flex-wrap items-center justify-between gap-3 bg-ink px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.28em] text-white/50">
                        &#127912; You are drawing
                      </p>
                      <p className="truncate text-4xl font-bold leading-tight text-sunny sm:text-5xl">
                        {room.current_word}
                      </p>
                    </div>
                    <div
                      className={`shrink-0 rounded-2xl px-5 py-2 text-center ${
                        timerIsLow ? "animate-bounce-soft bg-candy" : "bg-white/10"
                      }`}
                    >
                      <p
                        className={`text-4xl font-bold tabular-nums ${
                          timerIsLow ? "text-white" : "text-white"
                        }`}
                      >
                        {secondsLeft}s
                      </p>
                    </div>
                  </div>
                ) : isSpectator ? (
                  <div className="pop-card flex items-center justify-between gap-3 bg-grape/20 px-5 py-4">
                    <p className="text-xl font-bold text-ink">
                      &#128064; Spectating {drawer?.name ?? "the drawer"}
                    </p>
                    <p className="text-3xl font-bold tabular-nums text-ink">{secondsLeft}s</p>
                  </div>
                ) : (
                  <form
                    className={`pop-card flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap ${
                      timerIsLow ? "bg-candy/20" : "bg-sunny/40"
                    }`}
                    onSubmit={handleGuessSubmit}
                  >
                    <label
                      className="shrink-0 text-base font-bold text-ink sm:text-lg"
                      htmlFor="guess-input"
                    >
                      &#129300; Your guess
                    </label>
                    <input
                      autoComplete="off"
                      className="pop-field h-14 min-w-0 flex-1 px-4 text-xl font-bold text-ink placeholder:font-semibold placeholder:text-ink/30 sm:h-16 sm:text-2xl"
                      id="guess-input"
                      onChange={(event) => setGuessText(event.target.value)}
                      placeholder="Type it here..."
                      value={guessText}
                    />
                    <button
                      className="pop-btn inline-flex h-14 shrink-0 items-center justify-center gap-2 bg-candy px-6 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:h-16"
                      disabled={!guessText.trim()}
                      type="submit"
                    >
                      <Send aria-hidden className="h-5 w-5" />
                      Send
                    </button>
                    <div
                      className={`grid h-14 w-20 shrink-0 place-items-center rounded-2xl border-[3px] border-ink sm:h-16 ${
                        timerIsLow ? "animate-bounce-soft bg-candy text-white" : "bg-white text-ink"
                      }`}
                    >
                      <span className="text-3xl font-bold tabular-nums">{secondsLeft}s</span>
                    </div>
                    {guessFeedback && guessFeedback.round === room.round_number ? (
                      <p
                        aria-live="assertive"
                        className={`w-full rounded-2xl border-[3px] border-ink px-4 py-2 text-center text-lg font-bold ${
                          guessFeedback.kind === "correct"
                            ? "animate-pop-in bg-mint text-ink"
                            : guessFeedback.kind === "close"
                              ? "animate-pop-in bg-tangerine text-ink"
                              : "animate-shake bg-candy text-white"
                        }`}
                        key={guessFeedback.at}
                      >
                        {guessFeedback.kind === "correct"
                          ? "✅ "
                          : guessFeedback.kind === "close"
                            ? "\u{1F525} "
                            : "❌ "}
                        {guessFeedback.text}
                      </p>
                    ) : null}
                  </form>
                )
              ) : room.status === "round_end" ? (
                <div className="pop-card animate-pop-in flex flex-wrap items-center justify-between gap-4 bg-mint/30 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.28em] text-ink/50">
                      &#127937; The word was
                    </p>
                    <p className="truncate text-4xl font-bold leading-tight text-ink sm:text-5xl">
                      {room.current_word}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {correctGuesses.length === 0 ? (
                      <span className="text-base font-bold text-ink/50">
                        Nobody got it! &#128586;
                      </span>
                    ) : (
                      correctGuesses.slice(0, 3).map((guess, index) => (
                        <span
                          className="rounded-full border-[3px] border-ink bg-white px-3 py-1.5 text-sm font-bold text-ink"
                          key={guess.id}
                        >
                          {MEDALS[index] ?? "\u{1F389}"} {playerNameForGuess(guess, players)}
                        </span>
                      ))
                    )}
                    {isHost ? (
                      <button
                        className="pop-btn inline-flex h-12 items-center justify-center gap-2 bg-candy px-5 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isBusy || Boolean(showWinner)}
                        onClick={handleNextRound}
                        type="button"
                      >
                        <SkipForward aria-hidden className="h-5 w-5" />
                        Next round
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : isNextDrawer ? (
                <div className="pop-card animate-pop-in flex flex-wrap items-center justify-between gap-3 bg-sunny px-5 py-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.28em] text-ink/50">
                      &#127912; It&apos;s your turn to draw
                    </p>
                    <p className="text-2xl font-bold text-ink sm:text-3xl">
                      Ready when you are!
                    </p>
                  </div>
                  <button
                    className="pop-btn inline-flex h-14 items-center justify-center gap-2 bg-candy px-6 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isBusy || !presenceReady || playingPlayers.length < 2}
                    onClick={handlePrepareRound}
                    type="button"
                  >
                    {isBusy ? (
                      <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
                    ) : (
                      <Play aria-hidden className="h-5 w-5" />
                    )}
                    Pick a word
                  </button>
                </div>
              ) : (
                <div className="pop-card flex flex-wrap items-center gap-3 bg-white px-5 py-4">
                  <Loader2 aria-hidden className="h-6 w-6 shrink-0 animate-spin text-grape" />
                  <p className="text-xl font-bold text-ink sm:text-2xl">
                    {playingPlayers.length < 2
                      ? "Waiting for one more friend to join... \u{1F388}"
                      : `${nextDrawer?.name ?? "The next drawer"} is picking a word...`}
                  </p>
                </div>
              )}

              {room.status === "playing" ? (
                <div className="h-3 w-full overflow-hidden rounded-full border-[3px] border-ink bg-white">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-linear ${
                      timerIsLow ? "bg-candy" : "bg-mint"
                    }`}
                    style={{ width: `${timerRatio * 100}%` }}
                  />
                </div>
              ) : null}

              <DrawingCanvas
                canDraw={isDrawer && room.status === "playing"}
                clientId={currentPlayer.id}
                incomingEvents={incomingDrawingEvents}
                onDrawingEvent={handleDrawingEvent}
              />

              {notice || error ? (
                <p
                  aria-live="polite"
                  className={`pop-card animate-pop-in rounded-2xl px-4 py-2 text-center text-base font-bold text-ink ${
                    error ? "bg-candy/25" : "bg-mint/30"
                  }`}
                >
                  {error || notice}
                </p>
              ) : null}
              {lastGuessHint ? (
                <p className="rounded-2xl bg-sunny/50 px-4 py-2 text-center text-base font-bold text-ink">
                  {lastGuessHint}
                </p>
              ) : null}
            </div>

            {/* ================= SECONDARY COLUMN: quieter supporting info ================= */}
            <aside className="flex min-h-0 flex-col gap-3">
              {showWinner ? (
                <section className="pop-card animate-pop-in relative overflow-hidden bg-[linear-gradient(140deg,#fff2c9_0%,#ffe0ef_100%)] p-4">
                  <RainbowDoodle className="absolute -right-6 -top-2 w-32 opacity-60" />
                  <h2 className="relative text-xs font-bold uppercase tracking-[0.18em] text-ink/60">
                    &#127942; Final results
                  </h2>
                  <p className="relative mt-1 text-2xl font-bold text-ink">
                    {showWinner.name} wins! &#127881;
                  </p>
                  <p className="relative text-sm font-semibold text-ink/60">
                    {showWinner.score} points
                  </p>
                  <div className="relative mt-3 space-y-1.5">
                    {sortedPlayers.slice(0, 5).map((item, index) => (
                      <div
                        className="flex items-center justify-between rounded-xl border-2 border-ink/15 bg-white/80 px-3 py-1.5 text-sm"
                        key={item.id}
                      >
                        <span className="font-bold text-ink">
                          {MEDALS[index] ?? `${index + 1}.`} {item.name}
                        </span>
                        <span className="font-mono font-bold text-ink">{item.score}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    className="pop-btn relative mt-3 inline-flex h-11 w-full items-center justify-center gap-2 bg-candy px-3 text-sm font-bold text-white"
                    onClick={handleCopyResults}
                    type="button"
                  >
                    <Copy aria-hidden className="h-4 w-4" />
                    {copiedInvite === "results" ? "Copied! \u{1F389}" : "Copy results"}
                  </button>
                </section>
              ) : null}

              {/* Scoreboard — quiet card, colour only on the active drawer */}
              <section className="pop-card border-ink/15 bg-white p-3 shadow-none">
                <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-ink/45">
                  <Crown aria-hidden className="h-4 w-4" />
                  Players {playingPlayers.length}/{effectiveMaxPlayers}
                </h2>
                <div className="space-y-1.5">
                  {playingPlayers.map((item, index) => {
                    const isDrawing = item.id === room.drawer_player_id;

                    return (
                      <div
                        className={`flex items-center justify-between gap-2 rounded-xl border-2 px-2.5 py-1.5 ${
                          isDrawing
                            ? "border-ink bg-sunny"
                            : "border-ink/10 bg-ink/[0.03]"
                        }`}
                        key={item.id}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-base" aria-hidden>
                            {PLAYER_AVATARS[index % PLAYER_AVATARS.length]}
                          </span>
                          <p
                            className={`truncate text-sm font-bold ${
                              isDrawing ? "text-ink" : "text-ink/75"
                            }`}
                          >
                            {item.name}
                            {index === 0 ? " \u{1F451}" : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="font-mono text-sm font-bold text-ink/70">
                            {item.score}
                          </span>
                          {isHost && item.id !== currentPlayer.id ? (
                            <button
                              aria-label={`Remove ${item.name}`}
                              className="grid h-6 w-6 place-items-center rounded-full text-ink/30 transition hover:bg-candy/15 hover:text-candy disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={isBusy}
                              onClick={() => void handleKickPlayer(item)}
                              title="Remove player"
                              type="button"
                            >
                              <UserMinus aria-hidden className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Live guess feed — read only, the input lives up top next to the canvas */}
              <section className="pop-card flex min-h-[200px] flex-1 flex-col border-ink/15 bg-white p-3 shadow-none">
                <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-ink/45">
                  &#128172; Guess feed
                </h2>
                <div
                  className="fun-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1"
                  ref={guessFeedRef}
                >
                  {visibleGuesses.length === 0 ? (
                    <p className="rounded-xl border-2 border-dashed border-ink/15 p-3 text-center text-xs font-bold text-ink/35">
                      Guesses show up here
                    </p>
                  ) : (
                    visibleGuesses.map((guess) => (
                      <div
                        className={`animate-pop-in rounded-xl border-2 px-2.5 py-1.5 text-sm ${
                          guess.is_correct
                            ? "border-ink bg-mint/40"
                            : "border-candy/25 bg-candy/[0.06]"
                        }`}
                        key={guess.id}
                      >
                        <span className="font-bold text-ink/80">
                          {playerNameForGuess(guess, players)}:
                        </span>{" "}
                        <span
                          className={
                            guess.is_correct ? "font-bold text-ink" : "font-semibold text-ink/60"
                          }
                        >
                          {guess.is_correct ? (
                            "got it! \u{1F389}"
                          ) : (
                            <>
                              <span className="line-through">{guess.text}</span>{" "}
                              <span aria-label="wrong" role="img" title="Not the word">
                                &#10060;
                              </span>
                            </>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Everything you rarely touch, folded away */}
              <details className="group rounded-2xl border-[3px] border-ink/15 bg-white/60">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-ink/45 transition hover:text-ink">
                  <Settings aria-hidden className="h-4 w-4" />
                  Room &amp; settings
                  <span aria-hidden className="ml-auto transition group-open:rotate-90">
                    &#9656;
                  </span>
                </summary>
                <div className="space-y-3 px-3 pb-3">
                  <div className="flex items-center gap-3 rounded-xl border-2 border-ink/10 bg-white p-2">
                    <Image
                      alt="Room QR code"
                      className="h-16 w-16 rounded-lg border-2 border-ink/20 bg-white p-1"
                      height={64}
                      src={qrCodeUrl}
                      unoptimized
                      width={64}
                    />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-ink/40">
                        <QrCode aria-hidden className="h-3.5 w-3.5" />
                        Join from a phone
                      </p>
                      <p className="mt-0.5 font-mono text-lg font-bold tracking-widest text-ink/70">
                        {room.code}
                      </p>
                    </div>
                  </div>

                  {isHost ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] font-bold text-ink/50">
                          Seconds
                          <input
                            className="pop-field mt-1 h-9 w-full border-ink/20 px-2 text-sm font-bold text-ink"
                            disabled={room.status === "playing"}
                            max={180}
                            min={30}
                            onChange={(event) =>
                              setRoomSettings((settings) => ({
                                ...settings,
                                roundSeconds: Number(event.target.value),
                              }))
                            }
                            type="number"
                            value={roomSettings.roundSeconds}
                          />
                        </label>
                        <label className="text-[11px] font-bold text-ink/50">
                          Rounds
                          <input
                            className="pop-field mt-1 h-9 w-full border-ink/20 px-2 text-sm font-bold text-ink"
                            disabled={room.status === "playing"}
                            max={12}
                            min={1}
                            onChange={(event) =>
                              setRoomSettings((settings) => ({
                                ...settings,
                                totalRounds: Number(event.target.value),
                              }))
                            }
                            type="number"
                            value={roomSettings.totalRounds}
                          />
                        </label>
                        <label className="text-[11px] font-bold text-ink/50">
                          Max players
                          <input
                            className="pop-field mt-1 h-9 w-full border-ink/20 px-2 text-sm font-bold text-ink"
                            disabled={room.status === "playing"}
                            max={MAX_PLAYERS_PER_ROOM}
                            min={2}
                            onChange={(event) =>
                              setRoomSettings((settings) => ({
                                ...settings,
                                maxPlayers: Number(event.target.value),
                              }))
                            }
                            type="number"
                            value={roomSettings.maxPlayers}
                          />
                        </label>
                        <label className="text-[11px] font-bold text-ink/50">
                          Language
                          <select
                            className="pop-field mt-1 h-9 w-full border-ink/20 px-2 text-sm font-bold text-ink"
                            disabled={room.status === "playing"}
                            onChange={(event) =>
                              setRoomSettings((settings) => ({
                                ...settings,
                                language: event.target.value as RoomLanguage,
                                wordSource:
                                  event.target.value === "Croatian"
                                    ? "croatian"
                                    : settings.wordSource,
                              }))
                            }
                            value={roomSettings.language}
                          >
                            {Object.entries(LANGUAGE_LABELS).map(([language, label]) => (
                              <option key={language} value={language}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[11px] font-bold text-ink/50">
                          Word pack
                          <select
                            className="pop-field mt-1 h-9 w-full border-ink/20 px-2 text-sm font-bold text-ink"
                            disabled={room.status === "playing"}
                            onChange={(event) =>
                              setRoomSettings((settings) => ({
                                ...settings,
                                wordSource: event.target.value as WordSource,
                              }))
                            }
                            value={roomSettings.wordSource}
                          >
                            {Object.entries(WORD_SOURCE_LABELS).map(([source, label]) => (
                              <option key={source} value={source}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[11px] font-bold text-ink/50">
                          Scoring
                          <select
                            className="pop-field mt-1 h-9 w-full border-ink/20 px-2 text-sm font-bold text-ink"
                            disabled={room.status === "playing"}
                            onChange={(event) =>
                              setRoomSettings((settings) => ({
                                ...settings,
                                scoringMode: event.target.value as ScoringMode,
                              }))
                            }
                            value={roomSettings.scoringMode}
                          >
                            {Object.entries(SCORING_LABELS).map(([mode, label]) => (
                              <option key={mode} value={mode}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="col-span-2 text-[11px] font-bold text-ink/50">
                          Custom words
                          <textarea
                            className="pop-field mt-1 min-h-14 w-full border-ink/20 px-2 py-1.5 text-sm font-semibold text-ink placeholder:text-ink/25"
                            disabled={room.status === "playing"}
                            onChange={(event) => setCustomWordsText(event.target.value)}
                            placeholder="cat, rocket, ice cream"
                            value={customWordsText}
                          />
                        </label>
                        <label className="col-span-2 flex items-center gap-2 text-[11px] font-bold text-ink/50">
                          <input
                            checked={roomSettings.hideIncorrectGuesses}
                            className="h-4 w-4 accent-grape"
                            disabled={room.status === "playing"}
                            onChange={(event) =>
                              setRoomSettings((settings) => ({
                                ...settings,
                                hideIncorrectGuesses: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          Hide other players&apos; wrong guesses
                        </label>
                      </div>
                      <button
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border-2 border-ink/20 px-3 text-xs font-bold text-ink/50 transition hover:border-candy hover:text-candy disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isBusy}
                        onClick={handleRestartRoom}
                        type="button"
                      >
                        <RotateCcw aria-hidden className="h-4 w-4" />
                        Restart game
                      </button>
                    </>
                  ) : null}
                </div>
              </details>
            </aside>
          </section>
        ) : null}
      </div>
      {isReplayOpen ? (
        <DrawingReplayModal
          events={replayEvents}
          onClose={() => setIsReplayOpen(false)}
          word={room?.current_word ?? null}
        />
      ) : null}
    </main>
  );
}
