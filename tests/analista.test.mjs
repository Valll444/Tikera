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
