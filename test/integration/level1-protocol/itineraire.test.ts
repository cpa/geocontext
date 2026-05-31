/**
 * Integration test: itineraire tool with real API calls.
 */

import { describe, it, expect } from "vitest";
import { callTool } from "../helpers/mcp-client.js";
import { withMcpServer } from "../helpers/level1-fixtures.js";
import { expectToolCallToThrow } from "../helpers/level1-assertions.js";
import { INTEGRATION_CONFIG } from "../config/shared.js";
import { paris } from "../samples.js";

interface ItineraireFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {
      resource: string;
      profile: string;
      optimization: string;
      crs: string;
      distanceUnit: string;
      timeUnit: string;
      distance?: number;
      duration?: number;
      turnByTurn?: unknown[];
    };
    geometry: {
      type: string;
      coordinates: unknown[];
    };
  }>;
}

interface ItineraireRequestPayload {
  result_type: "request";
  method: "GET";
  url: string;
  query: Record<string, string>;
  body: "";
  get_url: string;
}

describe("Itineraire Tool (integration)", () => {
  const { getHandle } = withMcpServer();

  it("should return a normalized GeoJSON FeatureCollection for a short Paris route", async () => {
    const result = await callTool<ItineraireFeatureCollection>(getHandle().client, "itineraire", {
      start_lon: paris.lon,
      start_lat: paris.lat,
      end_lon: 2.367776,
      end_lat: 48.852891,
      profile: "pedestrian",
    });

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].type).toBe("Feature");
    expect(result.features[0].geometry.type).toBe("LineString");
    expect(Array.isArray(result.features[0].geometry.coordinates)).toBe(true);
    expect(result.features[0].properties).toMatchObject({
      resource: "bdtopo-osrm",
      profile: "pedestrian",
      optimization: "fastest",
      crs: "EPSG:4326",
      distanceUnit: "meter",
      timeUnit: "second",
    });
    expect(result.features[0].properties.distance).toBeGreaterThan(0);
    expect(result.features[0].properties.duration).toBeGreaterThan(0);
    expect(result.features[0].properties.turnByTurn).toEqual(expect.any(Array));
  }, INTEGRATION_CONFIG.timeout);

  it("should return a compact request payload without calling the upstream service", async () => {
    const result = await callTool<ItineraireRequestPayload>(getHandle().client, "itineraire", {
      start_lon: paris.lon,
      start_lat: paris.lat,
      end_lon: 2.367776,
      end_lat: 48.852891,
      profile: "car",
      result_type: "request",
    });

    expect(result).toMatchObject({
      result_type: "request",
      method: "GET",
      url: "https://data.geopf.fr/navigation/itineraire",
      body: "",
    });
    expect(result.query).toMatchObject({
      resource: "bdtopo-osrm",
      profile: "car",
      optimization: "fastest",
      waysAttributes: "name",
      geometryFormat: "geojson",
    });
    expect(result.get_url).toContain("resource=bdtopo-osrm");
  }, INTEGRATION_CONFIG.timeout);

  it("should return an error for invalid optimization", async () => {
    await expectToolCallToThrow(callTool(getHandle().client, "itineraire", {
      start_lon: paris.lon,
      start_lat: paris.lat,
      end_lon: 2.367776,
      end_lat: 48.852891,
      profile: "car",
      optimization: "balanced",
    }));
  }, INTEGRATION_CONFIG.timeout);
});
