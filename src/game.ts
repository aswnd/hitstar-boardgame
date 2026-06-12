import type { ServerWebSocket } from 'bun';
import type {
  Player, PlayerAnswer, Song, ClientMessage,
  PublicGameState, GamePhase, TileColor, Category, Item, ItemType,
} from './types';
import { defaultBoard } from './board';
import rawSongs from '../songs.json';

const SONGS: Song[] = (rawSongs as Omit<Song, 'id'>[]).map((s, i) => ({ ...s, id: String(i) }));
const AVATAR_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#e91e63',
];
const TIMER_SECONDS  = 30;
const GRACE_MS       = 5000;
const COUNTDOWN_MS   = 3000;
const ANIMATION_MS   = 1400;

const CAT_COLOR: Record<Category, TileColor> = {
  title: 'red', artist: 'blue', year_exact: 'green', year_range: 'purple', decade: 'yellow',
};

interface TileOverride { color: TileColor; category: Category; }

interface GameState {
  phase: GamePhase;
  players: Record<string, Player>;
  currentSong: Song | null;
  answers: Record<string, PlayerAnswer>;
  timerEnd: number | null;
  pendingPathChoices: Record<string, string[]>;
  usedSongIds: string[];
  readyPlayers: Set<string>;
  countdownEnd: number | null;
  tileOverrides: Record<string, TileOverride>;
  tileCursors: Record<string, string>; // playerId → tileId
  takenEmojis: string[];
  animationFired: boolean; // prevents double-animation on disconnect during advancing
  minYear: number;
  stuckRounds: Record<string, number>; // playerId → consecutive rounds without moving
}

type WS = ServerWebSocket<{ id: string }>;

export class Game {
  private connections = new Map<string, WS>();
  private wsToPlayer = new Map<string, string>();
  private playerToWs = new Map<string, string>();
  private timerTimeout: ReturnType<typeof setTimeout> | null = null;

  private state: GameState = {
    phase: 'lobby',
    players: {},
    currentSong: null,
    answers: {},
    timerEnd: null,
    pendingPathChoices: {},
    usedSongIds: [],
    readyPlayers: new Set(),
    countdownEnd: null,
    tileOverrides: {},
    tileCursors: {},
    takenEmojis: [],
    animationFired: false,
    minYear: 1900,
    stuckRounds: {},
  };

  addConnection(ws: WS) {
    this.connections.set(ws.data.id, ws);
    ws.send(JSON.stringify({ type: 'state', state: this.makePublicState() }));
  }

  removeConnection(ws: WS) {
    const wsId = ws.data.id;
    this.connections.delete(wsId);

    const playerId = this.wsToPlayer.get(wsId);
    if (playerId) {
      this.wsToPlayer.delete(wsId);
      this.playerToWs.delete(playerId);
      if (this.state.players[playerId]) {
        this.state.players[playerId].connected = false;
        if (this.state.phase === 'advancing') {
          // Unblock animation if this player had a pending choice
          delete this.state.pendingPathChoices[playerId];
          this.checkAndStartAnimation();
          this.checkAndStartCountdown();
        } else {
          this.broadcast();
        }
      }
    }
  }

  handleMessage(ws: WS, msg: ClientMessage) {
    switch (msg.type) {
      case 'join':                      return this.handleJoin(ws, msg.name, msg.avatarImage, msg.avatarEmoji);
      case 'reconnect':                 return this.handleReconnect(ws, msg.playerId);
      case 'start_game':                return this.handleStartGame(ws);
      case 'choose_path':               return this.handleChoosePath(ws, msg.tileId);
      case 'start_round':               return this.handleStartRound(ws);
      case 'lock_answer':               return this.handleLockAnswer(ws, msg.answer);
      case 'mark_correct':              return this.handleMarkCorrect(ws, msg.playerIds);
      case 'ready':                     return this.handleReady(ws);
      case 'use_item_change_category':  return this.handleUseItemChangeCategory(ws, msg.itemId, msg.newCategory);
      case 'use_item_change_tile':      return this.handleUseItemChangeTile(ws, msg.itemId, msg.tileId, msg.newCategory);
      case 'tile_cursor':               return this.handleTileCursor(ws, msg.tileId);
      case 'set_min_year':              return this.handleSetMinYear(ws, msg.year);
      case 'song_ended':                return this.handleSongEnded();
    }
  }

  private handleJoin(ws: WS, name: string, avatarImage?: string, avatarEmoji?: string) {
    if (this.state.phase !== 'lobby') {
      ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress' }));
      return;
    }

    const trimmed = name.trim();
    if (!trimmed) return;

    const existing = Object.values(this.state.players).find(p => p.name === trimmed);
    if (existing) {
      this.linkWsToPlayer(ws, existing.id);
      ws.send(JSON.stringify({ type: 'joined', playerId: existing.id, isHost: existing.isHost }));
      this.broadcast();
      return;
    }

    // Emoji uniqueness check (photos are not restricted)
    if (avatarEmoji && this.state.takenEmojis.includes(avatarEmoji)) {
      ws.send(JSON.stringify({ type: 'error', message: 'emoji_taken' }));
      return;
    }

    const playerId = crypto.randomUUID();
    const isHost = Object.keys(this.state.players).length === 0;
    const colorIndex = Object.keys(this.state.players).length % AVATAR_COLORS.length;

    this.state.players[playerId] = {
      id: playerId,
      name: trimmed,
      isHost,
      tileId: defaultBoard.startTileId,
      avatarColor: AVATAR_COLORS[colorIndex],
      avatarImage,
      connected: true,
      inventory: [],
    };

    if (avatarEmoji) this.state.takenEmojis.push(avatarEmoji);

    this.linkWsToPlayer(ws, playerId);
    ws.send(JSON.stringify({ type: 'joined', playerId, isHost }));
    this.broadcast();
  }

  private handleReconnect(ws: WS, playerId: string) {
    const player = this.state.players[playerId];
    if (!player) {
      ws.send(JSON.stringify({ type: 'error', message: 'Player not found' }));
      return;
    }
    this.linkWsToPlayer(ws, playerId);
    player.connected = true;
    ws.send(JSON.stringify({ type: 'joined', playerId, isHost: player.isHost }));
    this.broadcast();
  }

  private handleStartGame(ws: WS) {
    const player = this.getPlayer(ws);
    if (!player?.isHost || this.state.phase !== 'lobby') return;
    if (Object.keys(this.state.players).length < 1) return;

    this.state.phase = 'path_selection';
    this.broadcast();
  }

  private handleChoosePath(ws: WS, tileId: string) {
    const player = this.getPlayer(ws);
    if (!player) return;

    if (this.state.phase === 'path_selection') {
      const startTile = defaultBoard.tiles[defaultBoard.startTileId];
      if (!startTile.nextTiles.includes(tileId)) return;

      player.tileId = tileId;

      const allChosen = Object.values(this.state.players)
        .every(p => p.tileId !== defaultBoard.startTileId);
      if (allChosen) this.state.phase = 'playing';

      this.broadcast();
      return;
    }

    if (this.state.phase === 'advancing') {
      const choices = this.state.pendingPathChoices[player.id];
      if (!choices?.includes(tileId)) return;

      player.tileId = tileId;
      delete this.state.pendingPathChoices[player.id];

      // Fire animation as soon as all choices are resolved (before ready).
      this.checkAndStartAnimation();
    }
  }

  private handleStartRound(ws: WS) {
    const player = this.getPlayer(ws);
    if (!player?.isHost || this.state.phase !== 'playing') return;
    this.startRound();
  }

  private handleLockAnswer(ws: WS, answer: string) {
    const player = this.getPlayer(ws);
    if (!player || this.state.phase !== 'answering') return;

    const pa = this.state.answers[player.id];
    if (!pa || pa.locked) return;

    pa.answer = answer.trim();
    pa.locked = true;

    const allLocked = Object.values(this.state.answers).every(a => a.locked);
    if (allLocked) {
      if (this.timerTimeout) { clearTimeout(this.timerTimeout); this.timerTimeout = null; }
      this.endAnswering();
      return;
    }

    this.broadcast();
  }

  private endAnswering() {
    this.state.phase = 'reveal';
    this.state.timerEnd = null;
    this.broadcast();
  }

  private handleMarkCorrect(ws: WS, playerIds: string[]) {
    const player = this.getPlayer(ws);
    if (!player?.isHost || this.state.phase !== 'reveal') return;

    // Consume category overrides from this round
    for (const p of Object.values(this.state.players)) {
      delete p.categoryOverride;
    }

    for (const pa of Object.values(this.state.answers)) {
      pa.correct = playerIds.includes(pa.playerId);
    }

    this.state.pendingPathChoices = {};
    this.state.readyPlayers = new Set();
    this.state.animationFired = false;

    for (const pid of playerIds) {
      const p = this.state.players[pid];
      if (!p) continue;
      const tile = defaultBoard.tiles[p.tileId];
      if (!tile) continue;

      // Moving — reset stuck counter
      this.state.stuckRounds[pid] = 0;

      if (tile.nextTiles.length === 0) continue;
      // Queue ALL correct players for path resolution — movement happens after
      // decisions are made, so the animation shows everyone moving at once.
      this.state.pendingPathChoices[pid] = tile.nextTiles;
    }

    // Players who didn't move: increment stuck counter and award item at 5
    for (const p of Object.values(this.state.players)) {
      if (playerIds.includes(p.id)) continue;
      this.state.stuckRounds[p.id] = (this.state.stuckRounds[p.id] ?? 0) + 1;
      if (this.state.stuckRounds[p.id] >= 5) {
        this.state.stuckRounds[p.id] = 0;
        if (p.inventory.length === 0) {
          p.inventory.push({ id: crypto.randomUUID(), type: 'change_category' });
        }
      }
    }

    // Grant items based on board position before advancing.
    this.grantPositionItems();

    // Go straight to advancing — animation fires after all choices are resolved.
    this.state.phase = 'advancing';
    this.broadcast();
  }

  private distanceToEnd(tileId: string): number {
    if (tileId === defaultBoard.endTileId) return 0;
    const visited = new Set<string>();
    const queue: Array<[string, number]> = [[tileId, 0]];
    while (queue.length > 0) {
      const [cur, dist] = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const next of defaultBoard.tiles[cur]?.nextTiles ?? []) {
        if (next === defaultBoard.endTileId) return dist + 1;
        queue.push([next, dist + 1]);
      }
    }
    return Infinity;
  }

  private grantPositionItems() {
    const players = Object.values(this.state.players);
    if (players.length === 0) return;

    const ranked = players
      .map(p => ({ p, dist: this.distanceToEnd(p.tileId) }))
      .sort((a, b) => a.dist - b.dist); // ascending = closer to end = better rank

    const n = ranked.length;
    const MIN_CHANCE = 0.05;
    const MAX_CHANCE = 0.60;

    ranked.forEach(({ p }, rank) => {
      const chance = n === 1
        ? (MIN_CHANCE + MAX_CHANCE) / 2
        : MIN_CHANCE + (MAX_CHANCE - MIN_CHANCE) * (rank / (n - 1));

      if (p.inventory.length === 0 && Math.random() < chance) {
        const type: ItemType = Math.random() < 0.85 ? 'change_category' : 'change_tile';
        p.inventory.push({ id: crypto.randomUUID(), type });
      }
    });
  }

  private handleReady(ws: WS) {
    const player = this.getPlayer(ws);
    if (!player || this.state.phase !== 'advancing') return;
    if (this.state.pendingPathChoices[player.id]) return;

    this.state.readyPlayers.add(player.id);
    this.checkAndStartCountdown();
  }

  private handleUseItemChangeCategory(ws: WS, itemId: string, newCategory: Category) {
    const player = this.getPlayer(ws);
    if (!player || this.state.phase !== 'advancing') return;

    const idx = player.inventory.findIndex(i => i.id === itemId);
    if (idx === -1) return;

    player.inventory.splice(idx, 1);
    player.categoryOverride = newCategory;
    this.broadcast();
  }

  private handleUseItemChangeTile(ws: WS, itemId: string, tileId: string, newCategory: Category) {
    const player = this.getPlayer(ws);
    if (!player || this.state.phase !== 'advancing') return;

    // Can't change start or end tile
    if (tileId === defaultBoard.startTileId || tileId === defaultBoard.endTileId) return;
    if (!defaultBoard.tiles[tileId]) return;

    const idx = player.inventory.findIndex(i => i.id === itemId);
    if (idx === -1) return;

    player.inventory.splice(idx, 1);
    this.state.tileOverrides[tileId] = { category: newCategory, color: CAT_COLOR[newCategory] };
    this.broadcast();
  }

  private handleTileCursor(ws: WS, tileId: string | null) {
    const player = this.getPlayer(ws);
    if (!player || this.state.phase !== 'advancing') return;

    if (tileId === null) {
      delete this.state.tileCursors[player.id];
    } else {
      if (!defaultBoard.tiles[tileId]) return;
      this.state.tileCursors[player.id] = tileId;
    }
    this.broadcast();
  }

  private handleSetMinYear(ws: WS, year: number) {
    const player = this.getPlayer(ws);
    if (!player?.isHost || this.state.phase !== 'lobby') return;
    this.state.minYear = Math.max(1900, Math.min(2023, Math.round(year)));
    this.broadcast();
  }

  private handleSongEnded() {
    if (this.state.phase !== 'answering') return;
    // Only start grace early if there's more than GRACE_MS left on the timer
    // (otherwise the timer is already about to fire and will handle it)
    if (this.state.timerEnd && this.state.timerEnd - Date.now() > GRACE_MS) {
      if (this.timerTimeout) clearTimeout(this.timerTimeout);
      this.state.timerEnd = Date.now() + GRACE_MS;
      this.timerTimeout = setTimeout(() => this.startGraceOrEnd(), GRACE_MS);
      this.broadcast();
    }
  }

  private startGraceOrEnd() {
    if (this.state.phase !== 'answering') return;
    const allLocked = Object.values(this.state.answers).every(a => a.locked);
    if (allLocked) {
      this.endAnswering();
      return;
    }
    this.state.timerEnd = Date.now() + GRACE_MS;
    this.timerTimeout = setTimeout(() => this.endAnswering(), GRACE_MS);
    this.broadcast();
  }

  // Fires as soon as all path choices are resolved → plays the movement animation,
  // then returns to advancing so players can press ready.
  private checkAndStartAnimation() {
    if (this.state.phase !== 'advancing') { this.broadcast(); return; }
    if (this.state.animationFired) { this.broadcast(); return; }
    if (Object.keys(this.state.pendingPathChoices).length > 0) { this.broadcast(); return; }

    this.state.animationFired = true;
    this.state.phase = 'animating';
    this.state.tileCursors = {};
    this.broadcast();

    if (this.timerTimeout) clearTimeout(this.timerTimeout);
    this.timerTimeout = setTimeout(() => {
      if (this.checkWinner()) {
        this.state.phase = 'finished';
        this.broadcast();
      } else {
        // Return to advancing for the ready phase
        this.state.readyPlayers = new Set();
        this.state.phase = 'advancing';
        this.broadcast();
      }
    }, ANIMATION_MS);
  }

  private checkAndStartCountdown() {
    if (this.state.phase !== 'advancing') { this.broadcast(); return; }
    if (Object.keys(this.state.pendingPathChoices).length > 0) { this.broadcast(); return; }

    const connected = Object.values(this.state.players).filter(p => p.connected);
    if (connected.length === 0) { this.broadcast(); return; }

    const allReady = connected.every(p => this.state.readyPlayers.has(p.id));
    if (!allReady) { this.broadcast(); return; }

    // Discard any unused items — they must be used in the same advancing phase.
    for (const p of Object.values(this.state.players)) {
      p.inventory = [];
    }

    this.state.phase = 'counting_down';
    this.state.countdownEnd = Date.now() + COUNTDOWN_MS;
    this.broadcast();

    if (this.timerTimeout) clearTimeout(this.timerTimeout);
    this.timerTimeout = setTimeout(() => this.startRound(), COUNTDOWN_MS);
  }

  private startRound() {
    this.state.readyPlayers = new Set();
    this.state.countdownEnd = null;

    const available = SONGS.filter(s => !this.state.usedSongIds.includes(s.id) && s.year >= this.state.minYear);
    if (!available.length) {
      this.state.phase = 'playing';
      this.broadcast();
      return;
    }

    const song = available[Math.floor(Math.random() * available.length)];
    this.state.currentSong = song;
    this.state.usedSongIds.push(song.id);
    this.state.answers = {};
    this.state.phase = 'answering';

    for (const p of Object.values(this.state.players)) {
      this.state.answers[p.id] = {
        playerId: p.id,
        playerName: p.name,
        answer: '',
        locked: false,
      };
    }

    const timerEnd = Date.now() + TIMER_SECONDS * 1000;
    this.state.timerEnd = timerEnd;

    if (this.timerTimeout) clearTimeout(this.timerTimeout);
    this.timerTimeout = setTimeout(() => this.startGraceOrEnd(), TIMER_SECONDS * 1000);

    this.broadcast();
  }

  private checkWinner() {
    return Object.values(this.state.players).some(
      p => p.tileId === defaultBoard.endTileId
    );
  }

  private getPlayer(ws: WS): Player | null {
    const pid = this.wsToPlayer.get(ws.data.id);
    return pid ? (this.state.players[pid] ?? null) : null;
  }

  private linkWsToPlayer(ws: WS, playerId: string) {
    const oldWsId = this.playerToWs.get(playerId);
    if (oldWsId) this.wsToPlayer.delete(oldWsId);

    this.wsToPlayer.set(ws.data.id, playerId);
    this.playerToWs.set(playerId, ws.data.id);
  }

  private makePublicState(): PublicGameState {
    const { phase, currentSong, answers, timerEnd, pendingPathChoices,
            usedSongIds, readyPlayers, countdownEnd, tileOverrides, takenEmojis } = this.state;

    // Apply tile overrides to the board before broadcasting.
    // Color is always derived from category so board.json color fields are ignored.
    const tiles = Object.fromEntries(
      Object.entries(defaultBoard.tiles).map(([id, tile]) => {
        const ov = tileOverrides[id];
        const base = { ...tile, color: CAT_COLOR[tile.category] ?? tile.color };
        return [id, ov ? { ...base, ...ov } : base];
      })
    );
    const board = { ...defaultBoard, tiles };

    let song: Partial<Song> | null = null;
    if (currentSong) {
      if (phase === 'reveal' || phase === 'advancing' || phase === 'counting_down' || phase === 'finished') {
        song = currentSong;
      } else if (phase === 'answering') {
        song = { id: currentSong.id, previewUrl: currentSong.previewUrl };
      }
    }

    const showAnswers = phase === 'reveal' || phase === 'advancing' || phase === 'finished';

    return {
      phase,
      players: Object.values(this.state.players),
      board,
      currentSong: song,
      answers: showAnswers ? Object.values(answers) : [],
      timerEnd,
      pendingPathChoices,
      hasSongsLeft: SONGS.some(s => !usedSongIds.includes(s.id) && s.year >= this.state.minYear),
      readyPlayerIds: [...readyPlayers],
      countdownEnd,
      tileCursors: { ...this.state.tileCursors },
      takenEmojis: [...takenEmojis],
      minYear: this.state.minYear,
    };
  }

  broadcast() {
    const msg = JSON.stringify({ type: 'state', state: this.makePublicState() });
    for (const ws of this.connections.values()) {
      ws.send(msg);
    }
  }
}
