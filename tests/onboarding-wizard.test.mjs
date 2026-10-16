// Onboarding en pasos (wizard): validación de avance, armado de cada paso y
// guardado del perfil + nombre en profiles. Corre app.js de verdad en el
// harness. La decisión de MOSTRARLO (solo cuentas nuevas) se testea en
// modular-rubro.test.mjs; acá va el contenido del asistente.
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from './helpers/entorno.mjs';

const A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
function ent(){
  const e = crearEntorno({ hoy: '2026-10-15', hora: '12:00' });
  e.login(A);
  e.run(`currentUserId = ${JSON.stringify(A.id)}; comercioConfig = { rubros:[], modulos:{}, onboardingAt:null };`);
  return e;
}
// Posición de cada paso dentro de ONB_PASOS (para setear wizState.i).
function idx(e, paso){ return JSON.parse(e.run('JSON.stringify(ONB_PASOS)')).indexOf(paso); }

describe('Wizard: validación de avance', () => {
  test('el paso "negocio" exige un nombre', () => {
    const e = ent();
    e.run(`wizState.i = ${idx(e,'negocio')}; wizState.negocio = '';`);
    assert.equal(e.run('wizPuedeSeguir()'), false);
    e.run(`wizState.negocio = 'Kiosco La Esquina';`);
    assert.equal(e.run('wizPuedeSeguir()'), true);
  });
  test('el paso "rubro" exige al menos uno', () => {
    const e = ent();
    e.run(`wizState.i = ${idx(e,'rubro')}; wizState.rubros = new Set();`);
    assert.equal(e.run('wizPuedeSeguir()'), false);
    e.run(`wizState.rubros = new Set(['kiosco']);`);
    assert.equal(e.run('wizPuedeSeguir()'), true);
  });
  test('los pasos de perfil (volumen/cobro) no bloquean el avance', () => {
    const e = ent();
    e.run(`wizState.i = ${idx(e,'volumen')}; wizState.volumen = '';`);
    assert.equal(e.run('wizPuedeSeguir()'), true);
  });
});

describe('Wizard: armado de cada paso', () => {
  test('el paso rubro lista los rubros disponibles', () => {
    const e = ent();
    const html = e.run(`wizPasoHtml('rubro')`);
    assert.match(html, /Kiosco o almacén/);
    assert.match(html, /Celulares y electrónica/);
  });
  test('el paso módulos pre-marca los recomendados del rubro elegido', () => {
    const e = ent();
    e.run(`wizState.rubros = new Set(['kiosco']); wizState.modulos = {};`);
    e.run(`wizPasoHtml('modulos')`); // pre-marca al armarse
    assert.equal(e.run('wizState.modulos.caja'), true);
    assert.equal(e.run('wizState.modulos.catalogo'), true);
    assert.equal(e.run('wizState.modulos.equipos'), false); // no es de kiosco
  });
  test('la pantalla final muestra las tarjetas de valor', () => {
    const e = ent();
    e.run(`wizState.negocio = 'Kiosco La Esquina';`);
    const html = e.run(`wizPasoHtml('final')`);
    assert.match(html, /Kiosco La Esquina/);
    assert.match(html, /Cierre de caja/);
    assert.match(html, /Tiki/);
  });
});

describe('Wizard: guardado del perfil', () => {
  test('guardarOnboarding escribe nombre, rubros, módulos y perfil en profiles', async () => {
    const e = ent();
    e.sembrar({ profiles: [{ id: A.id, business_name: 'Mi negocio', plan: 'trial', trial_started_at: '2026-10-01T00:00:00Z' }] });
    await e.run(`guardarOnboarding(['kiosco'], { caja:true, catalogo:true, variantes:false, equipos:false, noticias:true, facturacion:false },
      { negocio: 'Kiosco La Esquina', perfil: { antiguedad:'1-3', volumen:'20-50', cobro:'mixto' } })`);
    // La escritura al fake sb es async (microtask): esperamos un tick.
    await new Promise(r => setTimeout(r, 0));
    const fila = e.sb.db.profiles[0];
    assert.equal(fila.business_name, 'Kiosco La Esquina');
    // rubros viene del realm del vm: comparo por valor con round-trip JSON.
    assert.deepEqual(JSON.parse(JSON.stringify(fila.rubros)), ['kiosco']);
    assert.equal(fila.modulos.caja, true);
    assert.equal(fila.modulos.equipos, false);
    assert.equal(fila.perfil.antiguedad, '1-3');
    assert.equal(fila.perfil.volumen, '20-50');
    assert.equal(fila.perfil.cobro, 'mixto');
    assert.ok(fila.onboarding_at, 'debe quedar marcado el onboarding');
  });
});
