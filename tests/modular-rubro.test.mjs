// Tikera modular por rubro (Fase 0): módulos por comercio, recomendaciones por
// rubro y Tiki consciente de qué módulos están activos. Corre app.js + tiki.js
// de verdad en el harness.
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from './helpers/entorno.mjs';

const HOY = '2026-10-10';
const A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
function entorno(){ const e = crearEntorno({ hoy: HOY, hora: '12:00' }); e.login(A); return e; }

describe('Módulos: activación y config', () => {
  test('config vacía (usuario que ya usaba Tikera) deja TODOS los módulos activos', () => {
    const e = entorno();
    const r = JSON.parse(e.run(`(() => {
      comercioConfig = { rubros:[], modulos:{}, onboardingAt:null };
      return JSON.stringify(MODULOS_OPCIONALES.map(k => moduloActivo(k)));
    })()`));
    assert.deepEqual(r, [true, true, true, true], 'sin configurar, no se le saca ningún módulo a nadie');
  });

  test('config explícita respeta los flags elegidos', () => {
    const e = entorno();
    const r = JSON.parse(e.run(`(() => {
      comercioConfig = { rubros:['servicios'], modulos:{caja:true,catalogo:false,noticias:false,facturacion:false}, onboardingAt:'x' };
      return JSON.stringify({ caja: moduloActivo('caja'), catalogo: moduloActivo('catalogo'), noticias: moduloActivo('noticias'), facturacion: moduloActivo('facturacion') });
    })()`));
    assert.deepEqual(r, { caja:true, catalogo:false, noticias:false, facturacion:false });
  });
});

describe('Recomendaciones por rubro', () => {
  test('un kiosco recibe caja, catálogo y noticias', () => {
    const e = entorno();
    const rec = JSON.parse(e.run('JSON.stringify(modulosRecomendados(["kiosco"]).sort())'));
    assert.deepEqual(rec, ['caja', 'catalogo', 'noticias']);
  });

  test('un vendedor de celulares prioriza el catálogo y NO fuerza el cierre de caja', () => {
    const e = entorno();
    const rec = JSON.parse(e.run('JSON.stringify(modulosRecomendados(["celulares"]))'));
    assert.ok(rec.includes('catalogo'), 'celulares necesita catálogo');
    assert.ok(!rec.includes('caja'), 'celulares no debería traer cierre de caja por default');
  });

  test('un negocio mixto suma las necesidades de varios rubros', () => {
    const e = entorno();
    const rec = JSON.parse(e.run('JSON.stringify(modulosRecomendados(["kiosco","gastronomia"]).sort())'));
    assert.deepEqual(rec, ['caja', 'catalogo', 'noticias']);
  });
});

describe('Tiki consciente de los módulos habilitados', () => {
  test('con el módulo apagado, explica cómo activarlo (no inventa un resultado)', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['servicios'], modulos:{caja:false,catalogo:false,noticias:false,facturacion:false}, onboardingAt:'x' }`);
    const { texto } = await e.preguntar('¿cómo fue el cierre de caja?');
    assert.match(texto, /Ajustes/i, 'debería mandar a Ajustes a prender el módulo');
    assert.match(texto, /Cierre de caja/i, 'debería nombrar el módulo apagado');
  });

  test('pregunta por el dólar con Indicadores apagado → manda a activarlo', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['servicios'], modulos:{caja:true,catalogo:false,noticias:false,facturacion:false}, onboardingAt:'x' }`);
    const { texto } = await e.preguntar('¿a cuánto está el dólar?');
    assert.match(texto, /Ajustes/i);
    assert.match(texto, /Indicadores/i);
  });

  test('con el módulo activo (config legacy), Tiki responde normal (no manda a Ajustes)', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:[], modulos:{}, onboardingAt:null }`);
    const { texto } = await e.preguntar('¿cómo fue el cierre de caja?');
    assert.ok(!/Rubro y módulos/i.test(texto), 'con el módulo activo no debería mandar a activarlo');
  });
});
