// Lógica pura de ajuste de precios (js/ajuste-precios.js) y de la lista de
// compras (js/stock.js). No toca Supabase ni el DOM: solo funciones puras,
// justo donde están los casos borde (redondeo con dirección, combinación de
// fuentes de reposición). Corre los archivos de verdad en el harness.
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from './helpers/entorno.mjs';

const HOY = '2026-10-07';
const A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };

function entorno(){
  const e = crearEntorno({ hoy: HOY, hora: '12:00' });
  e.login(A);
  return e;
}
const rp = (e, v, mode, dir) =>
  e.run(`roundPrice(${v}, ${JSON.stringify(mode)}${dir === undefined ? '' : ', ' + dir})`);

describe('roundPrice: redondeo simple', () => {
  test('a $10 / $50 / $100 redondea al múltiplo más cercano', () => {
    const e = entorno();
    assert.equal(rp(e, 1357.4, '10'), 1360);
    assert.equal(rp(e, 1357.4, '50'), 1350);
    assert.equal(rp(e, 1357.4, '100'), 1400);
  });
  test('sin redondear ("0") deja 2 decimales', () => {
    const e = entorno();
    assert.equal(rp(e, 1357.456, '0'), 1357.46);
  });
});

describe('roundPrice: terminación comercial respeta la dirección', () => {
  test('al subir redondea hacia arriba, nunca por debajo del objetivo', () => {
    const e = entorno();
    // $200 +10% = 220; el ...90 más cercano es 190, pero subir no puede bajar -> 290
    assert.equal(rp(e, 220, 'end90', 1), 290);
    assert.equal(rp(e, 1357.4, 'end90', 1), 1390);
    assert.equal(rp(e, 1357.4, 'end99', 1), 1399);
  });
  test('al bajar redondea hacia abajo, nunca por encima del objetivo', () => {
    const e = entorno();
    // $150 -5% = 142.5; el ...90 más cercano es 190, pero bajar no puede subir -> 90
    assert.equal(rp(e, 142.5, 'end90', -1), 90);
    assert.equal(rp(e, 1360, 'end90', -1), 1290);
  });
  test('sin dirección usa el más cercano', () => {
    const e = entorno();
    assert.equal(rp(e, 1357.4, 'end90'), 1390);
  });
});

describe('calcularListaCompras: combina predicción y bajo mínimo', () => {
  test('incluye los productos bajo el mínimo aunque no tengan ventas', () => {
    const e = entorno();
    const r = JSON.parse(e.run(`(() => {
      products.length = 0; entries.length = 0;
      products.push(
        { id:'1', nombre:'Yerba', precio_venta:3100, stock_actual:1, stock_minimo:4 },
        { id:'2', nombre:'Fideos', precio_venta:1200, stock_actual:50, stock_minimo:5 }
      );
      return JSON.stringify(calcularListaCompras());
    })()`));
    assert.equal(r.length, 1, 'solo Yerba está bajo el mínimo');
    assert.equal(r[0].nombre, 'Yerba');
    assert.equal(r[0].motivo, 'bajo-minimo');
    assert.equal(r[0].suggestedQty, 3); // 4 - 1
  });

  test('no duplica un producto que ya entró por velocidad de venta', () => {
    const e = entorno();
    const r = JSON.parse(e.run(`(() => {
      products.length = 0; entries.length = 0;
      // Coca: bajo el mínimo (5<=10) Y con ventas recientes (predicción)
      products.push({ id:'1', nombre:'Coca', precio_venta:1360, stock_actual:5, stock_minimo:10 });
      const hoy = new Date();
      for(let i=0;i<14;i++){
        const d = new Date(hoy); d.setDate(d.getDate()-i);
        const f = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        entries.push({ tipo:'Venta', fecha:f, descripcion:'Coca', cantidad:2 });
      }
      return JSON.stringify(calcularListaCompras());
    })()`));
    assert.equal(r.length, 1, 'aparece una sola vez');
    assert.equal(r[0].nombre, 'Coca');
    assert.equal(r[0].motivo, 'prediccion', 'la predicción por venta tiene prioridad');
  });

  test('sin faltantes ni predicción, la lista queda vacía', () => {
    const e = entorno();
    const r = JSON.parse(e.run(`(() => {
      products.length = 0; entries.length = 0;
      products.push({ id:'1', nombre:'Fideos', precio_venta:1200, stock_actual:50, stock_minimo:5 });
      return JSON.stringify(calcularListaCompras());
    })()`));
    assert.equal(r.length, 0);
  });
});
