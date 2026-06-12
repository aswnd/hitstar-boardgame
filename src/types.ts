export type Category = 'title' | 'artist' | 'year_exact' | 'year_range' | 'decade';
export type TileColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple';
export type ItemType = 'change_category' | 'change_tile';
export type GamePhase =
  | 'lobby'
  | 'path_selection'
  | 'playing'
  | 'answering'
  | 'reveal'
  | 'animating'
  | 'advancing'
  | 'counting_down'
  | 'finished';

export interface Item {
  id: string;
  type: ItemType;
}

export interface Tile {
  id: string;
  label: string;
  color: TileColor;
  category: Category;
  nextTiles: string[];
  x: number;
  y: number;
}

export interface BoardData {
  tiles: Record<string, Tile>;
  startTileId: string;
  endTileId: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  year: number;
  previewUrl?: string;
}

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  tileId: string;
  avatarColor: string;
  avatarImage?: string;
  connected: boolean;
  inventory: Item[];
  categoryOverride?: Category;
}

export interface PlayerAnswer {
  playerId: string;
  playerName: string;
  answer: string;
  locked: boolean;
  correct?: boolean;
}

export interface PublicGameState {
  phase: GamePhase;
  players: Player[];
  board: BoardData;
  currentSong: Partial<Song> | null;
  answers: PlayerAnswer[];
  timerEnd: number | null;
  pendingPathChoices: Record<string, string[]>;
  hasSongsLeft: boolean;
  readyPlayerIds: string[];
  countdownEnd: number | null;
  tileCursors: Record<string, string>; // playerId → tileId
  takenEmojis: string[];
  minYear: number;
}

export type ServerMessage =
  | { type: 'joined'; playerId: string; isHost: boolean }
  | { type: 'state'; state: PublicGameState }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'join'; name: string; avatarImage?: string; avatarEmoji?: string }
  | { type: 'reconnect'; playerId: string }
  | { type: 'start_game' }
  | { type: 'choose_path'; tileId: string }
  | { type: 'start_round' }
  | { type: 'lock_answer'; answer: string }
  | { type: 'mark_correct'; playerIds: string[] }
  | { type: 'ready' }
  | { type: 'use_item_change_category'; itemId: string; newCategory: Category }
  | { type: 'use_item_change_tile'; itemId: string; tileId: string; newCategory: Category }
  | { type: 'tile_cursor'; tileId: string | null }
  | { type: 'set_min_year'; year: number }
  | { type: 'song_ended' }
  | { type: 'reset_game' };
