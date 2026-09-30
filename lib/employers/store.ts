"use client";

import { isEmployerList, type Employer } from "@/lib/employers/types";
import { createLocalStore } from "@/lib/storage/localStore";

const EMPTY: Employer[] = [];
const store = createLocalStore("job-scout:employers", isEmployerList, EMPTY);

export const getEmployers = store.get;
export const saveEmployers = store.set;
export const useEmployers = store.useValue;
