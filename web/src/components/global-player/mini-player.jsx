import { PlayerBar } from "./player-bar";

export function MiniPlayer(props) {
  if (props.currentMedia && !props.currentMedia.mime_type?.startsWith("audio/")) {
    return null;
  }
  return <PlayerBar isMini {...props} />;
}
