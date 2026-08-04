import "server-only";
import { ToolLoopAgent, Output, tool, isStepCount } from "ai";
import { z } from "zod";
import { getCustomerSegments, getRetention, getProductAffinity } from "@/lib/meta/customer-insights";

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
  /** Producto vinculado a la campaña, si tiene uno — habilita las skills de clientes. */
  productId: string | null;
};

type ProductContext = { productId: string | null };

const INSTRUCTIONS = `Sos un analista de marketing digital para una marca de indumentaria de moda en Argentina que vende por Shopify y pauta en Meta Ads (Facebook/Instagram).

Te van a pasar los datos reales de UNA campaña (últimos 7 días de gasto/alcance/ROAS, 30 días de demografía). Además tenés tres herramientas que consultan el historial real de compras del producto vinculado a esa campaña — usalas cuando te ayuden a dar un insight más concreto, no hace falta usarlas todas:
- segmentacionClientes: en qué segmento (Campeones/En riesgo/Dormidos/Nuevos) están los compradores de este producto, según su historial completo de compras.
- retencionClientes: qué porcentaje de los que compraron este producto volvió a comprar algo después.
- combosDeCompra: qué otros productos compran los mismos clientes (para sugerir bundles o cross-sell).

Si una herramienta te avisa que la campaña no tiene producto vinculado o no hay compradores todavía, no la menciones en los insights — trabajá con lo que sí tengas.

"realRoas" es el retorno calculado con ventas reales de la tienda (ingreso real / gasto), a diferencia de "metaRoas" que es el que reporta la atribución propia de Meta (puede sobreestimar). Si "realRoas" es null, no hay suficientes ventas vinculadas todavía para calcularlo — no lo menciones como si fuera cero.

Escribí entre 3 y 5 insights accionables en español rioplatense, tono directo y práctico (nada de relleno genérico tipo "es importante monitorear"). Cada insight tiene que:
- Basarse ÚNICAMENTE en los números de la campaña y en lo que devuelvan tus herramientas — nunca inventes datos, tendencias externas o benchmarks que no estén ahí.
- Nombrar un número concreto (porcentaje, segmento, monto) en el "detail".
- Si metaRoas y realRoas difieren mucho, señalalo como uno de los insights.
- Sugerir una acción concreta cuando tenga sentido (ej: reforzar el segmento Campeones, armar un combo con el producto más afín, reactivar Dormidos, ajustar targeting, pausar y revisar creativo).`;

// Las tools no dependen del producto — lo reciben vía toolsContext (fijado al
// construir el agente, la versión instalada del SDK no lo acepta por-llamada).
const learningsTools = {
  segmentacionClientes: tool({
    description:
      "Segmenta a los compradores del producto vinculado a esta campaña en Campeones/En riesgo/Dormidos/Nuevos, según todo su historial de compras.",
    inputSchema: z.object({}),
    contextSchema: z.object({ productId: z.string().nullable() }),
    execute: async (_input, { context }: { context: ProductContext }) => {
      if (!context.productId) {
        return { note: "Esta campaña no tiene un producto vinculado." };
      }
      return getCustomerSegments(context.productId);
    },
  }),
  retencionClientes: tool({
    description:
      "Calcula qué porcentaje de los compradores del producto vinculado a esta campaña volvió a comprar (cualquier producto) después.",
    inputSchema: z.object({}),
    contextSchema: z.object({ productId: z.string().nullable() }),
    execute: async (_input, { context }: { context: ProductContext }) => {
      if (!context.productId) {
        return { note: "Esta campaña no tiene un producto vinculado." };
      }
      return getRetention(context.productId);
    },
  }),
  combosDeCompra: tool({
    description:
      "Trae los productos que más compran en común los clientes que compraron el producto vinculado a esta campaña (para bundles/cross-sell).",
    inputSchema: z.object({}),
    contextSchema: z.object({ productId: z.string().nullable() }),
    execute: async (_input, { context }: { context: ProductContext }) => {
      if (!context.productId) {
        return { note: "Esta campaña no tiene un producto vinculado." };
      }
      return getProductAffinity(context.productId);
    },
  }),
};

/**
 * Insights de marketing generados por un agente de IA con acceso a datos
 * reales de la campaña y, si hay producto vinculado, a su historial de
 * compras (segmentación, retención, combos) — decide él mismo qué consultar.
 */
export async function generateCampaignLearnings(
  input: CampaignLearningsInput,
): Promise<CampaignInsight[]> {
  const { productId, ...campaignData } = input;

  const agent = new ToolLoopAgent({
    model: "anthropic/claude-sonnet-5",
    output: Output.object({ schema: InsightSchema }),
    instructions: INSTRUCTIONS,
    tools: learningsTools,
    stopWhen: isStepCount(6),
    toolsContext: {
      segmentacionClientes: { productId },
      retencionClientes: { productId },
      combosDeCompra: { productId },
    },
  });

  const { output } = await agent.generate({
    prompt: `Datos reales de esta campaña, últimos 7 días de gasto/alcance y 30 días de demografía:\n\n${JSON.stringify(campaignData, null, 2)}`,
  });
  return output.insights;
}
