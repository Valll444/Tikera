// Borra la cuenta del usuario que hace el pedido: sus fotos en Storage, y el
// usuario de auth.users (que en cascada se lleva profiles/movements/products,
// porque esas tablas tienen "on delete cascade" contra auth.users).
//
// Necesita la service role key, que nunca puede viajar al navegador -- por
// eso esto corre acá, como Edge Function, y no directo desde app.html.
//
// Deploy: ver supabase/functions/README.md

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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
      return new Response(JSON.stringify({ error: "Falta el token de sesión." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cliente "anon" solo para confirmar de quién es el token -- así nadie
    // puede pedir borrar una cuenta que no es la suya mandando otro id.
    const authClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Sesión inválida." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // Cliente admin (service role) para las operaciones que de verdad borran datos.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Borrar las fotos subidas (avatar + productos) antes que el usuario:
    // Storage no se limpia solo con el "on delete cascade" de las tablas.
    const { data: files } = await adminClient.storage.from("uploads").list(userId, {
      limit: 1000,
    });
    if (files && files.length > 0) {
      await deleteAllRecursive(adminClient, userId, files);
    }

    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteErr) {
      return new Response(JSON.stringify({ error: deleteErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// El bucket "uploads" guarda archivos bajo carpetas (ej. profile/, products/),
// así que hay que bajar un nivel para juntar las rutas completas a borrar.
async function deleteAllRecursive(adminClient: any, prefix: string, entries: any[]) {
  const paths: string[] = [];
  for (const entry of entries) {
    const fullPath = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      // Es una carpeta: listar adentro.
      const { data: sub } = await adminClient.storage.from("uploads").list(fullPath, { limit: 1000 });
      if (sub && sub.length > 0) {
        await deleteAllRecursive(adminClient, fullPath, sub);
      }
    } else {
      paths.push(fullPath);
    }
  }
  if (paths.length > 0) {
    await adminClient.storage.from("uploads").remove(paths);
  }
}
