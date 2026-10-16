import type { ProviderDef } from './types';

const providers = new Map<string, ProviderDef>();

export function registerProvider(def: ProviderDef) {
  providers.set(def.key, def);
}

export function getProvider(key: string) {
  return providers.get(key);
}

export function listProviders() {
  return [...providers.values()];
}
