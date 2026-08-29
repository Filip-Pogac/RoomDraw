"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import type {
  DrawingEvent,
  FinalRoomResult,
  Guess,
  Player,
  PlayerStanding,
  Room,
  RoomSnapshot,
  RoomSettings,
  RoomSubscription,
  RoundEndReason,
  RoundResultEntry,
  SavedRoundSummary,
  Spectator,
} from "@/types/game";

export const MAX_PLAYERS_PER_ROOM = 10;
export const ROUND_SECONDS = 90;

export const WORD_PACKS = {
  easy: [
    "rocket",
    "pizza",
    "camera",
    "island",
    "dragon",
    "guitar",
    "robot",
    "castle",
    "trophy",
    "umbrella",
    "volcano",
    "bicycle",
  ],
  hard: [
    "microscope",
    "parachute",
    "labyrinth",
    "accordion",
    "submarine",
    "windmill",
    "observatory",
    "typewriter",
    "compass",
    "hourglass",
    "sphinx",
    "catapult",
  ],
  croatian: [
    "more",
    "brod",
    "zmaj",
    "kava",
    "sir",
    "lopta",
    "kišobran",
    "čokolada",
    "avion",
    "knjiga",
    "otkriće",
    "glazba",
  ],
  movies: [
    "lightsaber",
    "popcorn",
    "clapperboard",
    "spaceship",
    "detective",
    "wizard",
    "superhero",
    "monster",
    "red carpet",
    "movie ticket",
    "camera crew",
    "time machine",
  ],
  animals: [
    "elephant",
    "penguin",
    "octopus",
    "dolphin",
    "tiger",
    "koala",
    "flamingo",
    "giraffe",
    "butterfly",
    "shark",
    "panda",
    "crocodile",
  ],
  tech: [
    "keyboard",
    "database",
    "satellite",
    "server",
    "microchip",
    "headphones",
    "router",
    "laptop",
    "joystick",
    "smartwatch",
    "password",
    "webcam",
  ],
} as const;

export type WordPack = keyof typeof WORD_PACKS;

export const WORD_PACK_LABELS: Record<WordPack, string> = {
  easy: "Easy",
  hard: "Hard",
  croatian: "Croatian",
  movies: "Movies",
  animals: "Animals",
  tech: "Tech",
};

export const DEFAULT_ROOM_SETTINGS = {
  round_seconds: ROUND_SECONDS,
  round_limit: 5,
  language: "en",
  word_pack: "easy",
  max_players: MAX_PLAYERS_PER_ROOM,
  scoring_mode: "speed",
  custom_words: [] as string[],
} satisfies Omit<RoomSettings, "room_code" | "created_at" | "updated_at">;

export type RoomSettingsPatch = Partial<
  Pick<
    RoomSettings,
    | "custom_words"
    | "language"
    | "max_players"
    | "round_limit"
    | "round_seconds"
    | "scoring_mode"
    | "word_pack"
  >
>;

export type SaveRoundSummaryInput = {
  roomCode: string;
  roundNumber: number;
  word: string;
  drawerPlayerId?: string | null;
  startedAt?: string | null;
  endedAt?: string;
  endedReason?: RoundEndReason;
  drawingEvents?: DrawingEvent[];
  drawingImage?: string | null;
  results?: RoundResultEntry[];
  standings?: PlayerStanding[];
};

export type SaveFinalResultInput = {
  roomCode: string;
  winnerPlayerId?: string | null;
  roundsPlayed: number;
  standings: PlayerStanding[];
  topDrawings?: SavedRoundSummary[];
  sharePayload?: Record<string, unknown>;
  completedAt?: string;
};

function requireSupabase() {
  const supabase = getSupabase();

  if (!supabase) {
    throw new Error("Supabase env vars are missing.");
  }

  return supabase;
}

async function callGameAction<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/game", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error ?? "Game action failed.");
  }

  return result as T;
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizeCustomWords(words: string[]) {
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))]
    .map((word) => word.slice(0, 40))
    .slice(0, 100);
}

function normalizeRoomSettingsPatch(settings: RoomSettingsPatch) {
  const patch: Record<string, unknown> = {};

  if (settings.round_seconds !== undefined) {
    patch.round_seconds = clampInt(settings.round_seconds, 15, 300);
  }

  if (settings.round_limit !== undefined) {
    patch.round_limit = clampInt(settings.round_limit, 1, 20);
  }

  if (settings.language !== undefined) {
    patch.language = settings.language.trim().slice(0, 24) || DEFAULT_ROOM_SETTINGS.language;
  }

  if (settings.word_pack !== undefined) {
    patch.word_pack = settings.word_pack.trim().slice(0, 32) || DEFAULT_ROOM_SETTINGS.word_pack;
  }

  if (settings.max_players !== undefined) {
    patch.max_players = clampInt(settings.max_players, 2, MAX_PLAYERS_PER_ROOM);
  }

  if (settings.scoring_mode !== undefined) {
    patch.scoring_mode = settings.scoring_mode;
  }

  if (settings.custom_words !== undefined) {
    patch.custom_words = sanitizeCustomWords(settings.custom_words);
  }

  return patch;
}

export function randomWord(pack: WordPack = "easy"): string {
  const words = WORD_PACKS[pack] ?? WORD_PACKS.easy;
  return words[Math.floor(Math.random() * words.length)];
}

export function getWordChoices(pack: WordPack = "easy", count = 3): string[] {
  return [...(WORD_PACKS[pack] ?? WORD_PACKS.easy)]
    .sort(() => Math.random() - 0.5)
    .slice(0, count);
}

export function normalizeRoomCode(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase();
}

export function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}

export function normalizeGuess(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function ensureRoomSettings(roomCode: string, settings: RoomSettingsPatch = {}) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { data, error } = await supabase
    .from("room_settings")
    .upsert(
      {
        room_code: code,
        ...normalizeRoomSettingsPatch(settings),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "room_code" },
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save room settings.");
  }

  return data as RoomSettings;
}

export async function fetchRoomSettings(roomCode: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { data, error } = await supabase
    .from("room_settings")
    .select("*")
    .eq("room_code", code)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? (data as RoomSettings) : ensureRoomSettings(code);
}

export async function updateRoomSettings(roomCode: string, settings: RoomSettingsPatch) {
  return ensureRoomSettings(roomCode, settings);
}

export async function addCustomWords(roomCode: string, words: string[]) {
  const settings = await fetchRoomSettings(roomCode);
  const customWords = sanitizeCustomWords([...settings.custom_words, ...words]);

  return updateRoomSettings(roomCode, { custom_words: customWords });
}

export async function createRoom(playerName: string, sessionKey?: string) {
  const supabase = requireSupabase();
  let room: Room | null = null;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 5 && !room; attempt += 1) {
    const code = generateRoomCode();
    const { data, error } = await supabase
      .from("rooms")
      .insert({ code, status: "lobby" })
      .select()
      .single();

    if (!error && data) {
      room = data as Room;
      break;
    }

    lastError = new Error(error?.message ?? "Could not create room.");
  }

  if (!room) {
    throw lastError ?? new Error("Could not create room.");
  }

  const player = await joinRoom(room.code, playerName, sessionKey);
  return { room, player };
}

export async function joinRoom(roomCode: string, playerName: string, sessionKey?: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);
  const safeName = playerName.trim().slice(0, 24) || "Player";
  const safeSessionKey = sessionKey?.trim().slice(0, 128) || null;
  let canUseSession = Boolean(safeSessionKey);

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .single();

  if (roomError || !room) {
    throw new Error("Room not found.");
  }

  if (safeSessionKey) {
    const { data: existingPlayer, error: existingPlayerError } = await supabase
      .from("players")
      .select("*")
      .eq("room_code", code)
      .eq("session_key", safeSessionKey)
      .maybeSingle();

    if (existingPlayerError) {
      canUseSession = false;
    }

    if (existingPlayer) {
      const { data: reconnectedPlayer, error: reconnectError } = await supabase
        .from("players")
        .update({
          disconnected_at: null,
          last_seen_at: new Date().toISOString(),
          name: safeName,
        })
        .eq("room_code", code)
        .eq("id", (existingPlayer as Player).id)
        .select()
        .single();

      if (reconnectError || !reconnectedPlayer) {
        throw new Error(reconnectError?.message ?? "Could not reconnect player.");
      }

      return reconnectedPlayer as Player;
    }
  }

  const { data: existingPlayers, error: playersError } = await supabase
    .from("players")
    .select("name")
    .eq("room_code", code);

  if (playersError) {
    throw new Error(playersError.message);
  }

  const maxPlayers = await fetchRoomSettings(code)
    .then((settings) => Math.min(settings.max_players, MAX_PLAYERS_PER_ROOM))
    .catch(() => MAX_PLAYERS_PER_ROOM);

  if ((existingPlayers?.length ?? 0) >= maxPlayers) {
    throw new Error("Room is full.");
  }

  const usedNames = new Set((existingPlayers ?? []).map((item) => item.name.toLowerCase()));
  let uniqueName = safeName;
  let suffix = 2;

  while (usedNames.has(uniqueName.toLowerCase())) {
    uniqueName = `${safeName} ${suffix}`.slice(0, 24);
    suffix += 1;
  }

  const playerPayload: Record<string, unknown> = {
    name: uniqueName,
    room_code: code,
  };

  if (canUseSession && safeSessionKey) {
    playerPayload.disconnected_at = null;
    playerPayload.last_seen_at = new Date().toISOString();
    playerPayload.session_key = safeSessionKey;
  }

  const { data: player, error: playerError } = await supabase
    .from("players")
    .insert(playerPayload)
    .select()
    .single();

  if (playerError || !player) {
    throw new Error(playerError?.message ?? "Could not join room.");
  }

  return player as Player;
}

export async function resetRound(roomCode: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { error: guessesError } = await supabase
    .from("guesses")
    .delete()
    .eq("room_code", code);

  if (guessesError) {
    throw new Error(guessesError.message);
  }

  const { data, error } = await supabase
    .from("rooms")
    .update({
      status: "lobby",
      current_word: null,
      drawer_player_id: null,
      round_ends_at: null,
    })
    .eq("code", code)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not reset round.");
  }

  return data as Room;
}

export async function prepareNextRound(roomCode: string, actorPlayerId: string) {
  const result = await callGameAction<{ room: Room }>({
    action: "prepareNextRound",
    actorPlayerId,
    roomCode,
  });

  return result.room;
}

export async function restartRoom(roomCode: string, actorPlayerId: string) {
  const result = await callGameAction<{ room: Room }>({
    action: "restartRoom",
    actorPlayerId,
    roomCode,
  });

  return result.room;
}

export async function removePlayer(roomCode: string, playerId: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { error } = await supabase
    .from("players")
    .delete()
    .eq("room_code", code)
    .eq("id", playerId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function findReconnectablePlayer(roomCode: string, sessionKey: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);
  const safeSessionKey = sessionKey.trim().slice(0, 128);

  if (!safeSessionKey) {
    return null;
  }

  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("room_code", code)
    .eq("session_key", safeSessionKey)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as Player | null) ?? null;
}

export async function markPlayerConnected(roomCode: string, playerId: string, sessionKey?: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);
  const update: Record<string, unknown> = {
    disconnected_at: null,
    last_seen_at: new Date().toISOString(),
  };

  if (sessionKey?.trim()) {
    update.session_key = sessionKey.trim().slice(0, 128);
  }

  const { data, error } = await supabase
    .from("players")
    .update(update)
    .eq("room_code", code)
    .eq("id", playerId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not mark player connected.");
  }

  return data as Player;
}

export async function markPlayerDisconnected(roomCode: string, playerId: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { data, error } = await supabase
    .from("players")
    .update({
      disconnected_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .eq("room_code", code)
    .eq("id", playerId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not mark player disconnected.");
  }

  return data as Player;
}

export function removePlayerOnExit(roomCode: string, playerId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return;
  }

  const baseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const code = normalizeRoomCode(roomCode);
  const url = new URL(`${baseUrl}/rest/v1/players`);
  url.searchParams.set("room_code", `eq.${code}`);
  url.searchParams.set("id", `eq.${playerId}`);

  void fetch(url, {
    body: JSON.stringify({
      disconnected_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    }),
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    keepalive: true,
  });
}

export async function fetchRoomSnapshot(roomCode: string): Promise<RoomSnapshot> {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const [roomResult, playersResult, guessesResult] = await Promise.all([
    supabase.from("rooms").select("*").eq("code", code).single(),
    supabase
      .from("players")
      .select("*")
      .eq("room_code", code)
      .order("joined_at", { ascending: true }),
    supabase
      .from("guesses")
      .select("*")
      .eq("room_code", code)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (roomResult.error || !roomResult.data) {
    throw new Error(roomResult.error?.message ?? "Room not found.");
  }

  if (playersResult.error) {
    throw new Error(playersResult.error.message);
  }

  if (guessesResult.error) {
    throw new Error(guessesResult.error.message);
  }

  return {
    room: roomResult.data as Room,
    players: (playersResult.data ?? []) as Player[],
    guesses: ((guessesResult.data ?? []) as Guess[]).reverse(),
  };
}

export async function startRound(
  roomCode: string,
  drawerPlayerId: string,
  word: string = randomWord(),
  actorPlayerId = drawerPlayerId,
  roundSeconds = ROUND_SECONDS,
  maxPlayers = MAX_PLAYERS_PER_ROOM,
) {
  const result = await callGameAction<{ room: Room }>({
    action: "startRound",
    actorPlayerId,
    drawerPlayerId,
    maxPlayers,
    roomCode,
    roundSeconds,
    word,
  });

  return result.room;
}

export async function endRound(roomCode: string) {
  const result = await callGameAction<{ room: Room | null }>({
    action: "endRound",
    roomCode,
  });

  return result.room;
}

export async function submitGuess(
  roomCode: string,
  playerId: string,
  text: string,
) {
  return callGameAction<{
    alreadyCorrect: boolean;
    close: boolean;
    isCorrect: boolean;
    points: number;
    typoAccepted: boolean;
  }>({
    action: "submitGuess",
    playerId,
    roomCode,
    text,
  });
}

export async function updatePlayerScore(roomCode: string, playerId: string, score: number) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { error } = await supabase
    .from("players")
    .update({ score })
    .eq("room_code", code)
    .eq("id", playerId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function kickPlayer(roomCode: string, actorPlayerId: string, targetPlayerId: string) {
  await callGameAction({
    action: "kickPlayer",
    actorPlayerId,
    roomCode,
    targetPlayerId,
  });
}

export async function saveRoundSummary(input: SaveRoundSummaryInput) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(input.roomCode);

  const { data, error } = await supabase
    .from("round_summaries")
    .upsert(
      {
        drawer_player_id: input.drawerPlayerId ?? null,
        drawing_events: input.drawingEvents ?? [],
        drawing_image: input.drawingImage ?? null,
        ended_at: input.endedAt ?? new Date().toISOString(),
        ended_reason: input.endedReason ?? "manual",
        results: input.results ?? [],
        room_code: code,
        round_number: input.roundNumber,
        standings: input.standings ?? [],
        started_at: input.startedAt ?? null,
        word: input.word.trim().slice(0, 80) || "unknown",
      },
      { onConflict: "room_code,round_number" },
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save round summary.");
  }

  return data as SavedRoundSummary;
}

export async function fetchRoundHistory(roomCode: string, limit = 20) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { data, error } = await supabase
    .from("round_summaries")
    .select("*")
    .eq("room_code", code)
    .order("round_number", { ascending: false })
    .limit(clampInt(limit, 1, 100));

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SavedRoundSummary[];
}

export async function fetchLatestRoundSummary(roomCode: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { data, error } = await supabase
    .from("round_summaries")
    .select("*")
    .eq("room_code", code)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SavedRoundSummary | null) ?? null;
}

export async function saveFinalResult(input: SaveFinalResultInput) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(input.roomCode);

  const { data, error } = await supabase
    .from("final_results")
    .insert({
      completed_at: input.completedAt ?? new Date().toISOString(),
      room_code: code,
      rounds_played: Math.max(0, Math.round(input.roundsPlayed)),
      share_payload: input.sharePayload ?? {},
      standings: input.standings,
      top_drawings: input.topDrawings ?? [],
      winner_player_id: input.winnerPlayerId ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save final result.");
  }

  return data as FinalRoomResult;
}

export async function fetchFinalResults(roomCode: string, limit = 10) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { data, error } = await supabase
    .from("final_results")
    .select("*")
    .eq("room_code", code)
    .order("completed_at", { ascending: false })
    .limit(clampInt(limit, 1, 50));

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as FinalRoomResult[];
}

export async function joinSpectator(roomCode: string, name: string, sessionKey?: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);
  const safeName = name.trim().slice(0, 24) || "Spectator";
  const safeSessionKey = sessionKey?.trim().slice(0, 128) || null;
  const payload = {
    last_seen_at: new Date().toISOString(),
    name: safeName,
    room_code: code,
    session_key: safeSessionKey,
  };
  const write = safeSessionKey
    ? supabase.from("spectators").upsert(payload, { onConflict: "room_code,session_key" })
    : supabase.from("spectators").insert(payload);
  const { data, error } = await write.select().single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not join as spectator.");
  }

  return data as Spectator;
}

export async function touchSpectator(roomCode: string, spectatorId: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { data, error } = await supabase
    .from("spectators")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("room_code", code)
    .eq("id", spectatorId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not update spectator.");
  }

  return data as Spectator;
}

export async function leaveSpectator(roomCode: string, spectatorId: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { error } = await supabase
    .from("spectators")
    .delete()
    .eq("room_code", code)
    .eq("id", spectatorId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function fetchSpectators(roomCode: string) {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);

  const { data, error } = await supabase
    .from("spectators")
    .select("*")
    .eq("room_code", code)
    .order("joined_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Spectator[];
}


type RoomSubscriptionHandlers = {
  onHistoryChange?: () => void;
  onRoomChange?: (room: Room) => void;
  onSnapshotNeeded?: () => void;
  onDrawingEvent?: (event: DrawingEvent) => void;
  onPresenceChange?: (playerIds: string[]) => void;
  onRealtimeStatus?: (status: string) => void;
  onSettingsChange?: (settings: RoomSettings) => void;
  onSpectatorsChange?: () => void;
};

export function subscribeToRoom(
  roomCode: string,
  player: Player,
  handlers: RoomSubscriptionHandlers,
): RoomSubscription {
  const supabase = requireSupabase();
  const code = normalizeRoomCode(roomCode);
  const channel = supabase
    .channel(`room:${code}`, {
      config: {
        broadcast: {
          self: false,
        },
        presence: {
          key: player.id,
        },
      },
    })
    .on("presence", { event: "sync" }, () => {
      const presenceState = channel.presenceState<{ player_id?: string }>();
      const playerIds = Object.entries(presenceState)
        .flatMap(([key, presences]) =>
          presences.map((presence) => presence.player_id ?? key),
        )
        .filter(Boolean);

      handlers.onPresenceChange?.([...new Set(playerIds)]);
    })
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rooms", filter: `code=eq.${code}` },
      (payload) => {
        if (payload.new) {
          handlers.onRoomChange?.(payload.new as Room);
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `room_code=eq.${code}` },
      () => handlers.onSnapshotNeeded?.(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "guesses", filter: `room_code=eq.${code}` },
      () => handlers.onSnapshotNeeded?.(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "room_settings", filter: `room_code=eq.${code}` },
      (payload) => {
        if (payload.new) {
          handlers.onSettingsChange?.(payload.new as RoomSettings);
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "round_summaries", filter: `room_code=eq.${code}` },
      () => handlers.onHistoryChange?.(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "final_results", filter: `room_code=eq.${code}` },
      () => handlers.onHistoryChange?.(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "spectators", filter: `room_code=eq.${code}` },
      () => handlers.onSpectatorsChange?.(),
    )
    .on("broadcast", { event: "drawing" }, (payload) => {
      handlers.onDrawingEvent?.(payload.payload as DrawingEvent);
    });

  channel.subscribe((status) => {
    handlers.onRealtimeStatus?.(status);

    if (status === "SUBSCRIBED") {
      void channel.track({
        player_id: player.id,
        name: player.name,
        online_at: new Date().toISOString(),
      });
    }
  });

  return {
    channel,
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}

export async function broadcastDrawingEvent(
  channel: RealtimeChannel | null,
  event: DrawingEvent,
) {
  if (!channel) {
    return false;
  }

  const result = await channel.send({
    type: "broadcast",
    event: "drawing",
    payload: event,
  });

  return result === "ok";
}
