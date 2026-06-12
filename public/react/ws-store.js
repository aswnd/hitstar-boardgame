const PLAYER_ID_KEY = 'hitstar.playerId';

export function createGameStore({ reconnectPlayer = true } = {}) {
  let snapshot = {
    connected: false,
    playerId: localStorage.getItem(PLAYER_ID_KEY),
    isHost: false,
    state: null,
    error: null,
  };
  let socket = null;
  let reconnectTimer = null;
  const listeners = new Set();

  const emit = () => listeners.forEach((listener) => listener());
  const setSnapshot = (patch) => {
    snapshot = { ...snapshot, ...patch };
    emit();
  };

  const connect = () => {
    if (socket && socket.readyState < WebSocket.CLOSING) return;

    socket = new WebSocket(`ws://${location.host}/ws`);
    socket.addEventListener('open', () => {
      setSnapshot({ connected: true, error: null });
      if (reconnectPlayer && snapshot.playerId) send({ type: 'reconnect', playerId: snapshot.playerId });
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'state') {
        setSnapshot({ state: message.state });
        return;
      }

      if (message.type === 'joined') {
        localStorage.setItem(PLAYER_ID_KEY, message.playerId);
        setSnapshot({ playerId: message.playerId, isHost: message.isHost, error: null });
        return;
      }

      if (message.type === 'error') {
        if (message.message === 'Player not found') {
          localStorage.removeItem(PLAYER_ID_KEY);
          setSnapshot({ playerId: null, isHost: false, error: message.message });
        } else {
          setSnapshot({ error: message.message });
        }
      }
    });

    socket.addEventListener('close', () => {
      setSnapshot({ connected: false });
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1500);
    });
  };

  const send = (message) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  connect();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    send,
    join({ name, avatarImage, avatarEmoji }) {
      send({ type: 'join', name, avatarImage, avatarEmoji });
    },
    clearPlayer() {
      localStorage.removeItem(PLAYER_ID_KEY);
      setSnapshot({ playerId: null, isHost: false });
    },
  };
}
