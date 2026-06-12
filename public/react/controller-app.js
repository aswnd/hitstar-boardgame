import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createGameStore } from './ws-store.js';
import {
  ControllerView,
  currentTile,
  effectiveCategory,
  playerById,
  selectControllerView,
} from './state-machine.js';
import { CATEGORY_LABELS, CATEGORY_PROMPTS, classNames, secondsLeft, useNow } from './ui.js';

const store = createGameStore();
const EMOJIS = ['⭐', '🎤', '🎧', '🎸', '🎹', '🥁', '🎺', '🎷', '💿', '🎵'];

function useGame() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function Avatar({ player, selectedEmoji }) {
  if (player?.avatarImage) return <span className="avatar photo" style={{ backgroundImage: `url(${player.avatarImage})` }} />;
  return (
    <span className="avatar" style={{ background: player?.avatarColor }}>
      {selectedEmoji ?? player?.name?.slice(0, 1).toUpperCase() ?? '?'}
    </span>
  );
}

function JoinView({ state }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const taken = state?.takenEmojis ?? [];

  const submit = (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    store.join({ name: name.trim(), avatarEmoji: emoji });
  };

  return (
    <main className="join-screen">
      <h1>Hitstar</h1>
      <Avatar selectedEmoji={emoji} />
      <div className="emoji-grid">
        {EMOJIS.map((item) => (
          <button
            className={classNames('emoji-button', item === emoji && 'selected')}
            disabled={taken.includes(item)}
            key={item}
            onClick={() => setEmoji(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
      <form className="join-form" onSubmit={submit}>
        <input
          autoFocus
          placeholder="Your name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button className="primary-button" type="submit">Join</button>
      </form>
    </main>
  );
}

function Header({ state, playerId }) {
  const player = playerById(state, playerId);
  return (
    <header className="controller-header">
      <Avatar player={player} />
      <strong>{player?.name}</strong>
      {player?.isHost && <span className="host-badge">Host</span>}
    </header>
  );
}

function CategoryCard({ state, playerId, title = 'Your category' }) {
  const player = playerById(state, playerId);
  const tile = currentTile(state, playerId);
  const info = effectiveCategory(player, tile);
  return (
    <section className={classNames('category-card', `cat-${info.color}`)}>
      <span>{title}</span>
      <strong>{CATEGORY_LABELS[info.category]}</strong>
      <p>{CATEGORY_PROMPTS[info.category]}</p>
    </section>
  );
}

function PathButtons({ state, fromTile, choices }) {
  return (
    <div className="choice-grid">
      {choices.map((tileId) => {
        const tile = state.board.tiles[tileId];
        return (
          <button
            className={classNames('choice-button', `cat-${tile.color}`)}
            key={tileId}
            onClick={() => store.send({ type: 'choose_path', tileId })}
            type="button"
          >
            <span>{directionLabel(fromTile, tile)}</span>
            <strong>{tile.label}</strong>
          </button>
        );
      })}
    </div>
  );
}

function LobbyView({ state, playerId }) {
  const player = playerById(state, playerId);
  const [minYear, setMinYear] = useState(state.minYear ?? 1900);
  return (
    <section className="phase-panel">
      <span className="phase-kicker">Lobby</span>
      <h2>{state.players.length} player{state.players.length === 1 ? '' : 's'} joined</h2>
      <div className="player-list">
        {state.players.map((item) => <PlayerPill key={item.id} player={item} />)}
      </div>
      {player?.isHost ? (
        <>
          <label className="range-row">
            <span>Minimum year</span>
            <strong>{minYear}</strong>
            <input
              min="1900"
              max="2023"
              type="range"
              value={minYear}
              onChange={(event) => setMinYear(Number(event.target.value))}
              onPointerUp={() => store.send({ type: 'set_min_year', year: minYear })}
            />
          </label>
          <button className="primary-button" onClick={() => store.send({ type: 'start_game' })} type="button">
            Start game
          </button>
        </>
      ) : (
        <p className="muted">Waiting for the host to start.</p>
      )}
    </section>
  );
}

function PlayingView({ state, playerId }) {
  const player = playerById(state, playerId);
  return (
    <section className="phase-panel">
      <CategoryCard state={state} playerId={playerId} title="Next round" />
      {player?.isHost ? (
        <button className="primary-button" onClick={() => store.send({ type: 'start_round' })} type="button">
          Start round
        </button>
      ) : (
        <p className="muted">Waiting for the host to start the round.</p>
      )}
    </section>
  );
}

function AnsweringView({ state, playerId }) {
  const now = useNow(React, Boolean(state.timerEnd));
  const [answer, setAnswer] = useState('');
  const myAnswer = state.answers.find((item) => item.playerId === playerId);
  const locked = myAnswer?.locked;
  return (
    <section className="phase-panel">
      <CategoryCard state={state} playerId={playerId} title="Answer now" />
      <div className="timer">{secondsLeft(state.timerEnd, now)}</div>
      {locked ? (
        <div className="locked-answer">{myAnswer.answer || 'Locked'}</div>
      ) : (
        <form
          className="answer-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = answer.trim();
            if (trimmed) store.send({ type: 'lock_answer', answer: trimmed });
          }}
        >
          <input autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} />
          <button className="primary-button" type="submit">Lock answer</button>
        </form>
      )}
    </section>
  );
}

function RevealView({ state, playerId }) {
  const player = playerById(state, playerId);
  const [correctIds, setCorrectIds] = useState([]);
  const toggle = (id) => setCorrectIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  return (
    <section className="phase-panel">
      <span className="phase-kicker">Reveal</span>
      <h2>{state.currentSong?.title ?? 'Song'} </h2>
      <p className="song-meta">{state.currentSong?.artist} · {state.currentSong?.year}</p>
      {player?.isHost ? (
        <>
          <div className="answer-list">
            {state.answers.map((answer) => (
              <label className="answer-row" key={answer.playerId}>
                <input checked={correctIds.includes(answer.playerId)} type="checkbox" onChange={() => toggle(answer.playerId)} />
                <span>{answer.playerName}</span>
                <strong>{answer.answer || '-'}</strong>
              </label>
            ))}
          </div>
          <button className="primary-button" onClick={() => store.send({ type: 'mark_correct', playerIds: correctIds })} type="button">
            Continue
          </button>
        </>
      ) : (
        <p className="muted">The host is marking the answers.</p>
      )}
    </section>
  );
}

function AdvancingChoiceView({ state, playerId }) {
  const player = playerById(state, playerId);
  const fromTile = state.board.tiles[player.tileId];
  return (
    <section className="phase-panel">
      <span className="phase-kicker">Correct</span>
      <h2>Choose your path</h2>
      <PathButtons state={state} fromTile={fromTile} choices={state.pendingPathChoices[playerId]} />
    </section>
  );
}

function AdvancingReadyView({ state, playerId }) {
  const player = playerById(state, playerId);
  const ready = state.readyPlayerIds.includes(playerId);
  return (
    <section className="phase-panel">
      <CategoryCard state={state} playerId={playerId} title="Next category" />
      {player.inventory.length > 0 && <p className="muted">Item migration is next: {player.inventory.length} item available this phase.</p>}
      <button className="primary-button" disabled={ready} onClick={() => store.send({ type: 'ready' })} type="button">
        {ready ? 'Ready' : 'Ready up'}
      </button>
    </section>
  );
}

function CountingDownView({ state, playerId }) {
  const now = useNow(React, Boolean(state.countdownEnd));
  return (
    <section className="phase-panel">
      <CategoryCard state={state} playerId={playerId} title="Get ready" />
      <div className="timer">{secondsLeft(state.countdownEnd, now)}</div>
    </section>
  );
}

function FinishedView({ state, playerId }) {
  const winners = state.players.filter((player) => player.tileId === state.board.endTileId);
  const won = winners.some((player) => player.id === playerId);
  return (
    <section className="phase-panel">
      <span className="phase-kicker">Finished</span>
      <h2>{won ? 'You won!' : 'Winner'}</h2>
      <div className="player-list">
        {winners.map((player) => <PlayerPill key={player.id} player={player} />)}
      </div>
    </section>
  );
}

function PlayerPill({ player }) {
  return (
    <span className="player-pill">
      <Avatar player={player} />
      {player.name}
    </span>
  );
}

function directionLabel(from, to) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  if (angle < -0.6) return 'Up';
  if (angle > 0.6) return 'Down';
  return 'Forward';
}

function PhaseRouter({ view, state, playerId }) {
  switch (view) {
    case ControllerView.LOBBY:
      return <LobbyView state={state} playerId={playerId} />;
    case ControllerView.PATH_SELECTION: {
      const start = state.board.tiles[state.board.startTileId];
      return (
        <section className="phase-panel">
          <span className="phase-kicker">Start</span>
          <h2>Choose your starting path</h2>
          <PathButtons state={state} fromTile={start} choices={start.nextTiles} />
        </section>
      );
    }
    case ControllerView.PLAYING:
      return <PlayingView state={state} playerId={playerId} />;
    case ControllerView.ANSWERING:
      return <AnsweringView state={state} playerId={playerId} />;
    case ControllerView.REVEAL:
      return <RevealView state={state} playerId={playerId} />;
    case ControllerView.ANIMATING:
      return <section className="phase-panel"><h2>Moving players...</h2></section>;
    case ControllerView.ADVANCING_CHOICE:
      return <AdvancingChoiceView state={state} playerId={playerId} />;
    case ControllerView.ADVANCING_READY:
      return <AdvancingReadyView state={state} playerId={playerId} />;
    case ControllerView.COUNTING_DOWN:
      return <CountingDownView state={state} playerId={playerId} />;
    case ControllerView.FINISHED:
      return <FinishedView state={state} playerId={playerId} />;
    default:
      return <section className="phase-panel"><h2>Connecting...</h2></section>;
  }
}

function App() {
  const game = useGame();
  const view = useMemo(
    () => selectControllerView({ state: game.state, playerId: game.playerId }),
    [game.state, game.playerId],
  );

  if (view === ControllerView.JOIN) return <JoinView state={game.state} />;

  return (
    <div className="controller-app">
      {game.state && <Header state={game.state} playerId={game.playerId} />}
      {game.error && <div className="toast">{game.error}</div>}
      <PhaseRouter view={view} state={game.state} playerId={game.playerId} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
