import { describe, expect, it } from "vitest";

import {
  buildItineraireRequest,
  getItineraire,
  ITINERAIRE_URL,
  normalizeItineraireResponse,
  toItineraireRequestPayload,
} from "../../src/gpf/itineraire.js";
import { paris } from "../samples";

const rawItineraireResponse = {
  resource: "bdtopo-osrm",
  resourceVersion: "2026-05-26",
  start: "2.333333,48.866667",
  end: "2.367842,48.85278",
  profile: "car",
  optimization: "fastest",
  geometry: {
    type: "LineString",
    coordinates: [
      [2.333333, 48.866667],
      [2.35, 48.86],
      [2.367842, 48.85278],
    ],
  },
  crs: "EPSG:4326",
  distanceUnit: "meter",
  timeUnit: "second",
  bbox: [2.333333, 48.85278, 2.367842, 48.866667],
  distance: 2562.9,
  duration: 581.1,
  constraints: [],
  portions: [
    {
      start: "2.333333,48.866667",
      end: "2.367842,48.85278",
      distance: 2562.9,
      duration: 581.1,
      steps: [
        {
          id: "step-1",
          attributs: [
            {
              key: "name",
              value: "Rue de Rivoli",
            },
          ],
          duration: 60,
          distance: 200,
          geometry: {
            type: "LineString",
            coordinates: [
              [2.333333, 48.866667],
              [2.335, 48.865],
            ],
          },
          instruction: {
            type: "turn",
            modifyer: "right",
          },
          alerts: [
            {
              message: "test alert",
            },
          ],
        },
      ],
    },
  ],
};

function parseQuery(url: string) {
  const parsedUrl = new URL(url);
  return Object.fromEntries(parsedUrl.searchParams.entries());
}

describe("Test GeoPlateforme itineraire service wrapper", () => {
  it("should build a request with stable OSRM defaults", () => {
    const c = paris.coordinates;
    const request = buildItineraireRequest({
      start_lon: c[0],
      start_lat: c[1],
      end_lon: 2.367776,
      end_lat: 48.852891,
    });

    expect(request).toMatchObject({
      method: "GET",
      url: ITINERAIRE_URL,
      body: "",
    });
    expect(request.query).toMatchObject({
      resource: "bdtopo-osrm",
      start: "2.333333,48.866667",
      end: "2.367776,48.852891",
      profile: "car",
      optimization: "fastest",
      getSteps: "true",
      getBbox: "true",
      waysAttributes: "name",
      distanceUnit: "meter",
      timeUnit: "second",
      crs: "EPSG:4326",
      geometryFormat: "geojson",
    });
    expect(parseQuery(request.get_url)).toMatchObject(request.query);
  });

  it("should expose a compact request payload", () => {
    const c = paris.coordinates;
    const payload = toItineraireRequestPayload(buildItineraireRequest({
      start_lon: c[0],
      start_lat: c[1],
      end_lon: 2.367776,
      end_lat: 48.852891,
      optimization: "shortest",
    }));

    expect(payload).toMatchObject({
      result_type: "request",
      method: "GET",
      url: ITINERAIRE_URL,
      body: "",
    });
    expect(payload.get_url).toContain("optimization=shortest");
  });

  it("should serialize intermediates and optional constraints for the upstream API", () => {
    const c = paris.coordinates;
    const request = buildItineraireRequest({
      start_lon: c[0],
      start_lat: c[1],
      end_lon: 2.367776,
      end_lat: 48.852891,
      intermediates: [{ lon: 2.35, lat: 48.86 }],
      constraints: [
        {
          constraint_type: "banned",
          key: "waytype",
          operator: "=",
          value: "autoroute",
        },
      ],
    });

    expect(request.query.intermediates).toEqual("2.35,48.86");
    expect(request.query.constraints).toEqual(JSON.stringify({
      constraintType: "banned",
      key: "waytype",
      operator: "=",
      value: "autoroute",
    }));
    expect(parseQuery(request.get_url)).toMatchObject({
      intermediates: request.query.intermediates,
      constraints: request.query.constraints,
    });
  });

  it("should normalize the upstream response into a single-feature FeatureCollection", async () => {
    const c = paris.coordinates;
    const requestedUrls: string[] = [];
    const result = await getItineraire({
      start_lon: c[0],
      start_lat: c[1],
      end_lon: 2.367776,
      end_lat: 48.852891,
    }, async (url) => {
      requestedUrls.push(url);
      return rawItineraireResponse;
    });

    expect(requestedUrls).toHaveLength(1);
    expect(parseQuery(requestedUrls[0])).toMatchObject({
      resource: "bdtopo-osrm",
      geometryFormat: "geojson",
    });
    expect(result).toMatchObject({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: rawItineraireResponse.geometry,
          properties: {
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
            distance: 2562.9,
            duration: 581.1,
            turnByTurn: [
              {
                portionIndex: 0,
                stepIndex: 0,
                id: "step-1",
                distance: 200,
                duration: 60,
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
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [2.333333, 48.866667],
                    [2.335, 48.865],
                  ],
                },
                alerts: [
                  {
                    message: "test alert",
                  },
                ],
              },
            ],
          },
        },
      ],
    });
  });

  it("should fill response metadata from input when upstream omits optional fields", () => {
    const c = paris.coordinates;
    const result = normalizeItineraireResponse({
      geometry: rawItineraireResponse.geometry,
    }, {
      start_lon: c[0],
      start_lat: c[1],
      end_lon: 2.367776,
      end_lat: 48.852891,
      intermediates: [{ lon: 2.35, lat: 48.86 }],
      profile: "pedestrian",
      optimization: "shortest",
      get_steps: false,
      get_bbox: false,
    });

    expect(result.features[0].properties).toMatchObject({
      resource: "bdtopo-osrm",
      start: "2.333333,48.866667",
      end: "2.367776,48.852891",
      requestedStart: "2.333333,48.866667",
      requestedEnd: "2.367776,48.852891",
      requestedIntermediates: ["2.35,48.86"],
      profile: "pedestrian",
      optimization: "shortest",
      crs: "EPSG:4326",
      distanceUnit: "meter",
      timeUnit: "second",
      getSteps: false,
      getBbox: false,
    });
  });

  it("should throw when upstream returns no geometry", () => {
    const c = paris.coordinates;
    expect(() => normalizeItineraireResponse({}, {
      start_lon: c[0],
      start_lat: c[1],
      end_lon: 2.367776,
      end_lat: 48.852891,
    })).toThrow("Le service d'itinéraire n'a renvoyé aucune géométrie.");
  });

  it("should throw when upstream geometry is not a GeoJSON LineString", () => {
    const c = paris.coordinates;
    expect(() => normalizeItineraireResponse({
      geometry: {
        type: "Polygon",
        coordinates: [],
      },
    }, {
      start_lon: c[0],
      start_lat: c[1],
      end_lon: 2.367776,
      end_lat: 48.852891,
    })).toThrow("La géométrie renvoyée par le service d'itinéraire est invalide.");
  });
});
