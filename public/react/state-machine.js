export const ControllerView = Object.freeze({
  CONNECTING: 'connecting',
  JOIN: 'join',
  LOBBY: 'lobby',
  PATH_SELECTION: 'path_selection',
  PLAYING: 'playing',
  ANSWERING: 'answering',
  REVEAL: 'reveal',
  ANIMATING: 'animating',
  ADVANCING_CHOICE: 'advancing_choice',
  ADVANCING_READY: 'advancing_ready',
  COUNTING_DOWN: 'counting_down',
  FINISHED: 'finished',
});

export const TvView = Object.freeze({
  CONNECTING: 'connecting',
  LOBBY: 'lobby',
  PATH_SELECTION: 'path_selection',
  PLAYING: 'playing',
  ANSWERING: 'answering',
  REVEAL: 'reveal',
  ANIMATING: 'animating',
  ADVANCING: 'advancing',
  COUNTING_DOWN: 'counting_down',
  FINISHED: 'finished',
});

export function selectControllerView({ state, playerId }) {
  if (!state) return ControllerView.CONNECTING;
  if (!playerId || !state.players.some((p) => p.id === playerId)) return ControllerView.JOIN;

  if (state.phase === 'advancing') {
    return state.pendingPathChoices?.[playerId]
      ? ControllerView.ADVANCING_CHOICE
      : ControllerView.ADVANCING_READY;
  }

  return ControllerView[state.phase.toUpperCase()] ?? ControllerView.LOBBY;
}

export function selectTvView(state) {
  if (!state) return TvView.CONNECTING;
  return TvView[state.phase.toUpperCase()] ?? TvView.LOBBY;
}

export function playerById(state, playerId) {
  return state?.players.find((player) => player.id === playerId) ?? null;
}

export function currentTile(state, playerId) {
  const player = playerById(state, playerId);
  return player ? state.board.tiles[player.tileId] : null;
}

export function effectiveCategory(player, tile) {
  const category = player?.categoryOverride ?? tile?.category ?? 'title';
  const colorByCategory = {
    title: 'red',
    artist: 'blue',
    year_exact: 'green',
    year_range: 'purple',
    decade: 'yellow',
  };
  return {
    category,
    color: player?.categoryOverride ? colorByCategory[category] : tile?.color ?? colorByCategory[category],
  };
}
