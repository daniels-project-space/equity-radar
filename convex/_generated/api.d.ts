/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as crons from "../crons.js";
import type * as data from "../data.js";
import type * as ingest from "../ingest.js";
import type * as lib_metrics from "../lib/metrics.js";
import type * as lib_prices from "../lib/prices.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_sec from "../lib/sec.js";
import type * as settings from "../settings.js";
import type * as universe from "../universe.js";
import type * as watchlist from "../watchlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  crons: typeof crons;
  data: typeof data;
  ingest: typeof ingest;
  "lib/metrics": typeof lib_metrics;
  "lib/prices": typeof lib_prices;
  "lib/scoring": typeof lib_scoring;
  "lib/sec": typeof lib_sec;
  settings: typeof settings;
  universe: typeof universe;
  watchlist: typeof watchlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
