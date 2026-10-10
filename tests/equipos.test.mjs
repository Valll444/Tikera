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

  test('sin equipos cargados, lo dice en vez de inventar', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['celulares'], modulos:{caja:false,catalogo:false,equipos:true,noticias:false,facturacion:false}, onboardingAt:'x' };
           equipos = [];`);
    const { texto } = await e.preguntar('¿cuántos equipos tengo?');
    assert.match(texto, /Todavía no cargaste equipos/i);
  });

  test('con Equipos apagado, explica cómo activarlo', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['kiosco'], modulos:{caja:true,catalogo:true,equipos:false,noticias:true,facturacion:false}, onboardingAt:'x' };`);
    const { texto } = await e.preguntar('¿cuántos equipos tengo?');
    assert.match(texto, /Ajustes/i);
    assert.match(texto, /Equipos/i);
  });
});
