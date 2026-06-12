import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createGameStore } from './ws-store.js';
import { effectiveCategory, selectTvView, TvView } from './state-machine.js';
import { CATEGORY_LABELS, classNames, secondsLeft, useNow } from './ui.js';

const store = createGameStore({ reconnectPlayer: false });
const TILE_RADIUS = 42;

function useGame() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function useLocalIp(state) {
  const [ip, setIp] = useState(location.hostname);
  useEffect(() => {
    fetch('/ip').then((res) => res.text()).then(setIp).catch(() => {});
  }, []);
  return state ? `${location.protocol}//${ip}:3000` : '';
}

function Board({ state }) {
  const board = state.board;
  const tiles = Object.values(board.tiles);
  const pad = TILE_RADIUS + 55;
  const minX = Math.min(...tiles.map((tile) => tile.x)) - pad;
  const minY = Math.min(...tiles.map((tile) => tile.y)) - pad;
  const maxX = Math.max(...tiles.map((tile) => tile.x)) + pad;
  const maxY = Math.max(...tiles.map((tile) => tile.y)) + pad;

  return (
    <svg className="tv-board" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}>
      <g>
        {tiles.flatMap((tile) => tile.nextTiles.map((nextId) => {
          const next = board.tiles[nextId];
          return <line className="path-line" key={`${tile.id}-${next.id}`} x1={tile.x} y1={tile.y} x2={next.x} y2={next.y} />;
        }))}
      </g>
      <g>
        {tiles.map((tile) => (
          <g key={tile.id}>
            <rect
              className={classNames('board-tile', tile.id === board.startTileId && 'start', tile.id === board.endTileId && 'end')}
              fill={tileColor(tile, board)}
              height={(tile.id === board.startTileId || tile.id === board.endTileId) ? 92 : 78}
              rx="16"
              width={(tile.id === board.startTileId || tile.id === board.endTileId) ? 92 : 78}
              x={tile.x - ((tile.id === board.startTileId || tile.id === board.endTileId) ? 46 : 39)}
              y={tile.y - ((tile.id === board.startTileId || tile.id === board.endTileId) ? 46 : 39)}
            />
            <text className="tile-label" textAnchor="middle" x={tile.x} y={tile.y + 6}>{tile.label}</text>
          </g>
        ))}
      </g>
      <g>
        {tokenPositions(board, state.players).map(({ player, x, y }) => (
          <g className="player-token" key={player.id} transform={`translate(${x} ${y})`}>
            <circle fill={player.avatarImage ? '#111126' : player.avatarColor} r="18" />
            <text textAnchor="middle" y="6">{player.name.slice(0, 1).toUpperCase()}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function BottomBar({ state }) {
  return (
    <footer className="tv-bottom">
      {state.players.map((player) => {
        const tile = state.board.tiles[player.tileId];
        const info = effectiveCategory(player, tile);
        return (
          <div className="tv-player" key={player.id}>
            <span className="avatar" style={{ background: player.avatarColor }}>{player.name.slice(0, 1).toUpperCase()}</span>
            <strong>{player.name}</strong>
            <span className={classNames('mini-category', `cat-${info.color}`)}>{CATEGORY_LABELS[info.category]}</span>
          </div>
        );
      })}
    </footer>
  );
}

function Overlay({ view, state, joinUrl }) {
  const now = useNow(React, state?.phase === 'answering' || state?.phase === 'counting_down');
  if (view === TvView.LOBBY) {
    return (
      <section className="tv-overlay top">
        <span>Join at</span>
        <strong>{joinUrl}</strong>
      </section>
    );
  }
  if (view === TvView.PATH_SELECTION) {
    return <section className="tv-overlay top"><strong>Choose a starting path</strong></section>;
  }
  if (view === TvView.PLAYING) {
    return <section className="tv-overlay top"><strong>Ready for the next round</strong></section>;
  }
  if (view === TvView.ANSWERING) {
    const locked = state.answers.filter((answer) => answer.locked).length;
    return (
      <section className="tv-overlay center">
        <span>Listen</span>
        <strong className="huge">{secondsLeft(state.timerEnd, now)}</strong>
        <span>{locked}/{state.players.length} locked</span>
      </section>
    );
  }
  if (view === TvView.REVEAL || view === TvView.ADVANCING) {
    return <Reveal state={state} />;
  }
  if (view === TvView.COUNTING_DOWN) {
    return <section className="tv-overlay center"><strong className="huge">{secondsLeft(state.countdownEnd, now)}</strong></section>;
  }
  if (view === TvView.FINISHED) {
    const winners = state.players.filter((player) => player.tileId === state.board.endTileId);
    return (
      <section className="tv-overlay center">
        <span>Winner</span>
        <strong>{winners.map((player) => player.name).join(', ')}</strong>
      </section>
    );
  }
  return null;
}

function Reveal({ state }) {
  return (
    <section className="reveal-overlay">
      <div>
        <span>Reveal</span>
        <h2>{state.currentSong?.title ?? 'Song'}</h2>
        <p>{state.currentSong?.artist} · {state.currentSong?.year}</p>
      </div>
      <div className="tv-answers">
        {state.answers.map((answer) => (
          <div className="tv-answer" key={answer.playerId}>
            <strong>{answer.playerName}</strong>
            <span>{answer.answer || '-'}</span>
            {answer.correct !== undefined && <b>{answer.correct ? 'Correct' : 'Miss'}</b>}
          </div>
        ))}
      </div>
    </section>
  );
}

function AudioBridge({ state }) {
  useEffect(() => {
    const audio = document.getElementById('audio-player');
    if (!audio) return;
    audio.onended = () => store.send({ type: 'song_ended' });
    if (state?.phase === 'answering' && state.currentSong?.previewUrl) {
      audio.src = state.currentSong.previewUrl;
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [state?.phase, state?.currentSong?.id]);
  return null;
}

function App() {
  const game = useGame();
  const view = useMemo(() => selectTvView(game.state), [game.state]);
  const joinUrl = useLocalIp(game.state);

  if (!game.state) return <section className="tv-shell"><div className="tv-overlay center"><strong>Connecting...</strong></div></section>;

  return (
    <main className="tv-shell">
      <AudioBridge state={game.state} />
      <header className="tv-header">
        <h1>Hitstar</h1>
        <span>{game.state.phase.replaceAll('_', ' ')}</span>
      </header>
      <Board state={game.state} />
      <Overlay view={view} state={game.state} joinUrl={joinUrl} />
      <BottomBar state={game.state} />
    </main>
  );
}

function tileColor(tile, board) {
  if (tile.id === board.startTileId) return '#555577';
  if (tile.id === board.endTileId) return '#e91e63';
  return {
    red: '#e74c3c',
    blue: '#3498db',
    green: '#2ecc71',
    yellow: '#f1c40f',
    purple: '#9b59b6',
  }[tile.color] ?? '#888';
}

function tokenPositions(board, players) {
  const byTile = new Map();
  players.forEach((player) => byTile.set(player.tileId, [...(byTile.get(player.tileId) ?? []), player]));
  return [...byTile.entries()].flatMap(([tileId, group]) => {
    const tile = board.tiles[tileId];
    return group.map((player, index) => {
      const angle = (index / group.length) * Math.PI * 2 - Math.PI / 2;
      const dist = group.length === 1 ? 0 : 22;
      return { player, x: tile.x + Math.cos(angle) * dist, y: tile.y + Math.sin(angle) * dist };
    });
  });
}

createRoot(document.getElementById('root')).render(<App />);
