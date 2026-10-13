// Inicio / Resumen enriquecido: período y su comparable, variación, datos del
// gráfico (por día / por hora) y avisos accionables. Corre app.js + stock.js
// de verdad en el harness, con los datos ya cargados (sin red).
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from './helpers/entorno.mjs';

const A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
function ent(){
  const e = crearEntorno({ hoy: '2026-10-11', hora: '15:30' });
  e.login(A);
  e.run(`currentUserId = ${JSON.stringify(A.id)}; comercioConfig = { rubros:[], modulos:{}, onboardingAt:'x' };`);
  return e;
}

describe('Inicio: variación vs el período anterior', () => {
  test('pctCambio redondea y devuelve null si no hay base de comparación', () => {
    const e = ent();
    assert.equal(e.run('pctCambio(150,100)'), 50);
    assert.equal(e.run('pctCambio(80,100)'), -20);
    assert.equal(e.run('pctCambio(100,100)'), 0);
    assert.equal(e.run('JSON.stringify(pctCambio(100,0))'), 'null');
  });

  test('deltaChip: verde si sube y es bueno, rojo si baja; gastos al revés', () => {
    const e = ent();
    assert.match(e.run(`deltaChip(20,true,'el mes pasado')`), /delta-up/);
    assert.match(e.run(`deltaChip(-20,true,'el mes pasado')`), /delta-down/);
    assert.match(e.run(`deltaChip(20,false,'el mes pasado')`), /delta-down/); // +20% de gastos = malo
    assert.match(e.run(`deltaChip(null,true,'ayer')`), /sin ayer para comparar/);
  });
});

describe('Inicio: cálculo del período', () => {
  test('calcPeriodo suma ventas, gastos, costo, ganancia real y ventas sin costo', () => {
    const e = ent();
    const r = JSON.parse(e.run(`JSON.stringify(calcPeriodo([
      {tipo:'Venta',monto:1000,costoTotal:600},
      {tipo:'Venta',monto:500,costoTotal:0},
      {tipo:'Gasto',monto:300}
    ]))`));
    assert.equal(r.ventas, 1500);
    assert.equal(r.gastos, 300);
    assert.equal(r.costoMerc, 600);
    assert.equal(r.gananciaReal, 600); // 1500 - 600 - 300
    assert.equal(r.nVentas, 2);
    assert.equal(r.ventasSinCosto, 1);
  });

  test('entriesDelScope "mes" separa este mes del mes pasado', () => {
    const e = ent();
    e.run(`entries = [
      {fecha:'2026-10-03',tipo:'Venta',monto:100},
      {fecha:'2026-10-11',tipo:'Venta',monto:200},
      {fecha:'2026-09-15',tipo:'Venta',monto:50}
    ];`);
    const r = JSON.parse(e.run(`(() => { const s = entriesDelScope('mes'); return JSON.stringify({ act:s.actual.length, ant:s.anterior.length, lbl:s.labelAnterior }); })()`));
    assert.equal(r.act, 2);
    assert.equal(r.ant, 1);
    assert.equal(r.lbl, 'el mes pasado');
  });

  test('entriesDelScope "hoy" separa hoy de ayer', () => {
    const e = ent();
    e.run(`entries = [
      {fecha:'2026-10-11',tipo:'Venta',monto:100},
      {fecha:'2026-10-10',tipo:'Venta',monto:50},
      {fecha:'2026-10-09',tipo:'Venta',monto:70}
    ];`);
    const r = JSON.parse(e.run(`(() => { const s = entriesDelScope('hoy'); return JSON.stringify({ act:s.actual.length, ant:s.anterior.length, lbl:s.labelAnterior }); })()`));
    assert.equal(r.act, 1);
    assert.equal(r.ant, 1);
    assert.equal(r.lbl, 'ayer');
  });
});

describe('Inicio: datos del gráfico', () => {
  test('por día del mes: un punto por día hasta hoy, suma por día', () => {
    const e = ent();
    e.run(`entries = [
      {fecha:'2026-10-02',tipo:'Venta',monto:100},
      {fecha:'2026-10-02',tipo:'Venta',monto:50},
      {fecha:'2026-10-11',tipo:'Venta',monto:200},
      {fecha:'2026-09-30',tipo:'Venta',monto:999}
    ];`);
    const r = JSON.parse(e.run('JSON.stringify(ventasPorDiaDelMes())'));
    assert.equal(r.puntos.length, 11);        // días 1..11
    assert.equal(r.puntos[0].total, 0);        // día 1 sin ventas
    assert.equal(r.puntos[1].total, 150);      // día 2 = 100 + 50
    assert.equal(r.puntos[10].total, 200);     // día 11
  });

  test('por hora de hoy: agrupa por hora y cuenta las ventas sin hora', () => {
    const e = ent();
    e.run(`entries = [
      {fecha:'2026-10-11',tipo:'Venta',monto:100,hora:'10:15'},
      {fecha:'2026-10-11',tipo:'Venta',monto:50,hora:'10:50'},
      {fecha:'2026-10-11',tipo:'Venta',monto:70,hora:'13:00'},
      {fecha:'2026-10-11',tipo:'Venta',monto:20,hora:''},
      {fecha:'2026-10-10',tipo:'Venta',monto:999,hora:'12:00'}
    ];`);
    const r = JSON.parse(e.run('JSON.stringify(ventasPorHoraDeHoy())'));
    assert.equal(r.sinHora, 1);
    assert.equal(r.puntos.length, 4);     // de 10h a 13h
    assert.equal(r.puntos[0].total, 150); // 10h = 100 + 50
    assert.equal(r.puntos[3].total, 70);  // 13h
  });
});

describe('Inicio: avisos accionables', () => {
  test('ganancia en rojo y ventas sin costo generan avisos', () => {
    const e = ent();
    const titulos = e.run(`construirAvisosInicio('mes',
      calcPeriodo([{tipo:'Venta',monto:1000,costoTotal:0},{tipo:'Gasto',monto:2000}]),
      calcPeriodo([])
    ).map(a => a.titulo).join(' | ')`);
    assert.match(titulos, /rojo/i);
    assert.match(titulos, /sin costo/i);
  });

  test('reposición: avisa si hay productos bajo el mínimo (catálogo activo)', () => {
    const e = ent();
    e.run(`products = [{id:1,nombre:'Coca',stock_actual:1,stock_minimo:10}]; entries = [];`);
    const titulos = JSON.parse(e.run(`JSON.stringify(construirAvisosInicio('mes', calcPeriodo([{tipo:'Venta',monto:100,costoTotal:60}]), calcPeriodo([])).map(a => a.titulo))`));
    assert.ok(titulos.some(t => /reponer/i.test(t)), 'debería avisar reposición');
  });

  test('con el catálogo apagado no mira reposición', () => {
    const e = ent();
    e.run(`comercioConfig = { rubros:['servicios'], modulos:{caja:true,catalogo:false,noticias:false,facturacion:false}, onboardingAt:'x' };
           products = [{id:1,nombre:'Coca',stock_actual:1,stock_minimo:10}];`);
    const titulos = JSON.parse(e.run(`JSON.stringify(construirAvisosInicio('mes', calcPeriodo([{tipo:'Venta',monto:100,costoTotal:60}]), calcPeriodo([])).map(a => a.titulo))`));
    assert.ok(!titulos.some(t => /reponer/i.test(t)), 'no debería mirar reposición con el catálogo apagado');
  });
});
