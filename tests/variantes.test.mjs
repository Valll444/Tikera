// Módulo Variantes (ropa/calzado): stock por talle/color y Tiki consciente del
// módulo. Corre app.js + variantes.js + tiki.js en el harness.
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from './helpers/entorno.mjs';

const HOY = '2026-10-10';
const A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
function entorno(){ const e = crearEntorno({ hoy: HOY, hora: '12:00' }); e.login(A); return e; }

describe('Variantes: helpers de stock', () => {
  test('stockVariantes suma solo las variantes de ese producto', () => {
    const e = entorno();
    const o = JSON.parse(e.run(`(() => {
      productoVariantes = [
        { id:1, product_id:10, talle:'S', color:'Negro', stock_actual:3 },
        { id:2, product_id:10, talle:'M', color:'Negro', stock_actual:5 },
        { id:3, product_id:99, talle:'L', color:'Azul',  stock_actual:2 }
      ];
      return JSON.stringify({ total10: stockVariantes(10), vars10: variantesDeProducto(10).length, total99: stockVariantes(99) });
    })()`));
    assert.equal(o.total10, 8);
    assert.equal(o.vars10, 2);
    assert.equal(o.total99, 2);
  });

  test('varianteLabel arma "talle · color" y saltea lo vacío', () => {
    const e = entorno();
    assert.equal(e.run(`varianteLabel({ talle:'M', color:'Negro' })`), 'M · Negro');
    assert.equal(e.run(`varianteLabel({ talle:'42' })`), '42');
    assert.equal(e.run(`varianteLabel({ color:'Rojo' })`), 'Rojo');
    assert.equal(e.run(`varianteLabel({})`), 'Variante');
  });
});

describe('Tiki y el módulo Variantes', () => {
  test('con Variantes apagado, explica cómo activarlo', async () => {
    const e = entorno();
    e.run(`comercioConfig = { rubros:['kiosco'], modulos:{caja:true,catalogo:true,variantes:false,equipos:false,noticias:true,facturacion:false}, onboardingAt:'x' }`);
    const { texto } = await e.preguntar('¿qué talles tengo?');
    assert.match(texto, /Ajustes/i);
    assert.match(texto, /Variantes/i);
  });
});
