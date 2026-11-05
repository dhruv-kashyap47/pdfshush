import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hardReload } from '@/lib/build-recovery';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort UI boundary. A failed lazy chunk (common after a deploy) or a
 * render error should leave the header/footer and a way forward instead of a
 * blank page. The boundary is keyed by route in App, so navigating starts clean.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The route error itself is useful; unlike file data, it carries no bytes.
    console.error('[ui] route failed:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-2xl font-bold">Something went wrong on this page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your files were not uploaded. Reload the page to try again, or return home and pick the
          tool from the catalog.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={() => void hardReload()}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> Reload page
          </Button>
          <Button variant="outline" asChild>
            <a href="/">Back home</a>
          </Button>
        </div>
        {import.meta.env.DEV ? (
          <pre className="mt-6 max-h-40 w-full overflow-auto rounded-lg bg-muted p-3 text-left text-xs text-muted-foreground">
            {this.state.error.message}
          </pre>
        ) : null}
      </div>
    );
  }
}
