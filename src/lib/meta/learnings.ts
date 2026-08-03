import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";

const InsightSchema = z.object({
  insights: z
    .array(
      z.object({
        title: z.string().describe("Título corto del insight, 3 a 6 palabras."),
        detail: z
          .string()
          .describe("Una oración que explica el insight y cita el número que lo respalda."),
      }),
    )
    .min(3)
    .max(5),
});

export type CampaignInsight = z.infer<typeof InsightSchema>["insights"][number];

/**
 * Feature flag de despliegue: el código de Learnings viaja con cada deploy,
 * pero se activa recién cuando LEARNINGS_ENABLED=true en el entorno — así se
 * puede mergear a production y probarlo en preview antes de encenderlo ahí.
 */
export function isLearningsEnabled(): boolean {
  return process.env.LEARNINGS_ENABLED === "true";
}

export type CampaignLearningsInput = {
  campaignName: string;
  spend: number;
  reach: number;
  impressions: number;
  purchases: number;
  metaRoas: number;
  realRoas: number | null;
  byAgeGender: { label: string; reach: number }[];
  byRegion: { label: string; reach: number }[];
};

/**
 * Insights de marketing generados por IA a partir de la demografía y
 * performance real de una campaña. Groundeado únicamente en los números que
 * se le pasan — no tiene acceso a nada más, así que no puede inventar datos
 * externos (solo interpretarlos mal, que es un riesgo distinto).
 */
export async function generateCampaignLearnings(
  input: CampaignLearningsInput,
): Promise<CampaignInsight[]> {
  const { output } = await generateText({
    model: "anthropic/claude-sonnet-5",
    output: Output.object({ schema: InsightSchema }),
    prompt: `Sos un analista de marketing digital para una marca de indumentaria de moda en Argentina que vende por Shopify y pauta en Meta Ads (Facebook/Instagram).

Te paso los datos reales de UNA campaña, últimos 7 días de gasto/alcance y 30 días de demografía:

${JSON.stringify(input, null, 2)}

"realRoas" es el retorno calculado con ventas reales de la tienda (ingreso real / gasto), a diferencia de "metaRoas" que es el que reporta la atribución propia de Meta (puede sobreestimar). Si "realRoas" es null, no hay suficientes ventas vinculadas todavía para calcularlo — no lo menciones como si fuera cero.

Escribí entre 3 y 5 insights accionables en español rioplatense, tono directo y práctico (nada de relleno genérico tipo "es importante monitorear"). Cada insight tiene que:
- Basarse ÚNICAMENTE en los números de arriba — nunca inventes datos, tendencias externas o benchmarks que no estén en el JSON.
- Nombrar un número concreto de los datos (porcentaje, segmento, monto) en el "detail".
- Si metaRoas y realRoas difieren mucho, señalalo como uno de los insights.
- Sugerir una acción concreta cuando tenga sentido (ej: reforzar un segmento, ajustar targeting, pausar y revisar creativo).`,
  });
  return output.insights;
}
