// Asistente con IA (etapa 2 de Tiki). HOY NO ESTA DEPLOYADO NI CONECTADO A
// LA APP: Tiki funciona con su motor propio (js/tiki.js), sin costo por
// consulta. Antes de deployar esto: correr 015 y 016 en Supabase, cargar la
// API key, y actualizar privacidad.html#tiki (hoy promete que las
// preguntas no salen del dispositivo). Diseño y amenazas: docs/tiki.md.
//
// Seguridad, en orden de importancia:
//  - Aislamiento: todo se lee con el token del usuario que pregunta (no la
//    service role key), asi que RLS limita cada consulta a su cuenta. El
//    modelo nunca consulta la base: recibe un resumen ya calculado aca.
//  - Costo: cupo diario atomico en la base (016), y se corta si la prueba
//    gratis vencio -- las dos cosas ANTES de llamar a la API.
//  - Prompt injection: las reglas van solas en el system prompt; los datos
//    (que escribe el usuario o vienen de un Excel) van aparte, limpios y
//    marcados como datos (prompt.ts). El modelo no tiene herramientas: no
//    puede leer ni escribir nada mas, diga lo que diga el texto.
//  - Errores: el usuario ve siempre un mensaje generico; el detalle queda
//    solo en los logs de la funcion, sin el contenido de la charla.
//
// Deploy: supabase functions deploy ai-agent
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   opcionales: TIKI_MODEL (default claude-haiku-4-5), TIKI_ALLOWED_ORIGINS
//   (lista separada por comas, ej. https://valll444.github.io; default *).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { armarBloqueDatos, armarMensajes, type ContextoNegocio, sanearHistorial, SYSTEM_PROMPT, textoDeRespuesta } from "./prompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// El modelo que ya habia elegido el proyecto (el mas barato). Se puede
// cambiar sin tocar codigo con el secret TIKI_MODEL.
const MODEL = Deno.env.get("TIKI_MODEL") ?? "claude-haiku-4-5";
const LIMITE_DIARIO = 20;
const DIAS_PRUEBA = 14;
const MAX_PREGUNTA = 1000;
const ORIGENES = (Deno.env.get("TIKI_ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
  timeout: 25_000, // ms: el comerciante esta atendiendo, no puede esperar minutos
  maxRetries: 1,
});

function cabeceras(req: Request): Record<string, string> {
  const origen = req.headers.get("Origin") ?? "";
  const permitido = ORIGENES.includes("*") ? "*" : ORIGENES.includes(origen) ? origen : ORIGENES[0] ?? "null";
  return {
    "Access-Control-Allow-Origin": permitido,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function hoyArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}
function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Pagina hasta una pagina vacia: Supabase corta cada respuesta en "Max rows".
async function todas<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const filas: T[] = [];
  for (let pagina = 0; pagina < 50; pagina++) {
    const { data, error } = await pedir(filas.length, filas.length + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    filas.push(...data);
  }
  return filas;
}

interface Movimiento { tipo: string; monto: number | null; descripcion: string | null; costo_total: number | null; fecha: string }

async function armarContexto(db: SupabaseClient, userId: string): Promise<ContextoNegocio> {
  const hoy = hoyArgentina();
  const desde7 = sumarDias(hoy, -6);
  const desde30 = sumarDias(hoy, -29);

  const [{ data: perfil }, movs, pedidosRes, provRes, cierreRes, memoriaRes] = await Promise.all([
    db.from("profiles").select("business_name").eq("id", userId).maybeSingle(),
    todas<Movimiento>((a, b) => db.from("movements").select("tipo, monto, descripcion, costo_total, fecha").eq("user_id", userId).gte("fecha", desde30).lte("fecha", hoy).order("created_at").range(a, b)),
    db.from("pedidos_proveedor").select("proveedor_id, monto").eq("user_id", userId).eq("pagado", false),
    db.from("proveedores").select("id, nombre").eq("user_id", userId),
    db.from("cierres_caja").select("fecha, diferencia").eq("user_id", userId).order("fecha", { ascending: false }).limit(1),
    db.from("tiki_memoria").select("clave, valor").eq("user_id", userId),
  ]);

  const num = (v: unknown) => Number(v) || 0;
  const ventas = movs.filter((m) => m.tipo === "Venta");
  const gastos = movs.filter((m) => m.tipo === "Gasto");
  const suma = (arr: Movimiento[], f: (m: Movimiento) => number) => arr.reduce((s, m) => s + f(m), 0);
  const ventas30 = suma(ventas, (m) => num(m.monto));
  const costo30 = suma(ventas, (m) => num(m.costo_total));
  const gastos30 = suma(gastos, (m) => num(m.monto));

  const porProducto = new Map<string, number>();
  for (const v of ventas) {
    const k = (v.descripcion || "").trim();
    if (k) porProducto.set(k, (porProducto.get(k) || 0) + num(v.monto));
  }

  const nombres = new Map((provRes.data || []).map((p: { id: number; nombre: string }) => [String(p.id), p.nombre]));
  const deudaPorProv = new Map<string, number>();
  for (const p of (pedidosRes.data || []) as { proveedor_id: number; monto: number }[]) {
    const k = String(p.proveedor_id);
    deudaPorProv.set(k, (deudaPorProv.get(k) || 0) + num(p.monto));
  }

  const memoria: ContextoNegocio["memoria"] = {};
  // Si la tabla no existe todavia (falta 015), memoriaRes trae error: sin memoria.
  for (const r of (memoriaRes.data || []) as { clave: string; valor: Record<string, unknown> }[]) {
    if (r.clave === "horario_cierre" || r.clave === "dias_cerrado" || r.clave === "meta_venta_diaria") {
      (memoria as Record<string, unknown>)[r.clave] = r.valor;
    }
  }

  const ultimo = (cierreRes.data || [])[0] as { fecha: string; diferencia: number } | undefined;
  return {
    hoy,
    nombre: (perfil && perfil.business_name) || "",
    ventasHoy: { monto: suma(ventas.filter((m) => m.fecha === hoy), (m) => num(m.monto)), cantidad: ventas.filter((m) => m.fecha === hoy).length },
    ultimos7: { ventas: suma(ventas.filter((m) => m.fecha >= desde7), (m) => num(m.monto)), gastos: suma(gastos.filter((m) => m.fecha >= desde7), (m) => num(m.monto)) },
    ultimos30: { ventas: ventas30, costo: costo30, gastos: gastos30, ganancia: ventas30 - costo30 - gastos30, ventasSinCosto: ventas.filter((m) => !(num(m.costo_total) > 0)).length, cantidadVentas: ventas.length },
    topProductos: [...porProducto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n),
    deudas: [...deudaPorProv.entries()].filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]).map(([id, monto]) => ({ nombre: nombres.get(id) || "Proveedor sin nombre", monto })),
    ultimoCierre: ultimo ? { fecha: ultimo.fecha, diferencia: num(ultimo.diferencia) } : null,
    memoria,
  };
}

Deno.serve(async (req) => {
  const h = cabeceras(req);
  const responder = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: h });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return responder({ error: "Método no permitido." }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return responder({ error: "Falta el token de sesión." }, 401);
    const { data: userData, error: userErr } = await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(token);
    if (userErr || !userData?.user) return responder({ error: "Sesión inválida." }, 401);
    const userId = userData.user.id;

    let body: unknown;
    try { body = await req.json(); } catch { return responder({ error: "Pedido inválido." }, 400); }
    const mensaje = typeof (body as { mensaje?: unknown })?.mensaje === "string" ? (body as { mensaje: string }).mensaje.trim() : "";
    if (!mensaje) return responder({ error: "Escribí una consulta." }, 400);
    if (mensaje.length > MAX_PREGUNTA) return responder({ error: "La consulta es demasiado larga." }, 400);

    // Cliente que actua COMO el usuario (su token): RLS limita todo a su cuenta.
    const db = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });

    // 1. Prueba gratis vencida = no se gasta la API (mismo criterio que app.js).
    const { data: perfil } = await db.from("profiles").select("plan, trial_started_at").eq("id", userId).maybeSingle();
    const plan = perfil?.plan || "trial";
    if (plan !== "pago" && plan !== "cortesia") {
      const inicio = perfil?.trial_started_at ? new Date(perfil.trial_started_at).getTime() : Date.now();
      if (Math.floor((Date.now() - inicio) / 86_400_000) >= DIAS_PRUEBA) return responder({ error: "Tu prueba gratis terminó." }, 403);
    }

    // 2. Cupo diario atomico (016). Si la funcion no esta, se niega: falla cerrada.
    const { data: quedan, error: cupoErr } = await db.rpc("tiki_consumir_consulta", { limite: LIMITE_DIARIO });
    if (cupoErr) {
      console.error("cupo no disponible:", cupoErr.code, cupoErr.message);
      return responder({ error: "El asistente no está disponible ahora." }, 503);
    }
    if (typeof quedan !== "number" || quedan < 0) {
      return responder({ error: `Llegaste al límite de ${LIMITE_DIARIO} consultas de hoy. Probá de nuevo mañana.` }, 429);
    }

    // 3. Contexto minimo e historial corto.
    const [contexto, historialRes] = await Promise.all([
      armarContexto(db, userId),
      db.from("agent_messages").select("role, content").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    ]);
    const historial = sanearHistorial((historialRes.data || []).reverse());
    const messages = armarMensajes(historial, armarBloqueDatos(contexto), mensaje);

    // 4. Modelo, sin herramientas: solo puede contestar texto.
    let respuesta: string | null;
    try {
      const r = await anthropic.messages.create({ model: MODEL, max_tokens: 1024, system: SYSTEM_PROMPT, messages });
      respuesta = textoDeRespuesta(r);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        console.error("anthropic: rate limit");
        return responder({ error: "El asistente está con mucha demanda. Probá en un rato." }, 503);
      } else if (err instanceof Anthropic.AuthenticationError) {
        console.error("anthropic: API key invalida o sin cargar");
      } else if (err instanceof Anthropic.APIConnectionError) {
        console.error("anthropic: sin conexion o timeout");
      } else if (err instanceof Anthropic.APIError) {
        console.error("anthropic:", err.status, err.type);
      } else {
        console.error("anthropic: error inesperado", err instanceof Error ? err.name : typeof err);
      }
      return responder({ error: "El asistente no está disponible ahora. Probá de nuevo en un rato." }, 502);
    }
    if (!respuesta) return responder({ error: "No pude responder eso. Probá preguntarlo de otra forma." }, 502);

    const { error: guardarErr } = await db.from("agent_messages").insert([
      { user_id: userId, role: "user", content: mensaje.slice(0, 4000) },
      { user_id: userId, role: "assistant", content: respuesta.slice(0, 4000) },
    ]);
    if (guardarErr) console.error("no se guardo el historial:", guardarErr.code);

    return responder({ respuesta, consultasRestantes: quedan }, 200);
  } catch (err) {
    console.error("ai-agent: error inesperado", err instanceof Error ? err.name : typeof err);
    return responder({ error: "Ocurrió un error inesperado." }, 500);
  }
});
