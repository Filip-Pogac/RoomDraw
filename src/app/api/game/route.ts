import { createClient } from "@supabase/supabase-js";
import type { Player, Room } from "@/types/game";

export const dynamic = "force-dynamic";

const MAX_PLAYERS_PER_ROOM = 10;
const ROUND_SECONDS = 90;
const SCORE_BY_RANK = [100, 70, 40];
const DEFAULT_SCORING_MODE = "speed";

type ScoringMode = "speed" | "flat" | "off";
type ServerRoomSettings = {
  max_players: number;
  round_seconds: number;
  scoring_mode: ScoringMode;
};

type GameAction =
  | {
      action: "startRound";
      actorPlayerId: string;
      drawerPlayerId: string;
      maxPlayers?: number;
      roomCode: string;
      roundSeconds?: number;
      word: string;
    }
  | {
      action: "submitGuess";
      playerId: string;
      roomCode: string;
      text: string;
    }
  | {
      action: "kickPlayer";
      actorPlayerId: string;
      roomCode: string;
      targetPlayerId: string;
    }
  | {
      action: "restartRoom" | "prepareNextRound" | "endRound";
      actorPlayerId?: string;
      roomCode: string;
    };

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase server env vars are missing.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
    },
  });
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function normalizeRoomCode(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase();
}

function normalizeGuess(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function scoreForRank(mode: ScoringMode, rank: number) {
  if (mode === "flat") {
    return 50;
  }

  if (mode === "off") {
    return 0;
  }

  return SCORE_BY_RANK[rank - 1] ?? 0;
}

async function fetchServerRoomSettings(
  supabase: ReturnType<typeof getServerSupabase>,
  roomCode: string,
  fallback: Partial<Pick<ServerRoomSettings, "max_players" | "round_seconds">> = {},
): Promise<ServerRoomSettings> {
  const defaults: ServerRoomSettings = {
    max_players: clampInt(fallback.max_players ?? MAX_PLAYERS_PER_ROOM, 2, MAX_PLAYERS_PER_ROOM),
    round_seconds: clampInt(fallback.round_seconds ?? ROUND_SECONDS, 30, 180),
    scoring_mode: DEFAULT_SCORING_MODE,
  };

  const { data, error } = await supabase
    .from("room_settings")
    .select("max_players,round_seconds,scoring_mode")
    .eq("room_code", roomCode)
    .maybeSingle();

  if (error || !data) {
    return defaults;
  }

  const settings = data as Partial<ServerRoomSettings>;

  return {
    max_players: clampInt(settings.max_players ?? defaults.max_players, 2, MAX_PLAYERS_PER_ROOM),
    round_seconds: clampInt(settings.round_seconds ?? defaults.round_seconds, 30, 180),
    scoring_mode:
      settings.scoring_mode === "flat" || settings.scoring_mode === "off"
        ? settings.scoring_mode
        : DEFAULT_SCORING_MODE,
  };
}

async function fetchActiveRoomPlayers(
  supabase: ReturnType<typeof getServerSupabase>,
  roomCode: string,
) {
  const { data, error } = await supabase
    .from("players")
    .select("id,disconnected_at")
    .eq("room_code", roomCode);

  if (!error && data) {
    return (data as Array<{ id: string; disconnected_at?: string | null }>).filter(
      (item) => !item.disconnected_at,
    );
  }

  const fallback = await supabase.from("players").select("id").eq("room_code", roomCode);

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return (fallback.data ?? []) as Array<{ id: string }>;
}

function guessDistance(text: string, expectedWord: string) {
  const guess = normalizeGuess(text);
  const expected = normalizeGuess(expectedWord);

  if (!guess || Math.abs(guess.length - expected.length) > 2) {
    return Number.POSITIVE_INFINITY;
  }

  const distances = Array.from({ length: guess.length + 1 }, (_, row) =>
    Array.from({ length: expected.length + 1 }, (_, column) =>
      row === 0 ? column : column === 0 ? row : 0,
    ),
  );

  for (let row = 1; row <= guess.length; row += 1) {
    for (let column = 1; column <= expected.length; column += 1) {
      const cost = guess[row - 1] === expected[column - 1] ? 0 : 1;
      distances[row][column] = Math.min(
        distances[row - 1][column] + 1,
        distances[row][column - 1] + 1,
        distances[row - 1][column - 1] + cost,
      );
    }
  }

  return distances[guess.length][expected.length];
}

function isTypoGuess(text: string, expectedWord: string) {
  const guess = normalizeGuess(text);
  const expected = normalizeGuess(expectedWord);

  return guess !== expected && guessDistance(text, expectedWord) <= 1;
}

function isCloseGuess(text: string, expectedWord: string) {
  const guess = normalizeGuess(text);
  const expected = normalizeGuess(expectedWord);

  return guess !== expected && guessDistance(text, expectedWord) <= 2;
}

async function getHostPlayer(supabase: ReturnType<typeof getServerSupabase>, roomCode: string) {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("room_code", roomCode)
    .order("joined_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Host not found.");
  }

  return data as Player;
}

async function requireHost(
  supabase: ReturnType<typeof getServerSupabase>,
  roomCode: string,
  actorPlayerId?: string,
) {
  const host = await getHostPlayer(supabase, roomCode);

  if (!actorPlayerId || host.id !== actorPlayerId) {
    throw new Error("Only host can do that.");
  }
}

async function startRound(supabase: ReturnType<typeof getServerSupabase>, input: GameAction) {
  if (input.action !== "startRound") {
    throw new Error("Invalid action.");
  }

  const code = normalizeRoomCode(input.roomCode);
  const settings = await fetchServerRoomSettings(supabase, code, {
    max_players: input.maxPlayers,
    round_seconds: input.roundSeconds,
  });
  const activePlayers = await fetchActiveRoomPlayers(supabase, code);

  if (activePlayers.length < 2) {
    throw new Error("At least two players are required.");
  }

  if (activePlayers.length > settings.max_players) {
    throw new Error("Room has too many players.");
  }

  if (input.actorPlayerId !== input.drawerPlayerId) {
    await requireHost(supabase, code, input.actorPlayerId);
  }

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .single();

  if (roomError || !room) {
    throw new Error(roomError?.message ?? "Room not found.");
  }

  const { error: guessesError } = await supabase.from("guesses").delete().eq("room_code", code);

  if (guessesError) {
    throw new Error(guessesError.message);
  }

  const { data, error } = await supabase
    .from("rooms")
    .update({
      status: "playing",
      current_word: input.word.trim().slice(0, 80),
      drawer_player_id: input.drawerPlayerId,
      round_number: ((room as Room).round_number ?? 0) + 1,
      round_ends_at: new Date(Date.now() + settings.round_seconds * 1_000).toISOString(),
    })
    .eq("code", code)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not start round.");
  }

  return { room: data as Room };
}

async function submitGuess(supabase: ReturnType<typeof getServerSupabase>, input: GameAction) {
  if (input.action !== "submitGuess") {
    throw new Error("Invalid action.");
  }

  const code = normalizeRoomCode(input.roomCode);
  const cleanText = input.text.trim().slice(0, 80);

  const { data: recentGuess } = await supabase
    .from("guesses")
    .select("created_at")
    .eq("room_code", code)
    .eq("player_id", input.playerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    recentGuess?.created_at &&
    Date.now() - Date.parse(recentGuess.created_at as string) < 900
  ) {
    throw new Error("Slow down.");
  }

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .single();

  if (roomError || !room) {
    throw new Error(roomError?.message ?? "Room not found.");
  }

  const typedRoom = room as Room;
  const settings = await fetchServerRoomSettings(supabase, code);

  if (typedRoom.status !== "playing" || !typedRoom.current_word) {
    throw new Error("Round is not active.");
  }

  if (typedRoom.drawer_player_id === input.playerId) {
    throw new Error("Drawer cannot guess.");
  }

  const matchesWord = normalizeGuess(cleanText) === normalizeGuess(typedRoom.current_word);
  const typoAccepted = !matchesWord && isTypoGuess(cleanText, typedRoom.current_word);
  const close = !matchesWord && !typoAccepted && isCloseGuess(cleanText, typedRoom.current_word);

  if (!matchesWord && !typoAccepted) {
    // Wrong guesses are stored too so the guess feed shows the round's chatter,
    // not just the handful of correct answers.
    const { error: wrongGuessError } = await supabase.from("guesses").insert({
      room_code: code,
      player_id: input.playerId,
      text: cleanText,
      is_correct: false,
    });

    if (wrongGuessError) {
      throw new Error(wrongGuessError.message);
    }

    return { isCorrect: false, points: 0, close, alreadyCorrect: false, typoAccepted: false };
  }

  const { data: existingCorrectGuess, error: existingCorrectError } = await supabase
    .from("guesses")
    .select("id")
    .eq("room_code", code)
    .eq("player_id", input.playerId)
    .eq("is_correct", true)
    .maybeSingle();

  if (existingCorrectError) {
    throw new Error(existingCorrectError.message);
  }

  if (existingCorrectGuess) {
    return { isCorrect: true, points: 0, close: false, alreadyCorrect: true, typoAccepted: false };
  }

  const [{ data: correctGuesses, error: correctGuessesError }, guessers] =
    await Promise.all([
      supabase
        .from("guesses")
        .select("player_id")
        .eq("room_code", code)
        .eq("is_correct", true),
      fetchActiveRoomPlayers(supabase, code),
    ]);

  if (correctGuessesError) {
    throw new Error(correctGuessesError.message);
  }

  const rank = new Set((correctGuesses ?? []).map((guess) => guess.player_id as string)).size + 1;
  const points = scoreForRank(settings.scoring_mode, rank);

  const { data: player, error: playerError } = await supabase
    .from("players")
    .select("score")
    .eq("id", input.playerId)
    .single();

  if (playerError) {
    throw new Error(playerError.message);
  }

  if (points > 0) {
    const { error: scoreError } = await supabase
      .from("players")
      .update({ score: ((player as Pick<Player, "score">).score ?? 0) + points })
      .eq("id", input.playerId);

    if (scoreError) {
      throw new Error(scoreError.message);
    }
  }

  const { error: insertError } = await supabase.from("guesses").insert({
    room_code: code,
    player_id: input.playerId,
    text: matchesWord ? cleanText : typedRoom.current_word,
    is_correct: true,
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  const correctCount = rank;
  const requiredCorrectCount = Math.min(
    SCORE_BY_RANK.length,
    guessers.filter((item) => item.id !== typedRoom.drawer_player_id).length,
  );

  if (requiredCorrectCount > 0 && correctCount >= requiredCorrectCount) {
    await endRound(supabase, code);
  }

  return { isCorrect: true, points, close: false, alreadyCorrect: false, typoAccepted };
}

async function endRound(supabase: ReturnType<typeof getServerSupabase>, roomCode: string) {
  const { data, error } = await supabase
    .from("rooms")
    .update({ status: "round_end", round_ends_at: new Date().toISOString() })
    .eq("code", roomCode)
    .eq("status", "playing")
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as Room | null;
}

async function prepareNextRound(supabase: ReturnType<typeof getServerSupabase>, input: GameAction) {
  if (input.action !== "prepareNextRound") {
    throw new Error("Invalid action.");
  }

  const code = normalizeRoomCode(input.roomCode);
  await requireHost(supabase, code, input.actorPlayerId);
  await supabase.from("guesses").delete().eq("room_code", code);

  const { data, error } = await supabase
    .from("rooms")
    .update({
      status: "lobby",
      current_word: null,
      round_ends_at: null,
    })
    .eq("code", code)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not prepare next round.");
  }

  return { room: data as Room };
}

async function restartRoom(supabase: ReturnType<typeof getServerSupabase>, input: GameAction) {
  if (input.action !== "restartRoom") {
    throw new Error("Invalid action.");
  }

  const code = normalizeRoomCode(input.roomCode);
  await requireHost(supabase, code, input.actorPlayerId);
  await supabase.from("guesses").delete().eq("room_code", code);
  await supabase.from("players").update({ score: 0 }).eq("room_code", code);

  const { data, error } = await supabase
    .from("rooms")
    .update({
      status: "lobby",
      current_word: null,
      drawer_player_id: null,
      round_number: 0,
      round_ends_at: null,
    })
    .eq("code", code)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not restart room.");
  }

  return { room: data as Room };
}

async function kickPlayer(supabase: ReturnType<typeof getServerSupabase>, input: GameAction) {
  if (input.action !== "kickPlayer") {
    throw new Error("Invalid action.");
  }

  const code = normalizeRoomCode(input.roomCode);
  await requireHost(supabase, code, input.actorPlayerId);

  const { error } = await supabase
    .from("players")
    .delete()
    .eq("room_code", code)
    .eq("id", input.targetPlayerId);

  if (error) {
    throw new Error(error.message);
  }

  return { ok: true };
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as GameAction;
    const supabase = getServerSupabase();

    if (input.action === "startRound") {
      return Response.json(await startRound(supabase, input));
    }

    if (input.action === "submitGuess") {
      return Response.json(await submitGuess(supabase, input));
    }

    if (input.action === "kickPlayer") {
      return Response.json(await kickPlayer(supabase, input));
    }

    if (input.action === "restartRoom") {
      return Response.json(await restartRoom(supabase, input));
    }

    if (input.action === "prepareNextRound") {
      return Response.json(await prepareNextRound(supabase, input));
    }

    if (input.action === "endRound") {
      const code = normalizeRoomCode(input.roomCode);
      return Response.json({ room: await endRound(supabase, code) });
    }

    return jsonError("Unknown action.", 400);
  } catch (caught) {
    return jsonError(caught instanceof Error ? caught.message : "Game action failed.");
  }
}
