import { describe, it, expect } from "vitest";

import { ITINERAIRE_SOURCE, type ItineraireFeatureCollection } from "../../src/gpf/itineraire";
import ItineraireTool from "../../src/tools/ItineraireTool";
import { paris } from "../samples";

const itineraireFeatureCollection: ItineraireFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        source: ITINERAIRE_SOURCE,
        resource: "bdtopo-osrm",
        resourceVersion: "2026-05-26",
        start: "2.333333,48.866667",
        end: "2.367842,48.85278",
        requestedStart: "2.333333,48.866667",
        requestedEnd: "2.367776,48.852891",
        profile: "car",
        optimization: "fastest",
        crs: "EPSG:4326",
        distanceUnit: "meter",
        timeUnit: "second",
        getSteps: true,
        getBbox: true,
        bbox: [2.333333, 48.85278, 2.367842, 48.866667],
        distance: 2562.9,
        duration: 581.1,
        turnByTurn: [
          {
            portionIndex: 0,
            stepIndex: 0,
            instruction: {
              type: "turn",
              modifier: "right",
            },
            attributes: [
              {
                key: "name",
                value: "Rue de Rivoli",
              },
            ],
            distance: 120,
            duration: 20,
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [2.333333, 48.866667],
          [2.35, 48.86],
          [2.367842, 48.85278],
        ],
      },
    },
  ],
};

describe("Test ItineraireTool", () => {
  class TestableItineraireTool extends ItineraireTool {
    async execute(): Promise<ItineraireFeatureCollection> {
      return itineraireFeatureCollection;
    }
  }

  it("should expose an enriched MCP definition", () => {
    const tool = new ItineraireTool();
    expect(tool.toolDefinition.title).toEqual("Calcul d’itinéraire");
    expect(tool.toolDefinition.inputSchema.properties?.start_lon).toMatchObject({
      type: "number",
      minimum: -180,
      maximum: 180,
    });
    expect(tool.toolDefinition.inputSchema.properties?.start_lat).toMatchObject({
      type: "number",
      minimum: -90,
      maximum: 90,
    });
    expect(tool.toolDefinition.inputSchema.properties?.end_lon).toMatchObject({
      type: "number",
      minimum: -180,
      maximum: 180,
    });
    expect(tool.toolDefinition.inputSchema.properties?.end_lat).toMatchObject({
      type: "number",
      minimum: -90,
      maximum: 90,
    });
    expect(tool.toolDefinition.inputSchema.properties?.result_type).toMatchObject({
      type: "string",
      enum: ["results", "request"],
      default: "results",
    });
    expect(tool.toolDefinition.inputSchema.properties?.profile).toMatchObject({
      type: "string",
      enum: ["car", "pedestrian"],
    });
    expect(tool.toolDefinition.inputSchema.properties?.profile).not.toHaveProperty("default");
    expect(tool.toolDefinition.inputSchema.properties?.profile).toMatchObject({
      description: expect.stringContaining("demander à l'utilisateur de choisir"),
    });
    expect(tool.toolDefinition.inputSchema.required).toEqual(expect.arrayContaining(["profile"]));
    expect(tool.toolDefinition.inputSchema.properties?.optimization).toMatchObject({
      type: "string",
      enum: ["fastest", "shortest"],
      default: "fastest",
    });
    expect(tool.toolDefinition.inputSchema.properties?.constraints).toMatchObject({
      type: "array",
      maxItems: 3,
    });
    expect(tool.toolDefinition.inputSchema.properties?.resource).toBeUndefined();
    expect(tool.toolDefinition.inputSchema.properties?.crs).toBeUndefined();
    expect(tool.toolDefinition.inputSchema.properties?.geometryFormat).toBeUndefined();
    expect(tool.toolDefinition.outputSchema).toBeUndefined();
  });

  it("should return text content and structuredContent for normalized GeoJSON results", async () => {
    const c = paris.coordinates;
    const tool = new TestableItineraireTool();
    const response = await tool.toolCall({
      params: {
        name: "itineraire",
        arguments: {
          start_lon: c[0],
          start_lat: c[1],
          end_lon: 2.367776,
          end_lat: 48.852891,
          profile: "car",
        },
      },
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0]).toMatchObject({
      type: "text",
    });
    const textContent = response.content[0];
    if (textContent.type !== "text") {
      throw new Error("expected text content");
    }
    const payload = JSON.parse(textContent.text);
    expect(payload).toMatchObject({
      type: "FeatureCollection",
      features: [
        expect.objectContaining({
          type: "Feature",
          geometry: expect.objectContaining({
            type: "LineString",
          }),
        }),
      ],
    });
    expect(response.structuredContent).toMatchObject(payload);
  });

  it("should return text content and structuredContent for request mode", async () => {
    const c = paris.coordinates;
    const tool = new ItineraireTool();
    const response = await tool.toolCall({
      params: {
        name: "itineraire",
        arguments: {
          start_lon: c[0],
          start_lat: c[1],
          end_lon: 2.367776,
          end_lat: 48.852891,
          profile: "pedestrian",
          result_type: "request",
        },
      },
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0]).toMatchObject({
      type: "text",
    });
    const textContent = response.content[0];
    if (textContent.type !== "text") {
      throw new Error("expected text content");
    }
    const payload = JSON.parse(textContent.text);
    expect(payload).toMatchObject({
      result_type: "request",
      method: "GET",
      url: "https://data.geopf.fr/navigation/itineraire",
      body: "",
    });
    expect(payload.query).toMatchObject({
      resource: "bdtopo-osrm",
      start: "2.333333,48.866667",
      end: "2.367776,48.852891",
      profile: "pedestrian",
      optimization: "fastest",
      waysAttributes: "name",
      geometryFormat: "geojson",
    });
    expect(payload.get_url).toContain("resource=bdtopo-osrm");
    expect(response.structuredContent).toMatchObject(payload);
  });

  it("should default OSRM constraint fields in request mode", async () => {
    const c = paris.coordinates;
    const tool = new ItineraireTool();
    const response = await tool.toolCall({
      params: {
        name: "itineraire",
        arguments: {
          start_lon: c[0],
          start_lat: c[1],
          end_lon: 2.367776,
          end_lat: 48.852891,
          profile: "car",
          result_type: "request",
          constraints: [{ value: "tunnel" }],
        },
      },
    });

    expect(response.isError).toBeUndefined();
    const textContent = response.content[0];
    if (textContent.type !== "text") {
      throw new Error("expected text content");
    }
    const payload = JSON.parse(textContent.text);
    expect(payload.query.constraints).toEqual(JSON.stringify({
      constraintType: "banned",
      key: "waytype",
      operator: "=",
      value: "tunnel",
    }));
  });

  it("should reject out-of-range coordinates at the tool boundary", async () => {
    const tool = new ItineraireTool();
    const response = await tool.toolCall({
      params: {
        name: "itineraire",
        arguments: {
          start_lon: 600,
          start_lat: 600,
          end_lon: 2.367776,
          end_lat: 48.852891,
          profile: "car",
        },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]).toMatchObject({
      type: "text",
    });
    expect(response.structuredContent).toMatchObject({
      type: "urn:geocontext:problem:invalid-tool-params",
      errors: expect.arrayContaining([
        expect.objectContaining({
          name: "start_lon",
          code: "too_big",
        }),
      ]),
    });
  });

  it("should require an explicit profile at the tool boundary", async () => {
    const c = paris.coordinates;
    const tool = new ItineraireTool();
    const response = await tool.toolCall({
      params: {
        name: "itineraire",
        arguments: {
          start_lon: c[0],
          start_lat: c[1],
          end_lon: 2.367776,
          end_lat: 48.852891,
        },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      type: "urn:geocontext:problem:invalid-tool-params",
      errors: expect.arrayContaining([
        expect.objectContaining({
          name: "profile",
          code: "invalid_type",
        }),
      ]),
    });
  });

  it("should reject invalid enum values", async () => {
    const c = paris.coordinates;
    const tool = new ItineraireTool();
    const response = await tool.toolCall({
      params: {
        name: "itineraire",
        arguments: {
          start_lon: c[0],
          start_lat: c[1],
          end_lon: 2.367776,
          end_lat: 48.852891,
          profile: "car",
          optimization: "balanced",
        },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      type: "urn:geocontext:problem:invalid-tool-params",
      errors: expect.arrayContaining([
        expect.objectContaining({
          name: "optimization",
          code: "invalid_enum_value",
        }),
      ]),
    });
  });

  it("should reject unsupported exceptional profile", async () => {
    const c = paris.coordinates;
    const tool = new ItineraireTool();
    const response = await tool.toolCall({
      params: {
        name: "itineraire",
        arguments: {
          start_lon: c[0],
          start_lat: c[1],
          end_lon: 2.367776,
          end_lat: 48.852891,
          profile: "exceptionnal",
        },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      type: "urn:geocontext:problem:invalid-tool-params",
      errors: expect.arrayContaining([
        expect.objectContaining({
          name: "profile",
          code: "invalid_enum_value",
        }),
      ]),
    });
  });

  it("should reject non-OSRM constraint values", async () => {
    const c = paris.coordinates;
    const tool = new ItineraireTool();
    const response = await tool.toolCall({
      params: {
        name: "itineraire",
        arguments: {
          start_lon: c[0],
          start_lat: c[1],
          end_lon: 2.367776,
          end_lat: 48.852891,
          profile: "car",
          constraints: [
            {
              value: "route_empierree",
            },
          ],
        },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      type: "urn:geocontext:problem:invalid-tool-params",
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_enum_value",
          detail: expect.stringContaining("autoroute"),
        }),
      ]),
    });
  });

  it("should reject upstream-only public inputs", async () => {
    const c = paris.coordinates;
    const tool = new ItineraireTool();
    const response = await tool.toolCall({
      params: {
        name: "itineraire",
        arguments: {
          start_lon: c[0],
          start_lat: c[1],
          end_lon: 2.367776,
          end_lat: 48.852891,
          profile: "car",
          crs: "EPSG:2154",
          resource: "bdtopo-pgr",
          geometryFormat: "polyline",
        },
      },
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      type: "urn:geocontext:problem:invalid-tool-params",
      errors: expect.arrayContaining([
        expect.objectContaining({
          name: "crs",
          code: "unknown_parameter",
        }),
        expect.objectContaining({
          name: "resource",
          code: "unknown_parameter",
        }),
        expect.objectContaining({
          name: "geometryFormat",
          code: "unknown_parameter",
        }),
      ]),
    });
  });
});
