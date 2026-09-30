"use client";

import type { Employer } from "@/lib/employers/types";
import { describeLocation, type LocationPref } from "@/lib/location/types";

interface Props {
  employers: Employer[];
  location: LocationPref | null;
  onRemove: (name: string) => void;
  onClearLocation: () => void;
  disabled: boolean;
}

/** The saved settings (location + employer chips), shown under the header. */
export function EmployerBar({ employers, location, onRemove, onClearLocation, disabled }: Props) {
  return (
    <div className="space-y-1.5 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Location
        </span>
        {location ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 py-0.5 pl-3 pr-1 dark:border-blue-800 dark:bg-blue-950">
            {describeLocation(location)}
            <button
              type="button"
              onClick={onClearLocation}
              disabled={disabled}
              aria-label="Clear location filter"
              className="rounded-full px-1.5 text-zinc-400 hover:bg-blue-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-blue-900 dark:hover:text-zinc-200"
            >
              ×
            </button>
          </span>
        ) : (
          <span className="text-zinc-500">All locations</span>
        )}
      </div>
      {employers.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No employers tracked yet. Tell me at least two companies to watch.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Tracking {employers.length}
          </span>
          {employers.map((e) => (
            <span
              key={e.name}
              className={
                "inline-flex items-center gap-1 rounded-full border py-0.5 pl-3 pr-1 text-sm " +
                (e.boardUrl
                  ? "border-zinc-300 dark:border-zinc-600"
                  : "border-dashed border-amber-400 text-zinc-500 dark:border-amber-600")
              }
              title={e.boardUrl ?? "No job board found yet. Ask me to add it again to retry."}
            >
              {e.boardUrl ? (
                <a
                  href={e.boardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {e.name}
                </a>
              ) : (
                <span>{e.name} (no board)</span>
              )}
              <button
                type="button"
                onClick={() => onRemove(e.name)}
                disabled={disabled}
                aria-label={`Stop tracking ${e.name}`}
                className="rounded-full px-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
