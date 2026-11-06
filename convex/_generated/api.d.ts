/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as http from "../http.js";
import type * as lib_filters from "../lib/filters.js";
import type * as lib_journeys from "../lib/journeys.js";
import type * as lib_places from "../lib/places.js";
import type * as lib_transitous from "../lib/transitous.js";
import type * as lib_trip from "../lib/trip.js";
import type * as quota from "../quota.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  http: typeof http;
  "lib/filters": typeof lib_filters;
  "lib/journeys": typeof lib_journeys;
  "lib/places": typeof lib_places;
  "lib/transitous": typeof lib_transitous;
  "lib/trip": typeof lib_trip;
  quota: typeof quota;
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
