// Музыка ў доку: удзельнік «мозгу» плюс тое, што ёсць толькі ў доку — уваход у Spotify і YouTube,
// і адзнака для debug-оверлэя. Стан і каманды — праз BrainNode: мозг можа працаваць тут або ў оверлэі.
// Уваход у Twitch і падключэнне OBS агульныя для ўсёй праграмы («Сістэма → Падключэнне»).

import { safeLocalStorage } from '../../core/settings';
import { createBrainNode } from '../../brain/node';
import { redirectUriFor, startLogin } from '../../providers/spotify/auth';
import { DIAG_MARKER_KEY, writeJson } from '../shared/diag';
import { youtubeSignInUrl } from '../../youtube/link';

export function createDockController() {
  const storage = safeLocalStorage();
  const node = createBrainNode({ page: 'dock', storage });
  const redirectUri = redirectUriFor(location.href);

  /** Пераход усёй старонкі дока на ўваход у Spotify; Spotify верне на callback.html. */
  async function connectSpotify(): Promise<void> {
    const clientId = node.settings.get().spotify.clientId;
    if (!isClientId(clientId)) return;
    location.href = await startLogin(storage, clientId, redirectUri);
  }

  /** Уваход у YouTube усёй старонкай дока; Google і YouTube вернуць на «Падключэнне». */
  function signInYouTube(): void {
    const back = new URL(location.href);
    back.hash = 'connections';
    location.href = youtubeSignInUrl(back.toString());
  }

  return {
    ...node,

    start() {
      writeJson(storage, DIAG_MARKER_KEY, Date.now());
      node.start();
    },

    connectSpotify,
    signInYouTube,
    spotifyRedirectUri: redirectUri,
  };
}

/** Client ID прыкладання Spotify — 32 шаснаццатковыя сімвалы. */
export function isClientId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}

export type DockController = ReturnType<typeof createDockController>;
