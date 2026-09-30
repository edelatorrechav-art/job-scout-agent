"use client";

import { BuildingIcon, CloseIcon, PinIcon } from "@/components/icons";
import type { Employer } from "@/lib/employers/types";
import { describeLocation, type LocationPref } from "@/lib/location/types";

interface Props {
  employers: Employer[];
  location: LocationPref | null;
  onRemove: (name: string) => void;
  onClearLocation: () => void;
  disabled: boolean;
}

/** Saved settings: the location filter and the tracked employers. */
export function Sidebar({ employers, location, onRemove, onClearLocation, disabled }: Props) {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-5">
      <section>
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <PinIcon className="h-4 w-4" />
          Location filter
        </h2>
        <div className="mt-3">
          {location ? (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-brand-50 py-1.5 pl-3 pr-1.5 text-sm font-medium text-brand-600 ring-1 ring-brand/30">
              <span className="truncate">{describeLocation(location)}</span>
              <button
                type="button"
                onClick={onClearLocation}
                disabled={disabled}
                aria-label="Clear location filter"
                className="rounded-md p-0.5 text-brand-600/70 transition hover:bg-brand/15 hover:text-brand-600 disabled:opacity-40"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <p className="text-sm text-slate-600">
              <span className="font-medium text-navy">All locations</span>
              <span className="mt-1 block text-slate-500">
                Name a city or state in the chat to narrow the ledger.
              </span>
            </p>
          )}
        </div>
      </section>

      <section className="min-h-0">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <BuildingIcon className="h-4 w-4" />
          Tracked employers
          {employers.length > 0 && (
            <span className="ml-auto rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy">
              {employers.length}
            </span>
          )}
        </h2>
        {employers.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No employers on the books yet. Tell me at least two companies to watch.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {employers.map((e) => (
              <li
                key={e.name}
                title={e.boardUrl ?? "No job board found yet. Ask me to re-check it."}
                className={
                  "inline-flex max-w-full items-center gap-1 rounded-lg border py-1.5 pl-3 pr-1.5 text-sm shadow-sm " +
                  (e.boardUrl
                    ? "border-slate-200 bg-white text-navy"
                    : "border-dashed border-amber-300 bg-amber-50 text-amber-800")
                }
              >
                {e.boardUrl ? (
                  <a
                    href={e.boardUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-medium hover:text-brand-600 hover:underline"
                  >
                    {e.name}
                  </a>
                ) : (
                  <span className="truncate">
                    {e.name} <span className="text-xs">(no board)</span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(e.name)}
                  disabled={disabled}
                  aria-label={`Stop tracking ${e.name}`}
                  className="shrink-0 rounded-md p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-auto text-xs leading-relaxed text-slate-400">
        Your employers and location are saved in this browser.
      </p>
    </div>
  );
}
