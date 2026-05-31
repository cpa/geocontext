import type { Feature, FeatureCollection, LineString } from "geojson";

import { fetchJSONGet } from "../helpers/http.js";
import type { JsonFetcher } from "../helpers/http.js";
import { createRateLimiter } from "../helpers/RateLimiter.js";
import logger from "../logger.js";

export const ITINERAIRE_SOURCE = "Géoplateforme (navigation, itinéraire)";
export const ITINERAIRE_URL = "https://data.geopf.fr/navigation/itineraire";

export const ITINERAIRE_DEFAULTS = {
  resource: "bdtopo-osrm",
  profile: "car",
  optimization: "fastest",
  get_steps: true,
  get_bbox: true,
  ways_attributes: ["name"],
  distance_unit: "meter",
  time_unit: "second",
  crs: "EPSG:4326",
  geometry_format: "geojson",
} as const;

const gpfItineraireRateLimit = parseInt(process.env.GPF_ITINERAIRE_RATE_LIMIT || "5", 10);
const gpfItineraireRateLimiter = createRateLimiter("GPF_ITINERAIRE", gpfItineraireRateLimit, 1);

export type ItineraireProfile = "car" | "pedestrian";
export type ItineraireOptimization = "fastest" | "shortest";
export type ItineraireDistanceUnit = "meter" | "kilometer";
export type ItineraireTimeUnit = "hour" | "minute" | "second" | "standard";
export type ItineraireConstraintType = "banned";
export type ItineraireConstraintKey = "waytype";
export type ItineraireConstraintOperator = "=";
export type ItineraireConstraintValue = "autoroute" | "pont" | "tunnel";

export type ItinerairePoint = {
  lon: number;
  lat: number;
};

export type ItineraireConstraint = {
  constraint_type: ItineraireConstraintType;
  key: ItineraireConstraintKey;
  operator: ItineraireConstraintOperator;
  value: ItineraireConstraintValue;
};

export type ItineraireRequestInput = {
  start_lon: number;
  start_lat: number;
  end_lon: number;
  end_lat: number;
  intermediates?: ItinerairePoint[];
  profile?: ItineraireProfile;
  optimization?: ItineraireOptimization;
  get_steps?: boolean;
  get_bbox?: boolean;
  distance_unit?: ItineraireDistanceUnit;
  time_unit?: ItineraireTimeUnit;
  constraints?: ItineraireConstraint[];
};

type NormalizedItineraireInput = Required<Omit<ItineraireRequestInput, "intermediates" | "constraints">> & {
  resource: typeof ITINERAIRE_DEFAULTS.resource;
  crs: typeof ITINERAIRE_DEFAULTS.crs;
  geometry_format: typeof ITINERAIRE_DEFAULTS.geometry_format;
  ways_attributes: readonly string[];
  intermediates: ItinerairePoint[];
  constraints: ItineraireConstraint[];
};

export type ItineraireCompiledRequest = {
  result_type?: "request";
  method: "GET";
  url: string;
  query: Record<string, string>;
  body: "";
  get_url: string;
};

type RawItineraireResponse = {
  resource?: string;
  resourceVersion?: string;
  start?: string;
  end?: string;
  profile?: string;
  optimization?: string;
  geometry?: unknown;
  crs?: string;
  distanceUnit?: string;
  timeUnit?: string;
  bbox?: unknown;
  distance?: number;
  duration?: number;
  constraints?: unknown;
  alerts?: unknown;
  portions?: unknown;
};

type ItineraireTurnByTurnInstruction = {
  type?: string;
  modifier?: string;
  exit?: string | number;
};

type ItineraireTurnByTurnAttribute = {
  key: string;
  value: string;
};

export type ItineraireTurnByTurnStep = {
  portionIndex: number;
  stepIndex: number;
  id?: string | number;
  distance?: number;
  duration?: number;
  instruction?: ItineraireTurnByTurnInstruction;
  attributes?: ItineraireTurnByTurnAttribute[];
  geometry?: unknown;
  alerts?: unknown;
};

type ItineraireFeatureProperties = {
  source: string;
  resource: string;
  resourceVersion?: string;
  start: string;
  end: string;
  requestedStart: string;
  requestedEnd: string;
  requestedIntermediates?: string[];
  profile: string;
  optimization: string;
  crs: string;
  distanceUnit: string;
  timeUnit: string;
  getSteps: boolean;
  getBbox: boolean;
  bbox?: unknown;
  distance?: number;
  duration?: number;
  constraints?: unknown;
  alerts?: unknown;
  turnByTurn?: ItineraireTurnByTurnStep[];
  portions?: unknown;
};

export type ItineraireFeatureCollection = FeatureCollection<LineString, ItineraireFeatureProperties>;

/**
 * Applies stable client-side defaults used by the MCP tool.
 *
 * @param input Raw itinerary request input.
 * @returns Input completed with default navigation options.
 */
function normalizeItineraireInput(input: ItineraireRequestInput): NormalizedItineraireInput {
  return {
    start_lon: input.start_lon,
    start_lat: input.start_lat,
    end_lon: input.end_lon,
    end_lat: input.end_lat,
    intermediates: input.intermediates ?? [],
    profile: input.profile ?? ITINERAIRE_DEFAULTS.profile,
    optimization: input.optimization ?? ITINERAIRE_DEFAULTS.optimization,
    get_steps: input.get_steps ?? ITINERAIRE_DEFAULTS.get_steps,
    get_bbox: input.get_bbox ?? ITINERAIRE_DEFAULTS.get_bbox,
    distance_unit: input.distance_unit ?? ITINERAIRE_DEFAULTS.distance_unit,
    time_unit: input.time_unit ?? ITINERAIRE_DEFAULTS.time_unit,
    constraints: input.constraints ?? [],
    resource: ITINERAIRE_DEFAULTS.resource,
    crs: ITINERAIRE_DEFAULTS.crs,
    geometry_format: ITINERAIRE_DEFAULTS.geometry_format,
    ways_attributes: ITINERAIRE_DEFAULTS.ways_attributes,
  };
}

/**
 * Serializes a public numeric point into the upstream `lon,lat` format.
 *
 * @param point Point to serialize.
 * @returns Upstream coordinate string.
 */
function serializePoint(point: ItinerairePoint) {
  return `${point.lon},${point.lat}`;
}

/**
 * Converts MCP-facing constraint keys to the upstream GeoPlateforme shape.
 *
 * @param constraint Constraint supplied to the MCP tool.
 * @returns Constraint encoded with upstream field names.
 */
function toUpstreamConstraint(constraint: ItineraireConstraint) {
  return {
    constraintType: constraint.constraint_type,
    key: constraint.key,
    operator: constraint.operator,
    value: constraint.value,
  };
}

/**
 * Serializes constraints using the pipe-delimited style advertised by the upstream API.
 *
 * @param constraints Constraints supplied to the MCP tool.
 * @returns Pipe-delimited JSON objects, or `undefined` when there are no constraints.
 */
function serializeConstraints(constraints: ItineraireConstraint[]) {
  if (constraints.length === 0) {
    return undefined;
  }
  return constraints.map((constraint) => JSON.stringify(toUpstreamConstraint(constraint))).join("|");
}

/**
 * Builds the GeoPlateforme itinerary GET request without executing it.
 *
 * @param input Raw itinerary request input.
 * @returns The compiled GET request and reusable URL.
 */
export function buildItineraireRequest(input: ItineraireRequestInput): ItineraireCompiledRequest {
  const normalizedInput = normalizeItineraireInput(input);
  const query: Record<string, string> = {
    resource: normalizedInput.resource,
    start: serializePoint({
      lon: normalizedInput.start_lon,
      lat: normalizedInput.start_lat,
    }),
    end: serializePoint({
      lon: normalizedInput.end_lon,
      lat: normalizedInput.end_lat,
    }),
    profile: normalizedInput.profile,
    optimization: normalizedInput.optimization,
    getSteps: String(normalizedInput.get_steps),
    getBbox: String(normalizedInput.get_bbox),
    waysAttributes: normalizedInput.ways_attributes.join("|"),
    distanceUnit: normalizedInput.distance_unit,
    timeUnit: normalizedInput.time_unit,
    crs: normalizedInput.crs,
    geometryFormat: normalizedInput.geometry_format,
  };

  if (normalizedInput.intermediates.length > 0) {
    query.intermediates = normalizedInput.intermediates.map(serializePoint).join("|");
  }

  const serializedConstraints = serializeConstraints(normalizedInput.constraints);
  if (serializedConstraints) {
    query.constraints = serializedConstraints;
  }

  const getUrl = `${ITINERAIRE_URL}?${new URLSearchParams(query).toString()}`;

  return {
    method: "GET",
    url: ITINERAIRE_URL,
    query,
    body: "",
    get_url: getUrl,
  };
}

/**
 * Maps a compiled request to the compact MCP `result_type="request"` payload.
 *
 * @param request Compiled itinerary request.
 * @returns A compact request payload consistent with request-mode tools.
 */
export function toItineraireRequestPayload(request: ItineraireCompiledRequest): Required<ItineraireCompiledRequest> {
  return {
    result_type: "request",
    method: request.method,
    url: request.url,
    query: request.query,
    body: request.body,
    get_url: request.get_url,
  };
}

/**
 * Checks whether a value looks like the GeoJSON LineString returned by the upstream service.
 *
 * @param value Unknown upstream geometry.
 * @returns `true` when the value has the expected route geometry shape.
 */
function isGeoJsonLineString(value: unknown): value is LineString {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === "LineString" && Array.isArray(record.coordinates);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeInstruction(value: unknown): ItineraireTurnByTurnInstruction | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const instruction: ItineraireTurnByTurnInstruction = {};
  if (typeof value.type === "string") {
    instruction.type = value.type;
  }
  if (typeof value.modifyer === "string") {
    instruction.modifier = value.modifyer;
  } else if (typeof value.modifier === "string") {
    instruction.modifier = value.modifier;
  }
  if (typeof value.exit === "string" || typeof value.exit === "number") {
    instruction.exit = value.exit;
  }

  return Object.keys(instruction).length > 0 ? instruction : undefined;
}

function normalizeStepAttributes(value: unknown): ItineraireTurnByTurnAttribute[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const attributes = value.flatMap((item) => {
    if (!isRecord(item) || typeof item.key !== "string" || typeof item.value !== "string") {
      return [];
    }
    return [{
      key: item.key,
      value: item.value,
    }];
  });

  return attributes.length > 0 ? attributes : undefined;
}

function normalizeTurnByTurn(portions: unknown): ItineraireTurnByTurnStep[] | undefined {
  if (!Array.isArray(portions)) {
    return undefined;
  }

  const turnByTurn: ItineraireTurnByTurnStep[] = [];
  portions.forEach((portion, portionIndex) => {
    if (!isRecord(portion) || !Array.isArray(portion.steps)) {
      return;
    }

    portion.steps.forEach((step, stepIndex) => {
      if (!isRecord(step)) {
        return;
      }

      const normalizedStep: ItineraireTurnByTurnStep = {
        portionIndex,
        stepIndex,
      };
      if (typeof step.id === "string" || typeof step.id === "number") {
        normalizedStep.id = step.id;
      }
      if (typeof step.distance === "number") {
        normalizedStep.distance = step.distance;
      }
      if (typeof step.duration === "number") {
        normalizedStep.duration = step.duration;
      }

      const instruction = normalizeInstruction(step.instruction);
      if (instruction) {
        normalizedStep.instruction = instruction;
      }

      const attributes = normalizeStepAttributes(step.attributs ?? step.attributes);
      if (attributes) {
        normalizedStep.attributes = attributes;
      }

      if (step.geometry !== undefined) {
        normalizedStep.geometry = step.geometry;
      }
      if (step.alerts !== undefined) {
        normalizedStep.alerts = step.alerts;
      }

      turnByTurn.push(normalizedStep);
    });
  });

  return turnByTurn.length > 0 ? turnByTurn : undefined;
}

/**
 * Normalizes the upstream itinerary envelope into a single-feature GeoJSON FeatureCollection.
 *
 * @param raw Upstream GeoPlateforme response.
 * @param input Original request input, used as a fallback for metadata fields.
 * @returns A GeoJSON FeatureCollection containing the computed route geometry.
 */
export function normalizeItineraireResponse(
  raw: RawItineraireResponse,
  input: ItineraireRequestInput,
): ItineraireFeatureCollection {
  const normalizedInput = normalizeItineraireInput(input);
  const requestedStart = serializePoint({
    lon: normalizedInput.start_lon,
    lat: normalizedInput.start_lat,
  });
  const requestedEnd = serializePoint({
    lon: normalizedInput.end_lon,
    lat: normalizedInput.end_lat,
  });
  const requestedIntermediates = normalizedInput.intermediates.map(serializePoint);

  if (raw.geometry === undefined || raw.geometry === null) {
    throw new Error("Le service d'itinéraire n'a renvoyé aucune géométrie.");
  }
  if (!isGeoJsonLineString(raw.geometry)) {
    throw new Error("La géométrie renvoyée par le service d'itinéraire est invalide.");
  }

  const turnByTurn = normalizeTurnByTurn(raw.portions);
  const properties: ItineraireFeatureProperties = {
    source: ITINERAIRE_SOURCE,
    resource: raw.resource ?? normalizedInput.resource,
    ...(raw.resourceVersion ? { resourceVersion: raw.resourceVersion } : {}),
    start: raw.start ?? requestedStart,
    end: raw.end ?? requestedEnd,
    requestedStart,
    requestedEnd,
    ...(requestedIntermediates.length > 0 ? { requestedIntermediates } : {}),
    profile: raw.profile ?? normalizedInput.profile,
    optimization: raw.optimization ?? normalizedInput.optimization,
    crs: raw.crs ?? normalizedInput.crs,
    distanceUnit: raw.distanceUnit ?? normalizedInput.distance_unit,
    timeUnit: raw.timeUnit ?? normalizedInput.time_unit,
    getSteps: normalizedInput.get_steps,
    getBbox: normalizedInput.get_bbox,
    ...(raw.bbox !== undefined ? { bbox: raw.bbox } : {}),
    ...(typeof raw.distance === "number" ? { distance: raw.distance } : {}),
    ...(typeof raw.duration === "number" ? { duration: raw.duration } : {}),
    ...(raw.constraints !== undefined ? { constraints: raw.constraints } : {}),
    ...(raw.alerts !== undefined ? { alerts: raw.alerts } : {}),
    ...(turnByTurn !== undefined ? { turnByTurn } : {}),
    ...(raw.portions !== undefined ? { portions: raw.portions } : {}),
  };

  const feature: Feature<LineString, ItineraireFeatureProperties> = {
    type: "Feature",
    properties,
    geometry: raw.geometry,
  };

  return {
    type: "FeatureCollection",
    features: [feature],
  };
}

/**
 * Computes an itinerary from the GeoPlateforme navigation service.
 *
 * @param input Raw itinerary request input.
 * @param fetcher Optional JSON fetcher for tests.
 * @returns A normalized single-feature GeoJSON FeatureCollection.
 */
export async function getItineraire(
  input: ItineraireRequestInput,
  fetcher: JsonFetcher<RawItineraireResponse> = fetchJSONGet,
): Promise<ItineraireFeatureCollection> {
  logger.debug(`[gpf:itineraire] getItineraire(${JSON.stringify(input)})...`);

  await gpfItineraireRateLimiter.limit();
  const request = buildItineraireRequest(input);
  const json = await fetcher(request.get_url);
  return normalizeItineraireResponse(json, input);
}
