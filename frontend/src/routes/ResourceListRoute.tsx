import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listResources, todayInBerlin } from '../lib';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Resource list route (`/resources`) — FS-01 FR-1/§6.1/AC-1, issues #23/#25.
 *
 * The entry point of Flow A: every bookable resource (rooms and shared
 * equipment together, unfiltered — no filtering UI belongs here, that is
 * issue #27's job for the schedule view) in one accessible list. A plain
 * semantic list of real links is the correct structure for "navigate to
 * one of several things" — this is standard web navigation, not a custom
 * interactive widget, so no heavier ARIA primitive (listbox/grid) is
 * needed here (Core Rule 1 + component-boundary guidance). shadcn/ui
 * supplies only the visual layer (`Skeleton`/`Alert`/`Empty` states and
 * card-styled links via design tokens).
 *
 * `description` is a backend `NOT NULL` string column that may be `''`
 * (see `backend/src/routes/resources.ts`), never entirely absent from the
 * JSON — so "no description" is checked as an empty/whitespace-only
 * string, not a presence/`undefined` check. Per §10, a description-less
 * resource is listed with the description area simply omitted: no empty
 * paragraph, no "No description" filler text.
 */
export function ResourceListRoute() {
  const query = useQuery({
    queryKey: ['resources'],
    queryFn: listResources,
  });

  return (
    <section aria-labelledby="resource-list-heading" className="flex flex-col gap-6">
      <h1 id="resource-list-heading" className="font-heading text-2xl font-semibold">
        Resources
      </h1>

      {query.isLoading && (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Loading resources…</p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {query.isError && (
        <Alert variant="destructive">
          <AlertTitle>Resources could not be loaded.</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onPress={() => query.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {query.isSuccess && query.data.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No resources yet</EmptyTitle>
            <EmptyDescription>
              No resources are available to book yet. Please check back later.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {query.isSuccess && query.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {query.data.map((resource) => {
            const hasDescription = resource.description.trim() !== '';

            return (
              <li key={resource.id}>
                <Link
                  to={`/resources/${resource.id}/schedule/${todayInBerlin()}`}
                  className="flex flex-col gap-1 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="font-medium">{resource.name}</span>
                  {hasDescription && (
                    <span className="text-sm text-muted-foreground">
                      {resource.description}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
