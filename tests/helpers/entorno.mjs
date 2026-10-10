// Corre js/app.js + js/indicadores.js + js/ajuste-precios.js + js/stock.js + js/equipos.js + js/tiki.js dentro de Node (vm), sin navegador:
//  - DOM simulado (cualquier elemento existe y acepta cualquier cosa),
//  - reloj fijo (Date.now() = la fecha/hora que pide cada test),
//  - Supabase falso en memoria que aplica lo mismo que RLS (cada cuenta ve
//    y escribe solo lo suyo) y corta cada respuesta en 1000 filas como el
//    "Max rows" por default de Supabase.
// Asi se prueban de verdad loadData, la cola offline y Tiki sin red.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const DOLAR = [
  { casa: 'oficial', nombre: 'Oficial', compra: 980, venta: 1000, fechaActualizacion: '2026-10-04T12:00:00Z' },
  { casa: 'blue', nombre: 'Blue', compra: 1180, venta: 1200, fechaActualizacion: '2026-10-04T12:00:00Z' },
  { casa: 'mayorista', nombre: 'Mayorista', compra: 975, venta: 985, fechaActualizacion: '2026-10-04T12:00:00Z' },
  { casa: 'tarjeta', nombre: 'Tarjeta', compra: 0, venta: 1600, fechaActualizacion: '2026-10-04T12:00:00Z' }
];
const INFLACION = [
  { fecha: '2026-08-01', valor: 2.1 },
  { fecha: '2026-09-01', valor: 1.8 }
];
const RIESGO = [
  { fecha: '2026-09-30', valor: 620 },
  { fecha: '2026-10-03', valor: 598 }
];
const PLAZO = [
  { entidad: 'Banco A', tnaClientes: 0.36 },
  { entidad: 'Banco B', tnaClientes: 0.30 },
  { entidad: 'Banco C', tnaClientes: 0.42 }
];
const FERIADOS = [
  { fecha: '2026-10-12', tipo: 'trasladable', nombre: 'Día del Respeto a la Diversidad Cultural' },
  { fecha: '2026-11-23', tipo: 'trasladable', nombre: 'Día de la Soberanía Nacional' },
  { fecha: '2026-12-08', tipo: 'inamovible', nombre: 'Inmaculada Concepción de María' },
  { fecha: '2026-12-25', tipo: 'inamovible', nombre: 'Navidad' }
];

// Cualquier propiedad devuelve otro stub, cualquier llamada devuelve un
// stub, y lo que se asigna se puede volver a leer (innerHTML, value...).
function stub(){
  const props = new Map();
  return new Proxy(function(){}, {
    get(_, p){
      if(p === Symbol.toPrimitive) return () => '';
      if(p === Symbol.iterator) return function*(){};
      if(typeof p === 'symbol' || p === 'then') return undefined;
      if(p === 'length') return 0;
      if(props.has(p)) return props.get(p);
      // Los campos de texto arrancan vacios, como en un input real.
      if(['value', 'innerHTML', 'textContent', 'innerText', 'className'].includes(p)) return '';
      const v = stub();
      props.set(p, v);
      return v;
    },
    set(_, p, v){ props.set(p, v); return true; },
    apply(){ return stub(); },
    construct(){ return stub(); }
  });
}

function almacenamiento(){
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    get length(){ return m.size; }
  };
}

const TABLAS = ['profiles', 'movements', 'products', 'frequent_items', 'proveedores', 'pedidos_proveedor', 'cierres_caja', 'facturacion_config', 'facturas', 'tiki_memoria', 'agent_messages'];

function crearSupabaseFalso(){
  const db = Object.fromEntries(TABLAS.map(t => [t, []]));
  const estado = {
    usuario: null,
    maxRows: 1000,
    fallar: {},        // tabla -> 'throw' | 'mensaje de error'  (o 'tabla:op')
    llamadas: [],      // { tabla, op, filtros }
    antes: null        // hook opcional (tabla, op) => void, corre antes de cada operacion
  };
  let siguienteId = 900000;
  const dueno = (tabla, fila) => (tabla === 'profiles' ? fila.id : fila.user_id);
  const copia = (x) => JSON.parse(JSON.stringify(x));

  class Consulta {
    constructor(tabla){ Object.assign(this, { tabla, op: 'select', filtros: [], ordenes: [], rango: null, opts: {}, unico: null, devolver: false }); }
    select(_cols, opts){ if(this.op === 'select') this.opts = opts || {}; this.devolver = true; return this; }
    eq(c, v){ this.filtros.push(f => String(f[c]) === String(v)); return this; }
    neq(c, v){ this.filtros.push(f => String(f[c]) !== String(v)); return this; }
    in(c, vs){ const s = vs.map(String); this.filtros.push(f => s.includes(String(f[c]))); return this; }
    gte(c, v){ this.filtros.push(f => f[c] >= v); return this; }
    lte(c, v){ this.filtros.push(f => f[c] <= v); return this; }
    order(c, o = {}){ this.ordenes.push([c, o.ascending !== false]); return this; }
    range(a, b){ this.rango = [a, b]; return this; }
    limit(n){ this.rango = [0, n - 1]; return this; }
    single(){ this.unico = 'single'; return this; }
    maybeSingle(){ this.unico = 'maybe'; return this; }
    insert(filas){ this.op = 'insert'; this.filas = [].concat(filas); return this; }
    upsert(filas, opts){ this.op = 'upsert'; this.filas = [].concat(filas); this.conflicto = ((opts && opts.onConflict) || 'id').split(','); return this; }
    update(campos){ this.op = 'update'; this.campos = campos; return this; }
    delete(){ this.op = 'delete'; return this; }
    then(res, rej){ return Promise.resolve().then(() => this.ejecutar()).then(res, rej); }
    ejecutar(){
      const { tabla, op } = this;
      estado.llamadas.push({ tabla, op });
      if(estado.antes) estado.antes(tabla, op);
      const falla = estado.fallar[`${tabla}:${op}`] || estado.fallar[tabla];
      if(falla === 'throw') throw new TypeError('Failed to fetch');
      if(falla) return { data: null, error: { message: falla }, count: null };
      const uid = estado.usuario && estado.usuario.id;
      const filas = db[tabla];
      if(!filas) return { data: null, error: { message: `relation "${tabla}" does not exist` } };
      const visibles = () => filas.filter(f => uid && dueno(tabla, f) === uid).filter(f => this.filtros.every(fn => fn(f)));
      const rls = { data: null, error: { message: 'new row violates row-level security policy' } };
      const salida = (data, count) => {
        if(this.unico === 'single'){
          if(data.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
          return { data: data[0], error: null };
        }
        if(this.unico === 'maybe') return { data: data[0] || null, error: null };
        return { data: this.devolver || op === 'select' ? data : null, error: null, count: count ?? null };
      };
      if(op === 'select'){
        let res = visibles();
        for(const [c, asc] of [...this.ordenes].reverse()){
          res = [...res].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
        }
        const total = res.length;
        const [desde, hasta] = this.rango || [0, Infinity];
        res = res.slice(desde, Math.min(hasta + 1, desde + estado.maxRows));
        return salida(copia(res), this.opts.count ? total : null);
      }
      if(op === 'insert' || op === 'upsert'){
        if(!uid || this.filas.some(f => dueno(tabla, f) !== uid)) return rls;
        const hechas = [];
        for(const f of this.filas){
          const existente = op === 'upsert' ? filas.find(x => this.conflicto.every(c => String(x[c]) === String(f[c]))) : null;
          if(existente){
            if(dueno(tabla, existente) !== uid) return rls;
            Object.assign(existente, f);
            hechas.push(existente);
          } else {
            const nueva = { id: siguienteId++, created_at: new Date().toISOString(), ...f };
            filas.push(nueva);
            hechas.push(nueva);
          }
        }
        return salida(copia(hechas));
      }
      if(op === 'update'){
        const res = visibles();
        res.forEach(f => Object.assign(f, this.campos));
        return salida(copia(res));
      }
      if(op === 'delete'){
        const res = visibles();
        db[tabla] = filas.filter(f => !res.includes(f));
        return salida(copia(res));
      }
      return { data: null, error: { message: 'op desconocida' } };
    }
  }

  const authBase = {
    getUser: async () => ({ data: { user: estado.usuario }, error: null }),
    getSession: async () => ({ data: { session: estado.usuario ? { access_token: 'token-falso', user: estado.usuario } : null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
    signOut: async () => { estado.usuario = null; return { error: null }; }
  };
  const auth = new Proxy(authBase, { get: (t, p) => (p in t ? t[p] : async () => ({ data: {}, error: null })) });
  const cliente = {
    auth,
    from: (tabla) => new Consulta(tabla),
    rpc: async () => ({ data: null, error: { message: 'rpc no disponible en el falso' } })
  };
  return { db, estado, cliente };
}

export function textoPlano(html){
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/**
 * @param {{hoy?: string, hora?: string}} [o]  hoy "YYYY-MM-DD", hora "HH:MM" (hora local)
 */
export function crearEntorno({ hoy = '2026-10-04', hora = '18:30' } = {}){
  const sb = crearSupabaseFalso();
  const ctx = {
    console: { log(){}, info(){}, warn(){}, error(){}, debug(){} },
    atob, btoa, // los navegadores los tienen; Node tambien desde v16
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, structuredClone,
    document: stub(),
    navigator: { onLine: true, serviceWorker: stub(), userAgent: 'node-test' },
    location: stub(),
    localStorage: almacenamiento(),
    sessionStorage: almacenamiento(),
    supabase: { createClient: () => sb.cliente },
    fetch: async (url) => {
      const u = String(url);
      if(u.includes('argentinadatos.com/v1/feriados')) return { ok: true, json: async () => FERIADOS };
      if(u.includes('dolarapi.com/v1/dolares')) return { ok: true, json: async () => DOLAR };
      if(u.includes('/indices/inflacion')) return { ok: true, json: async () => INFLACION };
      if(u.includes('/indices/riesgo-pais')) return { ok: true, json: async () => RIESGO };
      if(u.includes('/tasas/plazoFijo')) return { ok: true, json: async () => PLAZO };
      throw new TypeError('Failed to fetch');
    },
    alert(){}, confirm: () => true, prompt: () => null,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    matchMedia: () => ({ matches: false, addEventListener(){}, removeEventListener(){}, addListener(){} }),
    getComputedStyle: () => stub(),
    scrollTo(){}, addEventListener(){}, removeEventListener(){}
  };
  ctx.window = ctx;
  ctx.errores = [];
  ctx.console.error = (...a) => { ctx.errores.push(a.map(String).join(' ')); };
  vm.createContext(ctx);
  vm.runInContext(`(() => {
    const R = Date;
    const BASE = new R(${JSON.stringify(`${hoy}T${hora}:00`)}).getTime();
    globalThis.__reloj = { desfaseMs: 0 };
    globalThis.Date = class extends R {
      constructor(...a){ if(a.length) super(...a); else super(BASE + globalThis.__reloj.desfaseMs); }
      static now(){ return BASE + globalThis.__reloj.desfaseMs; }
    };
  })()`, ctx);
  for(const f of ['js/app.js', 'js/indicadores.js', 'js/ajuste-precios.js', 'js/stock.js', 'js/equipos.js', 'js/tiki.js']){
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
  }

  const run = (code) => vm.runInContext(code, ctx);
  return {
    ctx, sb, run,
    sembrar(datos){
      for(const [tabla, filas] of Object.entries(datos)){
        if(sb.db[tabla]) sb.db[tabla].push(...JSON.parse(JSON.stringify(filas)));
      }
    },
    login(usuario){ sb.estado.usuario = usuario; },
    async cargar(){ await run('loadData()'); },
    adelantarReloj(ms){ run(`globalThis.__reloj.desfaseMs += ${Number(ms)}`); },
    async preguntar(texto){
      const r = await run(`tikiResponder(${JSON.stringify(texto)})`);
      return { html: r.html, texto: textoPlano(r.html), acciones: JSON.parse(JSON.stringify(r.acciones || [])) };
    },
    escrituras(tabla){ return sb.estado.llamadas.filter(l => l.tabla === tabla && l.op !== 'select').length; }
  };
}
