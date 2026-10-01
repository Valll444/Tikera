// Pide el CAE a ARCA para una venta puntual. Se dispara con el botón
// "Facturar" del ticket -- nunca automático al guardar la venta (así un
// corte de ARCA nunca traba una venta real).
//
// Mismo motivo de service role que arca-config (ver ese archivo): el
// certificado/clave privada y el resultado fiscal no pueden depender de un
// grant que el navegador también tendría. user_id sale siempre del token
// verificado, nunca del body.
//
// Deploy: ver supabase/functions/README.md.

import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret, loginWSAA, feCompUltimoAutorizado, feCAESolicitar } from "../_shared/arca.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!token) return json({ error: "Falta el token de sesión." }, 401);

    const authClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Sesión inválida." }, 401);
    const userId = userData.user.id;

    const movementId = Number((await req.json()).movement_id);
    if (!Number.isInteger(movementId)) return json({ error: "Falta la venta a facturar." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Idempotencia: si ya está emitida (reintento, doble click, dos
    // pestañas), devolver lo que ya hay en vez de pedirle otro CAE a ARCA.
    const { data: existente } = await admin
      .from("facturas").select("*").eq("movement_id", movementId).eq("user_id", userId).maybeSingle();
    if (existente?.estado === "emitida") return json({ ok: true, factura: toClientShape(existente) }, 200);

    // Revalida ownership y que sea una Venta -- nada mas lo garantiza una
    // vez que estamos con service role (RLS no corre para este cliente).
    const { data: movement, error: movErr } = await admin
      .from("movements").select("id, user_id, tipo, monto, fecha").eq("id", movementId).maybeSingle();
    if (movErr || !movement || movement.user_id !== userId) return json({ error: "Venta no encontrada." }, 404);
    if (movement.tipo !== "Venta") return json({ error: "Solo se pueden facturar ventas." }, 400);

    const { data: config } = await admin
      .from("facturacion_config")
      .select("cuit, punto_venta, tipo_comprobante_default, ambiente, activado, certificado_enc, clave_privada_enc, wsaa_token, wsaa_sign, wsaa_expira")
      .eq("user_id", userId).maybeSingle();
    if (!config || !config.activado) {
      return json({ error: "Todavía no activaste la facturación electrónica en Ajustes." }, 400);
    }

    const ambiente = config.ambiente as "homologacion" | "produccion";
    const tipoComprobante = config.tipo_comprobante_default as "A" | "B" | "C";

    // El ticket de WSAA dura ~12hs y ARCA rechaza un login nuevo si ya hay
    // uno vigente -- reusar si todavia no vencio, relogear solo si hace falta.
    let auth = { token: config.wsaa_token, sign: config.wsaa_sign };
    const vencido = !config.wsaa_expira || new Date(config.wsaa_expira).getTime() < Date.now() + 60_000;
    if (!auth.token || !auth.sign || vencido) {
      const certPem = await decryptSecret(config.certificado_enc);
      const clavePem = await decryptSecret(config.clave_privada_enc);
      const ticket = await loginWSAA(certPem, clavePem, ambiente);
      auth = { token: ticket.token, sign: ticket.sign };
      await admin.from("facturacion_config").update({
        wsaa_token: ticket.token, wsaa_sign: ticket.sign, wsaa_expira: ticket.expirationTime,
      }).eq("user_id", userId);
    }

    // Nunca cachear localmente "el proximo numero" -- ARCA es la unica
    // fuente de verdad, pedirselo fresco justo antes de facturar.
    const ultimo = await feCompUltimoAutorizado(ambiente, auth as any, config.cuit, config.punto_venta, tipoComprobante);
    const numero = ultimo + 1;
    const fechaArca = movement.fecha.replace(/-/g, "");

    const filaBase = {
      user_id: userId, movement_id: movementId, tipo_comprobante: tipoComprobante,
      punto_venta: config.punto_venta, ambiente, monto: movement.monto, numero,
      updated_at: new Date().toISOString(),
    };

    try {
      const resultado = await feCAESolicitar(ambiente, auth as any, config.cuit, config.punto_venta, tipoComprobante, numero, Number(movement.monto), fechaArca);
      const { data: guardada, error: upErr } = await admin.from("facturas")
        .upsert({
          ...filaBase, cae: resultado.cae, cae_vencimiento: formatFecha(resultado.caeVencimiento),
          estado: "emitida", fecha_emision: new Date().toISOString(), error_mensaje: null,
        }, { onConflict: "movement_id" })
        .select().single();
      if (upErr) throw upErr;
      return json({ ok: true, factura: toClientShape(guardada) }, 200);
    } catch (arcaErr) {
      const mensaje = (arcaErr as Error).message || "Error desconocido al pedir el CAE.";
      await admin.from("facturas").upsert({ ...filaBase, estado: "error", error_mensaje: mensaje }, { onConflict: "movement_id" });
      return json({ ok: false, error: mensaje }, 502);
    }
  } catch (err) {
    console.error("arca-facturar error:", String(err));
    return json({ error: "Ocurrió un error inesperado." }, 500);
  }
});

function formatFecha(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function toClientShape(f: any) {
  return {
    numero: f.numero, puntoVenta: f.punto_venta, tipoComprobante: f.tipo_comprobante,
    cae: f.cae, caeVencimiento: f.cae_vencimiento, fechaEmision: f.fecha_emision,
    estado: f.estado, ambiente: f.ambiente, errorMensaje: f.error_mensaje, monto: f.monto,
  };
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
