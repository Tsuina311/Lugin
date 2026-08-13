import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from './components/Button';

interface Props {
  children: ReactNode;
  /** Optional compact fallback (used when wrapping a single panel). */
  compact?: boolean;
  /** Shown in the fallback so the user knows which part failed. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/lifecycle errors in its subtree so one broken panel (or a
 * transient "Extension context invalidated" during heavy navigation) can't blank
 * the whole overlay. Shows a small retry affordance instead of an empty screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a breadcrumb in the console; never rethrow.
    console.error(`[Lugin] ${this.props.label ?? 'overlay'} crashed:`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const invalidated =
      /Extension context invalidated|context invalidated|message port closed/i.test(error.message);

    return (
      <div
        className={`flex flex-col items-start gap-2 text-[11px] text-slate-300 ${
          this.props.compact ? 'p-3' : 'h-full justify-center p-4'
        }`}
      >
        <div className="font-semibold text-red-400">
          {this.props.label ? `${this.props.label} hit an error` : 'Something went wrong'}
        </div>
        <div className="text-slate-400">
          {invalidated
            ? 'The extension was reloaded or updated. Refresh the page to reconnect.'
            : (error.message || 'Unexpected error').slice(0, 300)}
        </div>
        <div className="flex gap-2">
          <Button onClick={this.reset} size="md" variant="primary">
            Retry
          </Button>
          <Button onClick={() => location.reload()} size="md" variant="neutral">
            Reload page
          </Button>
        </div>
      </div>
    );
  }
}
