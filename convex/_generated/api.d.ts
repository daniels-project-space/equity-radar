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
import type * as allocation from "../allocation.js";
import type * as crons from "../crons.js";
import type * as cryptoActions from "../cryptoActions.js";
import type * as data from "../data.js";
import type * as discovery from "../discovery.js";
import type * as ingest from "../ingest.js";
import type * as journal from "../journal.js";
import type * as lib_allocator from "../lib/allocator.js";
import type * as lib_calibrate from "../lib/calibrate.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_dip from "../lib/dip.js";
import type * as lib_earningsRelease from "../lib/earningsRelease.js";
import type * as lib_expectations from "../lib/expectations.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_metrics from "../lib/metrics.js";
import type * as lib_moat from "../lib/moat.js";
import type * as lib_prices from "../lib/prices.js";
import type * as lib_quality from "../lib/quality.js";
import type * as lib_regime from "../lib/regime.js";
import type * as lib_rules from "../lib/rules.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_sec from "../lib/sec.js";
import type * as lib_signals from "../lib/signals.js";
import type * as lib_simulate from "../lib/simulate.js";
import type * as lib_tournament from "../lib/tournament.js";
import type * as lib_trajectory from "../lib/trajectory.js";
import type * as lib_valuation from "../lib/valuation.js";
import type * as notify from "../notify.js";
import type * as pushActions from "../pushActions.js";
import type * as settings from "../settings.js";
import type * as strategyActions from "../strategyActions.js";
import type * as universe from "../universe.js";
import type * as watchlist from "../watchlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  allocation: typeof allocation;
  crons: typeof crons;
  cryptoActions: typeof cryptoActions;
  data: typeof data;
  discovery: typeof discovery;
  ingest: typeof ingest;
  journal: typeof journal;
  "lib/allocator": typeof lib_allocator;
  "lib/calibrate": typeof lib_calibrate;
  "lib/crypto": typeof lib_crypto;
  "lib/dip": typeof lib_dip;
  "lib/earningsRelease": typeof lib_earningsRelease;
  "lib/expectations": typeof lib_expectations;
  "lib/llm": typeof lib_llm;
  "lib/metrics": typeof lib_metrics;
  "lib/moat": typeof lib_moat;
  "lib/prices": typeof lib_prices;
  "lib/quality": typeof lib_quality;
  "lib/regime": typeof lib_regime;
  "lib/rules": typeof lib_rules;
  "lib/scoring": typeof lib_scoring;
  "lib/sec": typeof lib_sec;
  "lib/signals": typeof lib_signals;
  "lib/simulate": typeof lib_simulate;
  "lib/tournament": typeof lib_tournament;
  "lib/trajectory": typeof lib_trajectory;
  "lib/valuation": typeof lib_valuation;
  notify: typeof notify;
  pushActions: typeof pushActions;
  settings: typeof settings;
  strategyActions: typeof strategyActions;
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
