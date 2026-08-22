import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Loader2, LogIn } from './icons';

import { askForLogin } from '@/content/session';
import { sessionStore } from '@/content/sessionStore';

/** Spinner while we check Cardmarket sign-in. */
export const CheckingSession = () => (
  <EmptyState
    hint="Checking whether you're signed in to Cardmarket…"
    icon={Loader2}
    title="One moment"
  />
);
/** Full-panel prompt: sign in on Cardmarket, collapse Lugin, reopen after login. */
export const LoginGate = ({ feature }: { feature: string }) => (
  <EmptyState
    action={
      <Button icon={LogIn} onClick={() => askForLogin()} size="sm" variant="primary">
        Sign in on Cardmarket
      </Button>
    }
    hint={`${feature} needs your Cardmarket account. Lugin will collapse so you can sign in on Cardmarket's own page — we'll reopen when you're back.`}
    icon={LogIn}
    title="Sign in to Cardmarket"
  />
);

/** Block Cardmarket-only tab content until the browser session is signed in. */
export const RequiresLogin = ({
  active,
  children,
  feature,
}: {
  /** Tab is selected — only then replace content with the gate. */
  active: boolean;
  children: ReactNode;
  feature: string;
}) => {
  const { signedIn } = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);

  if (!active) return children;
  if (signedIn === null) return <CheckingSession />;
  if (!signedIn) return <LoginGate feature={feature} />;
  return children;
};
