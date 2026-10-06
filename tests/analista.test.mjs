// Tiki como analista (capacidades gratis). Corre js/tiki.js de verdad.
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from './helpers/entorno.mjs';
import { generarKiosco } from './fixtures/kiosco.mjs';

const HOY = '2026-10-04';
const A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };

async function conKiosco(){
  const e = crearEntorno({ hoy: HOY, hora: '18:30' });
  e.sembrar(generarKiosco({ hoy: HOY, horaActual: 18, userId: A.id }));
  e.login(A);
  await e.cargar();
  return e;
}
const numero = (t) => { const m = t.replace(/\./g, '').match(/\$(\d+)/); return m ? Number(m[1]) : null; };

describe('Analista: punto de equilibrio y objetivos', () => {
  test('calcula el punto de equilibrio y explica con qué', async () => {
    const e = await conKiosco();
    const { texto } = await e.preguntar('¿cuál es mi punto de equilibrio?');
    assert.match(texto, /necesitás vender alrededor de \$[\d.]+ por mes/);
    assert.match(texto, /por día abierto/);
    assert.match(texto, /después de pagar la mercadería/);
    assert.match(texto, /sin contar la compra de mercadería/);
    assert.match(texto, /estimación/);
  });

  test('"cubrir mis gastos" da el mismo resultado que el punto de equilibrio', async () => {
    const e = await conKiosco();
    const a = numero((await e.preguntar('¿cuál es mi punto de equilibrio?')).texto);
    const b = numero((await e.preguntar('¿cuánto tengo que vender para cubrir mis gastos?')).texto);
    assert.equal(a, b);
  });

  test('la cuenta cierra: equilibrio × margen ≈ gastos operativos', async () => {
    const e = await conKiosco();
    const r = e.run('(() => { const m = tikiMargenContrib(30); const g = tikiGastosOperativosMes(); const eq = g.monto / m.pct; return JSON.stringify({ eq, pct: m.pct, gastos: g.monto }); })()');
    const { eq, pct, gastos } = JSON.parse(r);
    assert.ok(Math.abs(eq * pct - gastos) < 1, 'equilibrio × margen no da los gastos');
    assert.ok(pct > 0 && pct < 1);
  });

  test('objetivo de ganancia mensual: ventas = (meta + gastos) / margen', async () => {
    const e = await conKiosco();
    const { texto } = await e.preguntar('quiero ganar 500000 por mes, ¿cuánto vendo?');
    assert.match(texto, /Para ganar \$500\.000/);
    const r = JSON.parse(e.run('(() => { const m = tikiMargenContrib(30); const g = tikiGastosOperativosMes(); return JSON.stringify({ pct: m.pct, gastos: g.monto }); })()'));
    const esperado = Math.round((500000 + r.gastos) / r.pct);
    const m = texto.replace(/\./g, '').match(/vender alrededor de \$(\d+)/);
    const dicho = m ? Number(m[1]) : null;
    assert.ok(dicho && Math.abs(dicho - esperado) <= 50, `dijo ${dicho}, esperaba ~${esperado}`);
  });

  test('"ganar por día" se convierte a meta mensual por días abiertos', async () => {
    const e = await conKiosco();
    const dias = Number(e.run('tikiDiasAbiertosMes()'));
    const { texto } = await e.preguntar('quiero ganar 20000 por día');
    assert.match(texto, new RegExp(`Para ganar \\$${(20000 * dias).toLocaleString('es-AR').replace('.', '\\.')}`));
  });

  test('"quiero ganar X" NO se guarda como meta de ventas (memoria)', async () => {
    const e = await conKiosco();
    await e.preguntar('quiero ganar 500000 por mes');
    assert.equal(e.escrituras('tiki_memoria'), 0);
  });

  test('sin gastos cargados: pide cargar gastos, no inventa', async () => {
    const e = crearEntorno({ hoy: HOY });
    // ventas con costo pero ningún gasto
    const movs = [];
    for(let i = 0; i < 20; i++){ const f = `2026-09-${String(10 + (i % 15)).padStart(2, '0')}`; movs.push({ id: 'v' + i, user_id: A.id, fecha: f, hora: '10:00', tipo: 'Venta', descripcion: 'Coca', cantidad: 1, monto: 1000, costo_total: 600, metodo_pago: 'Efectivo', created_at: f + 'T13:00:00Z' }); }
    e.sembrar({ movements: movs });
    e.login(A); await e.cargar();
    const { texto } = await e.preguntar('¿cuál es mi punto de equilibrio?');
    assert.match(texto, /cargá tus gastos del mes/i);
    assert.equal(numero(texto), null, 'no debería tirar un número');
  });

  test('ventas sin costo: pide cargar costos, no inventa margen', async () => {
    const e = crearEntorno({ hoy: HOY });
    const movs = [{ id: 'v1', user_id: A.id, fecha: '2026-09-15', hora: '10:00', tipo: 'Venta', descripcion: 'x', monto: 1000, metodo_pago: 'Efectivo', created_at: '2026-09-15T13:00:00Z' }];
    const gastos = [{ id: 'g1', user_id: A.id, fecha: '2026-09-05', hora: '09:00', tipo: 'Gasto', descripcion: 'Alquiler', monto: 100000, categoria: 'Alquiler', es_fijo: true, created_at: '2026-09-05T12:00:00Z' }];
    e.sembrar({ movements: movs.concat(gastos) });
    e.login(A); await e.cargar();
    const { texto } = await e.preguntar('¿cuál es mi punto de equilibrio?');
    assert.match(texto, /costo cargado/i);
  });

  test('vendiendo al costo: avisa que no hay equilibrio posible', async () => {
    const e = crearEntorno({ hoy: HOY });
    const movs = [];
    for(let i = 0; i < 10; i++){ const f = `2026-09-${String(10 + i).padStart(2, '0')}`; movs.push({ id: 'v' + i, user_id: A.id, fecha: f, hora: '10:00', tipo: 'Venta', descripcion: 'x', monto: 1000, costo_total: 1000, metodo_pago: 'Efectivo', created_at: f + 'T13:00:00Z' }); }
    movs.push({ id: 'g1', user_id: A.id, fecha: '2026-09-05', hora: '09:00', tipo: 'Gasto', descripcion: 'Alquiler', monto: 100000, categoria: 'Alquiler', es_fijo: true, created_at: '2026-09-05T12:00:00Z' });
    e.sembrar({ movements: movs });
    e.login(A); await e.cargar();
    const { texto } = await e.preguntar('¿cuál es mi punto de equilibrio?');
    assert.match(texto, /al costo o por debajo/i);
  });
});

describe('Analista: rentabilidad cruzada por producto', () => {
  test('"vende mucho pero deja poco": alto volumen, margen bajo el promedio', async () => {
    const e = await conKiosco();
    const { texto } = await e.preguntar('¿qué vendo mucho pero me deja poco?');
    assert.match(texto, /menos que tu promedio/);
    assert.match(texto, /Marlboro Box 20/);           // alto volumen, 12% margen
    assert.doesNotMatch(texto, /NaN|undefined/);
  });

  test('"buen margen pero no rota": margen alto, casi sin ventas, con stock', async () => {
    const e = await conKiosco();
    const { texto } = await e.preguntar('¿qué tiene buen margen pero no rota?');
    assert.match(texto, /buen margen pero casi no rotan/);
    assert.match(texto, /Pilas Duracell AA|Caramelos Sugus/);
  });

  test('"dónde pierdo plata": detecta venta al costo o por debajo', async () => {
    const e = await conKiosco();
    const { texto } = await e.preguntar('¿dónde estoy perdiendo plata?');
    assert.match(texto, /al costo o por debajo/);
    assert.match(texto, /Cerveza Quilmes 1L/);        // precio 2900 <= costo 3000
  });

  test('"deja menos": ranking de ganancia invertido', async () => {
    const e = await conKiosco();
    const { texto } = await e.preguntar('¿qué producto me deja menos?');
    assert.match(texto, /menos ganancia/);
    // el primero debe ser el de menor ganancia (la cerveza, negativa)
    assert.match(texto.split('\n')[0] + texto, /Cerveza Quilmes 1L/);
  });

  test('sin productos a pérdida, lo dice (no inventa)', async () => {
    const e = crearEntorno({ hoy: HOY });
    const movs = [];
    for(let i = 0; i < 15; i++){ const f = `2026-09-${String(10 + i).padStart(2, '0')}`; movs.push({ id: 'v' + i, user_id: A.id, fecha: f, hora: '10:00', tipo: 'Venta', descripcion: 'Coca', cantidad: 1, monto: 1000, costo_total: 600, metodo_pago: 'Efectivo', created_at: f + 'T13:00:00Z' }); }
    e.sembrar({ movements: movs, products: [{ id: 1, user_id: A.id, nombre: 'Coca', precio_venta: 1000, costo_unitario: 600, stock_actual: 10, categoria: 'Bebidas' }] });
    e.login(A); await e.cargar();
    const { texto } = await e.preguntar('¿dónde estoy perdiendo plata?');
    assert.match(texto, /no veo productos que estés vendiendo a pérdida|no estás perdiendo plata/i);
  });
});

describe('Analista: categorías', () => {
  test('desglose por categoría con margen', async () => {
    const e = await conKiosco();
    const { texto } = await e.preguntar('¿cómo vienen mis categorías?');
    assert.match(texto, /por categoría/);
    assert.match(texto, /Bebidas/);
    assert.match(texto, /mejor margen te deja es/);
  });
  test('qué categoría crece: compara contra los 30 días anteriores', async () => {
    const e = await conKiosco();
    const { texto } = await e.preguntar('¿qué categoría está creciendo?');
    assert.match(texto, /crece|cae|estables/);
    assert.match(texto, /contra los 30 días anteriores|estables/);
  });
  test('categoría nombrada: responde solo de esa', async () => {
    const e = await conKiosco();
    const { texto } = await e.preguntar('¿cuánto vendí en bebidas?');
    assert.match(texto, /en Bebidas/);
    assert.match(texto, /margen de \d+%/);
  });
  test('sin categorías en el catálogo, lo dice', async () => {
    const e = crearEntorno({ hoy: HOY });
    e.sembrar({ products: [{ id: 1, user_id: A.id, nombre: 'Coca', precio_venta: 1000, costo_unitario: 600, stock_actual: 5 }], movements: [{ id: 'v1', user_id: A.id, fecha: '2026-09-15', hora: '10:00', tipo: 'Venta', descripcion: 'Coca', cantidad: 1, monto: 1000, costo_total: 600, metodo_pago: 'Efectivo', created_at: '2026-09-15T13:00:00Z' }] });
    e.login(A); await e.cargar();
    assert.match((await e.preguntar('¿cómo vienen mis categorías?')).texto, /categoría asignada/i);
  });
});

describe('Analista: proyección de cierre de mes', () => {
  async function kioscoAl(hoy){ const e = crearEntorno({ hoy, hora: '18:30' }); e.sembrar(generarKiosco({ hoy, horaActual: 18, userId: A.id })); e.login(A); await e.cargar(); return e; }
  test('proyecta el mes a mitad de mes, marcado como estimación', async () => {
    const e = await kioscoAl('2026-10-20');
    const { texto } = await e.preguntar('¿en cuánto voy a cerrar el mes?');
    assert.match(texto, /cerrarías el mes alrededor de \$[\d.]+/);
    assert.match(texto, /estimación/);
    assert.match(texto, /llevás \$[\d.]+ en 20 días/);
    assert.doesNotMatch(texto, /NaN|undefined/);
  });
  test('a principio de mes avisa que es pronto, no proyecta', async () => {
    const e = await kioscoAl('2026-10-02');
    const { texto } = await e.preguntar('¿cómo voy a cerrar el mes?');
    assert.match(texto, /muy pronto para proyectar/);
    assert.doesNotMatch(texto, /cerrarías el mes alrededor/);
  });
});

describe('Analista: detección de anomalías', () => {
  test('vendés más pero el margen bajó (caso estrella)', async () => {
    const e = crearEntorno({ hoy: '2026-10-20' });
    const movs = [];
    const push = (f, monto, costo) => movs.push({ id: 'm' + movs.length, user_id: A.id, fecha: f, hora: '10:00', tipo: 'Venta', descripcion: 'Coca', cantidad: 1, monto, costo_total: costo, metodo_pago: 'Efectivo', created_at: f + 'T13:00:00Z' });
    for(let i = 30; i <= 59; i++){ const f = new Date(2026, 9, 20); f.setDate(f.getDate() - i); const fs = f.toISOString().slice(0, 10); for(let j = 0; j < 5; j++) push(fs, 1000, 500); } // 50% margen
    for(let i = 0; i <= 29; i++){ const f = new Date(2026, 9, 20); f.setDate(f.getDate() - i); const fs = f.toISOString().slice(0, 10); for(let j = 0; j < 8; j++) push(fs, 1000, 800); } // 20% margen, más ventas
    e.sembrar({ movements: movs });
    e.login(A); await e.cargar();
    const { texto } = await e.preguntar('¿algo raro?');
    assert.match(texto, /vendiendo.*más/i);
    assert.match(texto, /margen bajó de 50% a 20%/);
  });

  test('con pocos datos no inventa anomalías', async () => {
    const e = crearEntorno({ hoy: '2026-10-20' });
    e.sembrar({ movements: [{ id: 'v1', user_id: A.id, fecha: '2026-10-18', hora: '10:00', tipo: 'Venta', descripcion: 'Coca', cantidad: 1, monto: 1000, costo_total: 600, metodo_pago: 'Efectivo', created_at: '2026-10-18T13:00:00Z' }] });
    e.login(A); await e.cargar();
    assert.match((await e.preguntar('¿algo raro para revisar?')).texto, /no tengo suficientes datos/i);
  });

  test('negocio estable: dice que no ve nada raro', async () => {
    const e = crearEntorno({ hoy: '2026-10-20' });
    const movs = [];
    for(let i = 0; i <= 59; i++){ const f = new Date(2026, 9, 20); f.setDate(f.getDate() - i); const fs = f.toISOString().slice(0, 10); for(let j = 0; j < 5; j++) movs.push({ id: `m${i}_${j}`, user_id: A.id, fecha: fs, hora: '10:00', tipo: 'Venta', descripcion: 'Coca', cantidad: 1, monto: 1000, costo_total: 600, metodo_pago: 'Efectivo', created_at: fs + 'T13:00:00Z' }); }
    e.sembrar({ movements: movs });
    e.login(A); await e.cargar();
    assert.match((await e.preguntar('¿algo raro?')).texto, /no veo nada raro/i);
  });
});
