import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <p className="text-7xl font-extrabold tracking-tight text-primary">404</p>
      <h1 className="mt-4 text-2xl font-bold">This page went missing</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The link may be old, or the tool has not shipped yet. The full catalog is one click away.
      </p>
      <div className="mt-6 flex gap-3">
        <Button asChild>
          <Link to="/">Back home</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/#all-tools">Browse all tools</Link>
        </Button>
      </div>
    </div>
  );
}
