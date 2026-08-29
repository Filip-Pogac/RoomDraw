import type { RealtimeChannel } from "@supabase/supabase-js";

export type RoomStatus = "lobby" | "playing" | "round_end";

export type Room = {
  code: string;
  status: RoomStatus;
  current_word: string | null;
  drawer_player_id: string | null;
  round_number: number;
  round_ends_at: string | null;
  created_at: string;
};

export type Player = {
  id: string;
  room_code: string;
  name: string;
  score: number;
  session_key?: string | null;
  last_seen_at?: string | null;
  disconnected_at?: string | null;
  joined_at: string;
};

export type Guess = {
  id: number;
  room_code: string;
  player_id: string;
  text: string;
  is_correct: boolean;
  created_at: string;
};

export type RoomSnapshot = {
  room: Room;
  players: Player[];
  guesses: Guess[];
};

export type DrawingPoint = {
  x: number;
  y: number;
};

export type DrawingEvent =
  | {
      id: string;
      type: "stroke-start" | "stroke-move" | "stroke-end";
      senderId: string;
      point: DrawingPoint;
      color: string;
      size: number;
      at: number;
    }
  | {
      id: string;
      type: "fill";
      senderId: string;
      point: DrawingPoint;
      color: string;
      size: number;
      at: number;
    }
  | {
      id: string;
      type: "undo";
      senderId: string;
      at: number;
    }
  | {
      id: string;
      type: "clear";
      senderId: string;
      background?: string;
      at: number;
    };

export type RoomSettings = {
  room_code: string;
  round_seconds: number;
  round_limit: number;
  language: string;
  word_pack: string;
  max_players: number;
  scoring_mode: "speed" | "flat" | "off";
  custom_words: string[];
  created_at: string;
  updated_at: string;
};

export type RoundEndReason = "guessed" | "timer" | "restart" | "drawer_left" | "manual";

export type RoundResultEntry = {
  player_id: string;
  player_name: string;
  rank: number;
  points: number;
  guessed_at: string;
};

export type PlayerStanding = {
  player_id: string;
  player_name: string;
  score: number;
  rank: number;
};

export type SavedRoundSummary = {
  id: string;
  room_code: string;
  round_number: number;
  word: string;
  drawer_player_id: string | null;
  started_at: string | null;
  ended_at: string;
  ended_reason: RoundEndReason;
  drawing_events: DrawingEvent[];
  drawing_image: string | null;
  results: RoundResultEntry[];
  standings: PlayerStanding[];
  created_at: string;
};

export type FinalRoomResult = {
  id: string;
  room_code: string;
  completed_at: string;
  winner_player_id: string | null;
  rounds_played: number;
  standings: PlayerStanding[];
  top_drawings: SavedRoundSummary[];
  share_payload: Record<string, unknown>;
  created_at: string;
};

export type Spectator = {
  id: string;
  room_code: string;
  name: string;
  session_key: string | null;
  joined_at: string;
  last_seen_at: string;
};

export type RoomSubscription = {
  channel: RealtimeChannel;
  unsubscribe: () => void;
};
