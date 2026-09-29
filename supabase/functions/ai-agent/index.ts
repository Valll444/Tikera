// Asistente de IA para kiosqueros: responde dudas de plata/negocio usando
// el contexto real del usuario (nombre del negocio, ventas/gastos
// recientes, productos que mas venden) mas el historial de la conversacion
// actual, asi no hay que repetirle todo cada vez que se le pregunta algo.
//
// La API key de Anthropic nunca puede viajar al navegador -- por eso esto
// corre aca, como Edge Function, y no directo desde app.html. A diferencia
// de delete-account, esta funcion NO usa la service role key: todas las
// lecturas/escrituras se hacen con un cliente autenticado como el usuario
// que pregunta (su propio token), asi que quedan sujetas a las mismas
// reglas de RLS que ya protegen sus datos en el resto de la app -- no hace
// falta (ni conviene) una llave que se salte esos permisos.
//
// Deploy: ver supabase/functions/README.md. Ademas de SUPABASE_URL y
// SUPABASE_ANON_KEY (que Supabase ya inyecta solo), esta funcion necesita
// el secret ANTHROPIC_API_KEY:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-haiku-4-5-20251001";
const LIMITE_DIARIO = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return json({ error: "Falta el token de sesión." }, 401);
    }

    const authClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "Sesión inválida." }, 401);
    }
    const userId = userData.user.id;

    const { mensaje } = await req.json();
    if (!mensaje || typeof mensaje !== "string" || !mensaje.trim()) {
      return json({ error: "Escribí una consulta." }, 400);
    }
    if (mensaje.length > 2000) {
      return json({ error: "La consulta es demasiado larga." }, 400);
    }

    // Cliente que actua COMO el usuario ya verificado arriba (con su propio
    // token), no un cliente admin -- RLS filtra solo a auth.uid() de todos
    // modos, esto es nada mas para no tener que repetir .eq('user_id', ...)
    // en cada consulta.
    const db = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const hoyDesde = new Date();
    hoyDesde.setHours(0, 0, 0, 0);
    const { count: consultasHoy } = await db
      .from("agent_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", hoyDesde.toISOString());
    if ((consultasHoy || 0) >= LIMITE_DIARIO) {
      return json({ error: `Llegaste al límite de ${LIMITE_DIARIO} consultas de hoy. Probá de nuevo mañana.` }, 429);
    }

    const contexto = await armarContexto(db, userId);

    const { data: historialRows } = await db
      .from("agent_messages")
      .select("role, content")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    const historial = (historialRows || []).reverse();

    const systemPrompt = `Sos el asistente de Tikera, una app de caja para kioscos y comercios chicos en Argentina. Ayudás al dueño del negocio con dudas sobre sus propios números (ventas, gastos, ganancia, stock) y con preguntas generales de plata/gestión de un comercio chico (precios, márgenes, inflación, proveedores).

Reglas:
- Respondé corto y en criollo/argentino, como si le hablaras a un kiosquero, no a un contador.
- Usá el contexto del negocio de abajo cuando sea relevante, no inventes números que no te dieron.
- Si preguntan algo de finanzas personales, inversiones, o decisiones legales/impositivas grandes, respondé con lo que sepas pero aclará en una línea que no reemplaza a un contador o asesor, y que para eso conviene consultar uno de verdad.
- Nunca dés recomendaciones de inversión (acciones, cripto, etc.).

Contexto del negocio:
${contexto}`;

    const messages = [
      ...historial.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
      { role: "user", content: mensaje.trim() },
    ];

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: systemPrompt,
        messages,
      }),
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      console.error("Anthropic error:", aiRes.status, errBody);
      return json({ error: "El asistente no está disponible ahora. Probá de nuevo en un rato." }, 502);
    }

    const aiData = await aiRes.json();
    const respuesta = (aiData.content || []).map((b: { text?: string }) => b.text || "").join("").trim();
    if (!respuesta) {
      return json({ error: "El asistente no pudo responder. Probá de nuevo." }, 502);
    }

    await db.from("agent_messages").insert([
      { user_id: userId, role: "user", content: mensaje.trim() },
      { user_id: userId, role: "assistant", content: respuesta },
    ]);

    return json({ respuesta }, 200);
  } catch (err) {
    console.error(err);
    return json({ error: "Ocurrió un error inesperado." }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Junta un resumen corto del negocio (nombre, ventas/gastos de los ultimos
// 30 dias, productos que mas venden) para que el agente responda con datos
// reales del usuario sin que la app tenga que mandarle todo el historial.
async function armarContexto(db: any, userId: string): Promise<string> {
  const partes: string[] = [];

  const { data: profile } = await db
    .from("profiles")
    .select("business_name")
    .eq("id", userId)
    .single();
  partes.push(`Nombre del negocio: ${(profile && profile.business_name) || "sin definir"}`);

  const desde30 = new Date();
  desde30.setDate(desde30.getDate() - 30);
  const { data: movs } = await db
    .from("movements")
    .select("tipo, monto, descripcion, costo_total")
    .eq("user_id", userId)
    .gte("created_at", desde30.toISOString());

  if (movs && movs.length > 0) {
    const ventas = movs.filter((m: any) => m.tipo === "Venta").reduce((s: number, m: any) => s + Number(m.monto || 0), 0);
    const gastos = movs.filter((m: any) => m.tipo === "Gasto").reduce((s: number, m: any) => s + Number(m.monto || 0), 0);
    const costoMerc = movs.filter((m: any) => m.tipo === "Venta").reduce((s: number, m: any) => s + Number(m.costo_total || 0), 0);
    const ganancia = ventas - costoMerc - gastos;
    partes.push(`Últimos 30 días: ventas $${ventas.toFixed(0)}, gastos $${gastos.toFixed(0)}, ganancia real $${ganancia.toFixed(0)}.`);

    const porProducto: Record<string, number> = {};
    movs.filter((m: any) => m.tipo === "Venta").forEach((m: any) => {
      const key = (m.descripcion || "").trim();
      if (!key) return;
      porProducto[key] = (porProducto[key] || 0) + Number(m.monto || 0);
    });
    const top = Object.entries(porProducto).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5);
    if (top.length > 0) {
      partes.push(`Productos que más facturan: ${top.map(([nombre]) => nombre).join(", ")}.`);
    }
  } else {
    partes.push("Todavía no tiene movimientos cargados en los últimos 30 días.");
  }

  const { count: proveedoresCount } = await db
    .from("proveedores")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (proveedoresCount) partes.push(`Tiene ${proveedoresCount} proveedor(es) anotado(s).`);

  return partes.join("\n");
}
