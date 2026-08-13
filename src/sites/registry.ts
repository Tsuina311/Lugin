import { cardmarketAdapter } from './cardmarket/adapter';
import type { SiteAdapter } from './types';

// Register a SiteAdapter here for every Magic site you want to support.
const ADAPTERS: SiteAdapter[] = [cardmarketAdapter];

/** Find the adapter that handles the given hostname, if any. */
export const adapterForHost = (host: string): SiteAdapter | undefined =>
  ADAPTERS.find(a => a.matchesHost(host));
