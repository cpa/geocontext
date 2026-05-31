/**
 * MCP tool exposing GeoPlateforme itinerary computation.
 */

import BaseTool from "./BaseTool.js";
import { z } from "zod";

import {
  buildItineraireRequest,
  getItineraire,
  ITINERAIRE_DEFAULTS,
  ITINERAIRE_SOURCE,
  toItineraireRequestPayload,
} from "../gpf/itineraire.js";
import { generatePublishedInputSchema } from "../helpers/jsonSchema.js";
import { lonSchema, latSchema } from "../helpers/schemas.js";
import { READ_ONLY_OPEN_WORLD_TOOL_ANNOTATIONS } from "../helpers/toolAnnotations.js";
import logger from "../logger.js";

// --- Schema ---

const itinerairePointSchema = z.object({
  lon: lonSchema,
  lat: latSchema,
}).strict();

const itineraireConstraintSchema = z.object({
  constraint_type: z
    .literal("banned")
    .default("banned")
    .describe("Type de contrainte GeoPlateforme OSRM. `banned` exclut du calcul les tronçons du graphe routier qui correspondent à la condition."),
  key: z
    .literal("waytype")
    .default("waytype")
    .describe("Critère de contrainte GeoPlateforme OSRM. Seul `waytype` est exposé par `bdtopo-osrm`."),
  operator: z
    .literal("=")
    .default("=")
    .describe("Opérateur de contrainte GeoPlateforme OSRM. Seul `=` est exposé par `bdtopo-osrm`."),
  value: z
    .enum(["autoroute", "pont", "tunnel"])
    .describe("Type de tronçon à exclure du calcul OSRM."),
}).strict();

const profileDescription = [
  "Mode de déplacement utilisé pour le calcul. `bdtopo-osrm` expose `car` et `pedestrian` pour ce tool.",
  "Ce champ est obligatoire : si l'utilisateur n'a pas donné de mode, estimer la distance directe totale entre les points ; utiliser `pedestrian` si elle est inférieure à 2 km, `car` si elle est supérieure à 5 km, et demander à l'utilisateur de choisir avant d'appeler le tool entre 2 km et 5 km.",
].join(" ");

const itineraireInputSchema = z.object({
  start_lon: lonSchema.describe("Longitude du point de départ."),
  start_lat: latSchema.describe("Latitude du point de départ."),
  end_lon: lonSchema.describe("Longitude du point d'arrivée."),
  end_lat: latSchema.describe("Latitude du point d'arrivée."),
  intermediates: z
    .array(itinerairePointSchema)
    .max(15)
    .default([])
    .describe("Points intermédiaires ordonnés à emprunter par l'itinéraire, exprimés en WGS84 `lon/lat`."),
  profile: z
    .enum(["car", "pedestrian"])
    .describe(profileDescription),
  optimization: z
    .enum(["fastest", "shortest"])
    .default(ITINERAIRE_DEFAULTS.optimization)
    .describe("Mode de calcul utilisé pour déterminer l'itinéraire : `fastest` ou `shortest`."),
  get_steps: z
    .boolean()
    .default(ITINERAIRE_DEFAULTS.get_steps)
    .describe("Indique si les étapes détaillées de l'itinéraire doivent être demandées au service."),
  get_bbox: z
    .boolean()
    .default(ITINERAIRE_DEFAULTS.get_bbox)
    .describe("Indique si l'emprise de l'itinéraire doit être demandée au service."),
  distance_unit: z
    .enum(["meter", "kilometer"])
    .default(ITINERAIRE_DEFAULTS.distance_unit)
    .describe("Unité utilisée pour les distances renvoyées."),
  time_unit: z
    .enum(["hour", "minute", "second", "standard"])
    .default(ITINERAIRE_DEFAULTS.time_unit)
    .describe("Unité utilisée pour les durées renvoyées."),
  constraints: z
    .array(itineraireConstraintSchema)
    .max(3)
    .default([])
    .describe("Contraintes GeoPlateforme optionnelles appliquées au calcul. Elles permettent d'exclure certains types de tronçons routiers."),
  result_type: z
    .enum(["results", "request"])
    .default("results")
    .describe("`results` renvoie une FeatureCollection GeoJSON normalisée contenant l'itinéraire calculé. `request` renvoie la requête GeoPlateforme compilée (`get_url`) pour visualisation ou débogage."),
}).strict();

// --- Types ---

type ItineraireInput = z.infer<typeof itineraireInputSchema>;

const itineraireRequestOutputSchema = z.object({
  result_type: z.literal("request"),
  method: z.literal("GET"),
  url: z.string(),
  query: z.record(z.string()),
  body: z.literal(""),
  get_url: z.string(),
});

// --- Tool ---

class ItineraireTool extends BaseTool<ItineraireInput> {
  name = "itineraire";
  title = "Calcul d’itinéraire";
  annotations = READ_ONLY_OPEN_WORLD_TOOL_ANNOTATIONS;
  description = [
    "Calcule un itinéraire entre deux points `lon/lat` via le service de navigation de la Géoplateforme.",
    "La ressource GeoPlateforme est fixée à `bdtopo-osrm`, recommandée par la documentation GeoPF pour les calculs d'itinéraire courants.",
    "`profile` accepte `car` ou `pedestrian` ; le profil `exceptionnal` exposé par les capacités OSRM n'est pas publié par ce tool.",
    "Règle d'appel : si l'utilisateur n'a pas précisé le mode de déplacement, estimer la distance directe totale entre les points ; appeler avec `pedestrian` sous 2 km, appeler avec `car` au-dessus de 5 km, et demander le mode à l'utilisateur entre 2 km et 5 km avant d'appeler le tool.",
    "`optimization` accepte `fastest` ou `shortest`.",
    "Les contraintes exposées sont celles de `bdtopo-osrm` : exclusion (`banned`) d'un `waytype` égal à `autoroute`, `pont` ou `tunnel`.",
    "`result_type=\"request\"` renvoie une requête compacte (`get_url`) cohérente avec les tools WFS en mode request.",
    "`result_type=\"results\"` renvoie une FeatureCollection GeoJSON normalisée avec une seule feature : la géométrie calculée est placée dans `geometry` et les métadonnées du service dans `properties`.",
    "Le guidage pas-à-pas est demandé au service (`getSteps=true`, `waysAttributes=name`) et normalisé dans `properties.turnByTurn` quand GeoPlateforme renvoie des étapes.",
    "Les coordonnées d'entrée sont toujours exprimées en WGS84 (`lon/lat`) ; le service est appelé avec `crs=EPSG:4326` et `geometryFormat=geojson`.",
    "Aucun `feature_ref` n'est renvoyé : un itinéraire est une géométrie calculée à la demande, pas un objet WFS persistant.",
    `(source : ${ITINERAIRE_SOURCE}).`
  ].join("\n");

  schema = itineraireInputSchema;

  /**
   * Exposes an MCP-compatible input schema where defaulted fields remain optional.
   *
   * @returns The published input schema exposed through the MCP tool definition.
   */
  get inputSchema() {
    return generatePublishedInputSchema(itineraireInputSchema);
  }

  /**
   * Formats request previews and normalized GeoJSON results into structured MCP content.
   *
   * @param data Raw execution result returned by the tool implementation.
   * @returns MCP success response.
   */
  protected createSuccessResponse(data: unknown) {
    if (
      typeof data === "object" &&
      data !== null &&
      "result_type" in data &&
      data.result_type === "request"
    ) {
      const payload = itineraireRequestOutputSchema.parse(data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    }

    if (
      typeof data === "object" &&
      data !== null &&
      "type" in data &&
      data.type === "FeatureCollection"
    ) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
        structuredContent: data as Record<string, unknown>,
      };
    }

    throw new Error(
      "Réponse interne inattendue pour itineraire : le résultat devrait être une requête compilée ou une FeatureCollection.",
    );
  }

  /**
   * Computes an itinerary or returns the compact request payload.
   *
   * @param input Normalized tool input.
   * @returns Either a compiled request or a normalized GeoJSON FeatureCollection.
   */
  async execute(input: ItineraireInput) {
    logger.info(`[tool] execute ${this.name} ...`, {
      input: input
    });

    if (input.result_type === "request") {
      return toItineraireRequestPayload(buildItineraireRequest(input));
    }

    return getItineraire(input);
  }
}

export default ItineraireTool;
