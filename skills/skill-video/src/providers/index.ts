import type { Provider, VideoProvider } from '../types';
import { GoogleVeoProvider } from './google-veo';
import { OpenAISoraProvider } from './openai-sora';
import { RunwayProvider } from './runway';

export function getProvider(provider: Provider): VideoProvider {
  switch (provider) {
    case 'google':
      return new GoogleVeoProvider();
    case 'openai':
      return new OpenAISoraProvider();
    case 'runway':
      return new RunwayProvider();
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export { GoogleVeoProvider, OpenAISoraProvider, RunwayProvider };
