import { CustomEventTarget, TypedCustomEvent } from '../custom-event-target';
import { getPlayer } from './helpers';
import type {
  PlayerState,
  PlayerStateObject,
  VideoID,
  YTPlayer
} from './yt-api';

function diffPlayerState(
  prev: PlayerStateObject | null,
  next: PlayerStateObject
) {
  if (!prev) return next;

  const changes: Partial<PlayerStateObject> = {};

  for (const k in next) {
    const key = k as keyof PlayerStateObject;
    if (next[key] !== prev[key]) {
      changes[key] = next[key];
    }
  }

  return changes;
}

interface EventMap {
  newVideo: CustomEvent<VideoID>;
  playbackStart: CustomEvent<undefined>;
  stateChange: CustomEvent<PlayerState>;
}

export enum PlayerMode {
  PREVIEW,
  SHORTS,
  NORMAL
}

class PlayerManager extends CustomEventTarget<EventMap> {
  #player;
  #lastVideoID: VideoID | null = null;
  #lastPlayerState: PlayerStateObject | null = null;

  #handlePlayerStateChange = (state: PlayerState) => {
    try {
      this.dispatchEvent(
        new TypedCustomEvent('stateChange', { detail: state })
      );

      const current = this.#player.getPlayerStateObject();
      const diff = diffPlayerState(this.#lastPlayerState, current);
      this.#lastPlayerState = current;

      if (Object.keys(diff).length === 0) return;

      const currentVideoID = this.currentVideoID;
      if (currentVideoID && this.#lastVideoID !== currentVideoID) {
        this.#lastVideoID = currentVideoID;
        this.dispatchEvent(
          new TypedCustomEvent('newVideo', { detail: currentVideoID })
        );
      }

      if (diff.isPlaying) {
        this.dispatchEvent(new TypedCustomEvent('playbackStart'));
      }
    } catch (err) {
      // Never let our bookkeeping throw inside YouTube's event dispatch.
      console.warn('[PlayerManager] state handler failed:', err);
    }
  };

  constructor(player: YTPlayer) {
    super();
    this.#player = player;

    player.addEventListener('onStateChange', this.#handlePlayerStateChange);
  }

  get currentVideoID(): VideoID | null {
    return this.#player.getVideoData()?.video_id || null;
  }

  get playerMode() {
    if (this.#player.isInline()) return PlayerMode.PREVIEW;

    if (this.#player.getVideoStats().el === 'shortspage') {
      return PlayerMode.SHORTS;
    }

    return PlayerMode.NORMAL;
  }

  get player(): YTPlayer {
    return this.#player;
  }
}

let instance: Promise<PlayerManager> | null = null;

export function getPlayerManager(): Promise<PlayerManager> {
  instance ??= getPlayer().then((player) => new PlayerManager(player));
  return instance;
}

export type { PlayerManager };
