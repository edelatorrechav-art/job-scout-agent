"use client";

import { isLocationPref, type LocationPref } from "@/lib/location/types";
import { createLocalStore } from "@/lib/storage/localStore";

const isPrefOrNull = (v: unknown): v is LocationPref | null => v === null || isLocationPref(v);
const store = createLocalStore<LocationPref | null>("job-scout:location", isPrefOrNull, null);

export const getLocation = store.get;
export const saveLocation = store.set;
export const useLocation = store.useValue;
