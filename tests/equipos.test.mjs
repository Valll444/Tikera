// Módulo Equipos (celulares): lógica pura (margen, título) y Tiki consciente
// del inventario de equipos. Corre app.js + equipos.js + tiki.js en el harness.
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from './helpers/entorno.mjs';

const HOY = '2026-10-10';
const A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
function entorno(){ const e = crearEntorno({ hoy: HOY, hora: '12:00' }); e.login(A); return e; }

describe('Equipos: cálculo de margen y título', () => {
  test('margen = precio - costo, con porcentaje', () => {
    const e = entorno();
    const r = JSON.parse(e.run('JSON.stringify(equipoMargen({ precio:300000, costo:200000 }))'));
    assert.equal(r.monto, 100000);
    assert.ok(Math.abs(r.pct - 33.33) < 0.5, 'el % de margen debería ser ~33%');
  });
  test('margen null si falta el costo o el precio', () => {
    const e = entorno();
    assert.equal(e.run('JSON.stringify(equipoMargen({ precio:300000 }))'), 'null');
    assert.equal(e.run('JSON.stringify(equipoMargen({ costo:200000 }))'), 'null');
  });
  test('el título arma marca/modelo/capacidad/color y saltea lo vacío', () => {
    const e = entorno();
    assert.equal(e.run(`equipoTitulo({ marca:'Apple', modelo:'iPhone 13', capacidad:'128 GB', color:'Negro' })`), 'Apple iPhone 13 128 GB Negro');
    assert.equal(e.run(`equipoTitulo({ marca:'Samsung', modelo:'A54' })`), 'Samsung A54');
    assert.equal(e.run(`equipoTitulo({})`), 'Equipo sin nombre');
  });
});

describe('Vender un equipo', () => {
  test('marcar un equipo como vendido registra una venta real (suma a entries)', async () => {
    const e = entorno();
    const equipo = { id: 1, user_id: A.id, marca: 'Apple', modelo: 'iPhone 13', estado: 'disponible', precio: 620000, costo: 450000, vendido_at: null };
    e.sembrar({ equipos: [equipo] }); // fila en el fake sb (la update opera ahí)
    e.run(`currentUserId = ${JSON.stringify(A.id)}; equipos = ${JSON.stringify([equipo])}; entries.length = 0;`);
    await e.run(`cambiarEstadoEquipo(1, 'vendido')`);
    const r = JSON.parse(e.run(`JSON.stringify(entries.map(x => ({ tipo:x.tipo, desc:x.descripcion, monto:Number(x.monto) })))`));
    assert.equal(r.length, 1, 'debería registrar una venta');
    assert.equal(r[0].tipo, 'Venta');
    assert.match(r[0].desc, /iPhone 13/);
    assert.equal(r[0].monto, 620000);
    assert.equal(e.run(`equipos[0].estado`), 'vendido');
  });

  test('sin precio cargado, lo marca vendido pero no registra una venta de $0', async () => {
    const e = entorno();
    const equipo = { id: 2, user_id: A.id, marca: 'Moto', modelo: 'G84', estado: 'disponible', vendido_at: null };
    e.sembrar({ equipos: [equipo] });
    e.run(`currentUserId = ${JSON.stringify(A.id)}; equipos = ${JSON.stringify([equipo])}; entries.length = 0;`);
    await e.run(`cambiarEstadoEquipo(2, 'vendido')`);
    assert.equal(e.run(`entries.length`), 0, 'sin precio no se registra venta');
    assert.equal(e.run(`equipos[0].estado`), 'vendido');
  });
});

describe('Tiki y el módulo Equipos', () => {
  test('con Equipos activo, resume el inventario por estado (no inventa)', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['celulares'], modulos:{caja:false,catalogo:false,equipos:true,noticias:false,facturacion:false}, onboardingAt:'x' };
           equipos = [ {estado:'disponible'}, {estado:'disponible'}, {estado:'vendido'}, {estado:'reparacion'} ];`);
    const { texto } = await e.preguntar('¿cuántos equipos tengo disponibles?');
    assert.match(texto, /2 equipos disponibles/i);
    assert.match(texto, /1 en reparación/i);
    assert.match(texto, /1 vendido/i);
  });

  test('calcula la ganancia de los equipos vendidos (precio − costo)', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['celulares'], modulos:{caja:false,catalogo:false,equipos:true,noticias:false,facturacion:false}, onboardingAt:'x' };
           equipos = [ {estado:'vendido', precio:620000, costo:450000}, {estado:'vendido', precio:380000, costo:280000}, {estado:'disponible', precio:500000, costo:400000} ];`);
    const { texto } = await e.preguntar('¿cuánto gané con los equipos?');
    assert.match(texto, /\$270\.000/); // (620-450) + (380-280) = 270 mil
    assert.match(texto, /2 equipos vendidos/i);
  });

  test('sin equipos cargados, lo dice en vez de inventar', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['celulares'], modulos:{caja:false,catalogo:false,equipos:true,noticias:false,facturacion:false}, onboardingAt:'x' };
           equipos = [];`);
    const { texto } = await e.preguntar('¿cuántos equipos tengo?');
    assert.match(texto, /Todavía no cargaste equipos/i);
  });

  test('busca por marca/modelo: "¿qué iPhones tengo?" lista solo los iPhone', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['celulares'], modulos:{caja:false,catalogo:false,equipos:true,variantes:false,noticias:false,facturacion:false}, onboardingAt:'x' };
           equipos = [
             {marca:'Apple', modelo:'iPhone 13', estado:'disponible', precio:620000},
             {marca:'Apple', modelo:'iPhone 12', estado:'vendido', precio:500000},
             {marca:'Samsung', modelo:'Galaxy A54', estado:'disponible', precio:380000}
           ];`);
    const { texto } = await e.preguntar('¿qué iPhones tengo?');
    assert.match(texto, /iPhone 13/);
    assert.match(texto, /iPhone 12/);
    assert.ok(!/A54/.test(texto), 'no debería listar el Samsung');
  });

  test('dice cuál es el equipo más caro', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['celulares'], modulos:{caja:false,catalogo:false,equipos:true,variantes:false,noticias:false,facturacion:false}, onboardingAt:'x' };
           equipos = [ {marca:'Apple', modelo:'iPhone 13', estado:'disponible', precio:620000}, {marca:'Samsung', modelo:'A54', estado:'disponible', precio:380000} ];`);
    const { texto } = await e.preguntar('¿cuál es el equipo más caro?');
    assert.match(texto, /más caro/i);
    assert.match(texto, /iPhone 13/);
  });

  test('con Equipos apagado, explica cómo activarlo', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['kiosco'], modulos:{caja:true,catalogo:true,equipos:false,noticias:true,facturacion:false}, onboardingAt:'x' };`);
    const { texto } = await e.preguntar('¿cuántos equipos tengo?');
    assert.match(texto, /Ajustes/i);
    assert.match(texto, /Equipos/i);
  });
});
