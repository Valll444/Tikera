// Guarda la configuracion de facturacion electronica de un negocio (CUIT,
// punto de venta, certificado) y prueba la conexion contra ARCA.
//
// Usa service role para leer/escribir facturacion_config -- a proposito, no
// es el patron de ai-agent (cliente autenticado como el usuario). RLS no
// alcanza aca: un cliente anon-key+token-del-usuario es indistinguible a
// nivel de Postgres del navegador mismo, y el certificado/clave privada no
// pueden tener NINGUN grant hacia "authenticated" (ver 013_facturacion_arca.sql).
// Solo service role puede separar "esto lo escribe la funcion" de "esto lo
// escribe el usuario directo". Por eso mismo, el user_id SIEMPRE sale del
// token verificado, nunca del body -- es la unica barrera que evita que
// cualquier cuenta pueda escribir la config de otra.
//
// Deploy: ver supabase/functions/README.md. Necesita el secret
// ARCA_CERT_ENC_KEY ademas de SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptSecret, decryptSecret, validarCuit, esFormatoPkcs8, loginWSAA, ARCA_ENDPOINTS } from "../_shared/arca.ts";

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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json();

    if (body.accion === "guardar") return await guardar(admin, userId, body);
    if (body.accion === "probar_conexion") return await probarConexion(admin, userId);
    return json({ error: "Acción inválida." }, 400);
  } catch (err) {
    console.error("arca-config error:", String(err));
    return json({ error: "Ocurrió un error inesperado." }, 500);
  }
});

async function guardar(admin: any, userId: string, body: any) {
  const cuit = String(body.cuit || "").replace(/\D/g, "");
  if (!validarCuit(cuit)) return json({ error: "El CUIT no es válido." }, 400);

  const puntoVenta = parseInt(body.punto_venta, 10);
  if (!Number.isInteger(puntoVenta) || puntoVenta <= 0) {
    return json({ error: "El punto de venta tiene que ser un número positivo." }, 400);
  }

  // V1 solo implementa Factura C (ver 013_facturacion_arca.sql y el plan) --
  // A/B quedan reservados en el modelo pero el backend los rechaza por ahora
  // para no guardar una config que arca-facturar no puede cumplir.
  const tipoComprobanteDefault = String(body.tipo_comprobante_default || "C");
  if (tipoComprobanteDefault !== "C") {
    return json({ error: "Por ahora Tikera solo emite Factura C. Factura A/B están en camino." }, 400);
  }

  const ambiente = body.ambiente === "produccion" ? "produccion" : "homologacion";
  const razonSocial = body.razon_social ? String(body.razon_social).trim().slice(0, 200) : null;

  const update: Record<string, unknown> = {
    user_id: userId,
    cuit,
    razon_social: razonSocial,
    punto_venta: puntoVenta,
    tipo_comprobante_default: tipoComprobanteDefault,
    ambiente,
    updated_at: new Date().toISOString(),
  };

  // Cert/clave son opcionales en este call: vacios = no tocar lo ya guardado
  // (asi se puede editar razon social/punto de venta sin resubir el certificado).
  if (body.certificado_pem) {
    update.certificado_enc = await encryptSecret(String(body.certificado_pem));
  }
  if (body.clave_privada_pem) {
    if (!esFormatoPkcs8(String(body.clave_privada_pem))) {
      return json({
        error: "La clave privada tiene que estar en formato PKCS#8. Convertila con: openssl pkcs8 -topk8 -nocrypt -in clave.key -out clave_pkcs8.key",
      }, 400);
    }
    update.clave_privada_enc = await encryptSecret(String(body.clave_privada_pem));
    // Cambio de certificado/clave invalida cualquier ticket WSAA cacheado y
    // el estado de "verificado" anterior -- hay que probar conexion de nuevo.
    update.wsaa_token = null;
    update.wsaa_sign = null;
    update.wsaa_expira = null;
    update.activado = false;
    update.verificado_at = null;
  }

  const { error } = await admin.from("facturacion_config").upsert(update, { onConflict: "user_id" });
  if (error) {
    console.error("guardar facturacion_config:", error.message);
    return json({ error: "No se pudo guardar la configuración." }, 500);
  }
  return json({ ok: true }, 200);
}

async function probarConexion(admin: any, userId: string) {
  const { data: config, error } = await admin
    .from("facturacion_config")
    .select("cuit, punto_venta, ambiente, certificado_enc, clave_privada_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !config) return json({ error: "Todavía no guardaste una configuración." }, 400);
  if (!config.certificado_enc || !config.clave_privada_enc) {
    return json({ error: "Subí el certificado y la clave privada antes de probar la conexión." }, 400);
  }

  try {
    const certPem = await decryptSecret(config.certificado_enc);
    const clavePem = await decryptSecret(config.clave_privada_enc);
    const ambiente = (config.ambiente as "homologacion" | "produccion") || "homologacion";
    const ticket = await loginWSAA(certPem, clavePem, ambiente);

    await admin.from("facturacion_config").update({
      wsaa_token: ticket.token,
      wsaa_sign: ticket.sign,
      wsaa_expira: ticket.expirationTime,
      activado: true,
      verificado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);

    return json({ ok: true, ambiente, endpoint: ARCA_ENDPOINTS[ambiente].wsfe }, 200);
  } catch (err) {
    console.error("probar_conexion:", String(err));
    return json({ ok: false, error: `No se pudo conectar con ARCA: ${(err as Error).message}` }, 502);
  }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
