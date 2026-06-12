export const CATEGORY_LABELS = {
  title: 'Title',
  artist: 'Artist',
  year_exact: 'Exact year',
  year_range: 'Year +/- 3',
  decade: 'Decade',
};

export const CATEGORY_PROMPTS = {
  title: 'Name the song title.',
  artist: 'Name the artist.',
  year_exact: 'Name the release year.',
  year_range: 'Get within three years.',
  decade: 'Name the decade.',
};

export const COLOR_HEX = {
  red: '#e74c3c',
  blue: '#3498db',
  green: '#2ecc71',
  yellow: '#f1c40f',
  purple: '#9b59b6',
};

export function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

export function secondsLeft(end) {
  return Math.ceil(Math.max(0, (end ?? 0) - Date.now()) / 1000);
}

export function useNow(React, active) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function avatarContent(player) {
  if (player?.avatarImage) {
    return React.createElement('img', { src: player.avatarImage, alt: '', className: 'avatar-img' });
  }
  return player?.name?.slice(0, 1).toUpperCase() ?? '?';
}
