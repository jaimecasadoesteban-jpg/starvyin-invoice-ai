import { describe, expect, it } from 'vitest';

import { fechaLocal } from '../../src/core/fechas.js';
import type { Comprobacion } from '../../src/extraccion/evidencias.js';
import { desdeModelo } from '../../src/extraccion/factura-leida.js';
import type { SalidaModelo } from '../../src/extraccion/salida.js';
import { bloqueosQueNoSeAceptan, decidir, validar, type ContextoValidacion, type IdRegla } from '../../src/validacion/reglas.js';

/** Una factura ficticia que pasa todas las reglas. Cada test cambia UNA cosa. */
const BUENA = {
  es_factura: true,
  legible: true,
  tipo: 'factura',
  emisor_nombre: 'Laboratorios Imaginarios, S.A.',
  emisor_nif: 'A99999120',
  emisor_evidencia: 'e',
  receptor_nombre: 'Farmacia Ejemplo',
  receptor_nif: '99999901H',
  numero: 'LI-26-0398',
  numero_evidencia: 'e',
  fecha_emision: '2026-10-02',
  fecha_emision_evidencia: 'e',
  lineas_impuesto: [
    { base: '100.00', tipo_iva: '4', cuota_iva: '4.00', tipo_re: '0.5', cuota_re: '0.50', evidencia: 'e' },
    { base: '10.00', tipo_iva: '21', cuota_iva: '2.10', tipo_re: '5.2', cuota_re: '0.52', evidencia: 'e' },
  ],
  retenciones_irpf: [],
  otros_conceptos: [{ concepto: 'Gastos bancarios', importe: '1.09', evidencia: 'e' }],
  total_factura: '117.12',
  total_factura_evidencia: 'e',
  total_a_pagar: '118.21',
  total_a_pagar_evidencia: 'e',
  moneda: 'EUR',
  vencimientos: [{ fecha: '2026-12-01', importe: '118.21', evidencia: 'e' }],
  forma_pago: 'giro',
  iban_proveedor: '',
  pedidos: [],
  albaranes: [],
  factura_rectificada: '',
  notas: '',
} satisfies SalidaModelo;

const CTX = {
  empresas: [{ id: 'principal', nif: '99999901H', regimenIva: 'recargo_equivalencia' }],
  hoy: fechaLocal('2026-10-20'),
  antiguedadMaximaDias: 400,
  toleranciaCuadreCentimos: 2,
  comprobacion: null,
  proveedorConocido: () => true,
  posibleDuplicadoDe: null,
} satisfies ContextoValidacion;

const reglas = (s: SalidaModelo, ctx: ContextoValidacion = CTX) => validar(desdeModelo(s), ctx).resultados;
const bloquea = (s: SalidaModelo, ctx?: ContextoValidacion): IdRegla[] => reglas(s, ctx).filter((r) => r.gravedad === 'bloquea').map((r) => r.regla);
const avisa = (s: SalidaModelo, ctx?: ContextoValidacion): IdRegla[] => reglas(s, ctx).filter((r) => r.gravedad === 'aviso').map((r) => r.regla);

describe('la factura buena', () => {
  it('pasa sin bloqueos ni avisos, y se asigna a su empresa', () => {
    expect(validar(desdeModelo(BUENA), CTX)).toEqual({ resultados: [], empresaId: 'principal' });
  });
});

describe('lectura', () => {
  it('ilegible', () => expect(bloquea({ ...BUENA, legible: false })).toEqual(['ilegible']));
  it('un dato que no se puede interpretar', () => expect(bloquea({ ...BUENA, total_a_pagar: 'ciento dieciocho' })).toContain('datos_ininterpretables'));
  it.each([
    ['emisor_nif', { emisor_nif: '' }, /NIF del emisor/],
    ['numero', { numero: '' }, /número/],
    ['fecha', { fecha_emision: '' }, /fecha de emisión/],
    ['líneas', { lineas_impuesto: [] }, /líneas de impuesto/],
    ['total a pagar', { total_a_pagar: '' }, /total a pagar/],
  ])('sin %s: obligatorios', (_c, cambio, mensaje) => {
    const r = reglas({ ...BUENA, ...cambio }).find((x) => x.regla === 'obligatorios');
    expect(r?.mensaje).toMatch(mensaje);
  });
  it('sin líneas pero todo no sujeto y total de factura 0 (factura de gastos bancarios): pasa', () => {
    expect(
      bloquea({ ...BUENA, lineas_impuesto: [], total_factura: '0', otros_conceptos: [{ concepto: 'Gastos bancarios', importe: '-3.06', evidencia: 'e' }], total_a_pagar: '-3.06', vencimientos: [] }),
    ).toEqual([]);
  });
  it('NIF del emisor con el control mal', () => expect(bloquea({ ...BUENA, emisor_nif: 'B99999170' })).toEqual(['nif_emisor']));
});

describe('de qué empresa es', () => {
  const ASESORIA = {
    ...CTX,
    empresas: [
      { id: 'cliente-001', nif: 'B99999021', regimenIva: 'general' },
      { id: 'cliente-002', nif: 'B99999047', regimenIva: 'general' },
    ],
  } satisfies ContextoValidacion;
  const SIN_RE = { ...BUENA, lineas_impuesto: [{ base: '100.00', tipo_iva: '21', cuota_iva: '21.00', tipo_re: '0', cuota_re: '0', evidencia: 'e' }], total_factura: '121.00', total_a_pagar: '122.09', vencimientos: [] } satisfies SalidaModelo;

  it('por el NIF del receptor', () => expect(validar(desdeModelo({ ...SIN_RE, receptor_nif: 'B99999047' }), ASESORIA).empresaId).toBe('cliente-002'));
  it('receptor que no es empresa del cliente: bloquea (negocio)', () => {
    const r = reglas({ ...SIN_RE, receptor_nif: 'B99999039' }, ASESORIA).find((x) => x.regla === 'receptor_desconocido');
    expect(r).toMatchObject({ gravedad: 'bloquea', origen: 'negocio' });
  });
  it('sin NIF del receptor y varias empresas: no se puede saber', () => expect(bloquea({ ...SIN_RE, receptor_nif: '' }, ASESORIA)).toEqual(['empresa_sin_determinar']));
  it('sin NIF del receptor y una sola empresa: se asigna, con aviso', () => {
    expect(avisa({ ...BUENA, receptor_nif: '' })).toEqual(['receptor_sin_nif']);
    expect(validar(desdeModelo({ ...BUENA, receptor_nif: '' }), CTX).empresaId).toBe('principal');
  });
  it('buzón de una empresa y el receptor es otra: bloquea', () => {
    expect(bloquea({ ...SIN_RE, receptor_nif: 'B99999047' }, { ...ASESORIA, empresaDelBuzon: 'cliente-001' })).toEqual(['receptor_no_coincide']);
  });
});

describe('cuadre', () => {
  it('una línea de impuesto olvidada no cuadra', () => expect(bloquea({ ...BUENA, lineas_impuesto: BUENA.lineas_impuesto.slice(0, 1) })).toContain('cuadre'));
  it('el total impreso con 10 € de más (caso 09 del juego)', () => expect(bloquea({ ...BUENA, total_factura: '127.12', total_a_pagar: '128.21', vencimientos: [] })).toEqual(['cuadre']));
  it('un concepto no sujeto contado dos veces (caso real: costes logísticos ya dentro de las bases)', () =>
    expect(bloquea({ ...BUENA, otros_conceptos: [...BUENA.otros_conceptos, { concepto: 'Coste logístico', importe: '4.34', evidencia: 'e' }] })).toEqual(['cuadre']));
  it('un céntimo de redondeo no bloquea', () => expect(bloquea({ ...BUENA, total_factura: '117.13', total_a_pagar: '118.22', vencimientos: [] })).toEqual([]));
  it('una fianza que deja el total a pagar por debajo de la base: pasa', () =>
    expect(bloquea({ ...BUENA, otros_conceptos: [{ concepto: 'Fianza', importe: '-50.00', evidencia: 'e' }], total_a_pagar: '67.12', vencimientos: [] })).toEqual([]));
  it('sin total de factura impreso: lo calcula el código y el cuadre va contra el total a pagar', () => {
    expect(bloquea({ ...BUENA, total_factura: '' })).toEqual([]);
    expect(bloquea({ ...BUENA, total_factura: '', total_a_pagar: '200.00', vencimientos: [] })).toEqual(['cuadre']);
  });
  it('con retención de IRPF', () => {
    const profesional = {
      ...BUENA,
      lineas_impuesto: [{ base: '180.00', tipo_iva: '21', cuota_iva: '37.80', tipo_re: '0', cuota_re: '0', evidencia: 'e' }],
      retenciones_irpf: [{ base: '180.00', tipo: '15', cuota: '27.00', evidencia: 'e' }],
      otros_conceptos: [],
      total_factura: '190.80',
      total_a_pagar: '190.80',
      vencimientos: [],
    } satisfies SalidaModelo;
    expect(bloquea(profesional)).toEqual([]);
    expect(bloquea({ ...profesional, retenciones_irpf: [] })).toContain('cuadre');
  });
});

describe('cada línea', () => {
  it('cuota que no corresponde a base × tipo', () =>
    expect(bloquea({ ...BUENA, lineas_impuesto: [{ base: '100.00', tipo_iva: '4', cuota_iva: '10.00', tipo_re: '0.5', cuota_re: '0.50', evidencia: 'e' }, { base: '10.00', tipo_iva: '21', cuota_iva: '2.10', tipo_re: '5.2', cuota_re: '0.52', evidencia: 'e' }], total_factura: '123.12', total_a_pagar: '124.21', vencimientos: [] })).toContain('cuota_linea'));
  it('una cuota sumada producto a producto (unos céntimos sobre una base grande): pasa', () =>
    expect(
      bloquea({ ...BUENA, lineas_impuesto: [{ base: '9807.46', tipo_iva: '4', cuota_iva: '392.33', tipo_re: '0.5', cuota_re: '49.04', evidencia: 'e' }], otros_conceptos: [], total_factura: '10248.83', total_a_pagar: '10248.83', vencimientos: [] }),
    ).toEqual([]));
  it('un tipo de IVA que no existe', () =>
    expect(bloquea({ ...BUENA, lineas_impuesto: [{ base: '100.00', tipo_iva: '16', cuota_iva: '16.00', tipo_re: '0', cuota_re: '0', evidencia: 'e' }], otros_conceptos: [], total_factura: '116.00', total_a_pagar: '116.00', vencimientos: [] })).toEqual(['tipo_impositivo']));
  it('un recargo que no corresponde a su IVA (caso real: 0,4 % leído por 1,4 %)', () =>
    expect(bloquea({ ...BUENA, lineas_impuesto: [{ base: '20.07', tipo_iva: '10', cuota_iva: '2.01', tipo_re: '0.4', cuota_re: '0.08', evidencia: 'e' }], otros_conceptos: [], total_factura: '22.16', total_a_pagar: '22.16', vencimientos: [] })).toEqual(['tipo_impositivo']));
  it('en recargo de equivalencia, un suministro sin recargo (la luz): pasa', () =>
    expect(bloquea({ ...BUENA, lineas_impuesto: [{ base: '100.00', tipo_iva: '21', cuota_iva: '21.00', tipo_re: '0', cuota_re: '0', evidencia: 'e' }], otros_conceptos: [], total_factura: '121.00', total_a_pagar: '121.00', vencimientos: [] })).toEqual([]));
});

describe('signo', () => {
  const negativa = { ...BUENA, lineas_impuesto: [{ base: '-100.00', tipo_iva: '4', cuota_iva: '-4.00', tipo_re: '0.5', cuota_re: '-0.50', evidencia: 'e' }], otros_conceptos: [], total_factura: '-104.50', total_a_pagar: '-104.50', vencimientos: [] } satisfies SalidaModelo;
  it('negativa y rectificativa: pasa', () => expect(bloquea({ ...negativa, tipo: 'rectificativa' })).toEqual([]));
  it('negativa y no rectificativa: bloquea', () => expect(bloquea(negativa)).toEqual(['signo']));
  it('rectificativa positiva: aviso', () => expect(avisa({ ...BUENA, tipo: 'rectificativa' })).toEqual(['rectificativa_positiva']));
});

describe('fechas', () => {
  it('futura: bloquea', () => expect(bloquea({ ...BUENA, fecha_emision: '2026-12-15' })).toEqual(['fecha_futura']));
  it('demasiado antigua (2023 por 2026): bloquea', () => expect(bloquea({ ...BUENA, fecha_emision: '2023-05-05' })).toEqual(['fecha_antigua']));
  it('vencimiento anterior a la emisión (pago anticipado real): sólo aviso', () => {
    const s = { ...BUENA, vencimientos: [{ fecha: '2026-09-01', importe: '118.21', evidencia: 'e' }] } satisfies SalidaModelo;
    expect(bloquea(s)).toEqual([]);
    expect(avisa(s)).toEqual(['vencimiento_anterior']);
  });
  it('plazos que no suman el total a pagar: aviso', () =>
    expect(avisa({ ...BUENA, vencimientos: [{ fecha: '2026-11-01', importe: '50.00', evidencia: 'e' }, { fecha: '2026-12-01', importe: '50.00', evidencia: 'e' }] })).toEqual(['vencimientos_no_suman']));
});

describe('valores contra el documento', () => {
  const con = (campos: NonNullable<Extract<Comprobacion, { comprobable: true }>['campos']>, conocido = true): ContextoValidacion => ({
    ...CTX,
    comprobacion: { comprobable: true, campos },
    proveedorConocido: () => conocido,
  });
  it('un vencimiento que no está en el documento: bloquea', () =>
    expect(bloquea(BUENA, con({ numero: 'encontrado', vencimiento_0: 'no_encontrado' }))).toEqual(['valor_no_en_documento']));
  it('NIF del emisor fuera del texto (en una imagen), proveedor conocido: pasa', () => expect(bloquea(BUENA, con({ emisor_nif: 'no_encontrado' }, true))).toEqual([]));
  it('NIF del emisor fuera del texto y proveedor nuevo: a revisión (negocio)', () =>
    expect(reglas(BUENA, con({ emisor_nif: 'no_encontrado' }, false)).find((r) => r.regla === 'nif_no_verificable')).toMatchObject({ gravedad: 'bloquea', origen: 'negocio' }));
  it('escaneo u OCR (no comprobable): no bloquea por esto', () => expect(bloquea(BUENA, { ...CTX, comprobacion: { comprobable: false } })).toEqual([]));
});

describe('duplicados y proveedores', () => {
  it('posible duplicado: bloquea (negocio)', () => expect(bloquea(BUENA, { ...CTX, posibleDuplicadoDe: 'doc-1' })).toEqual(['posible_duplicado']));
  it('proveedor nuevo: sólo aviso', () => expect(avisa(BUENA, { ...CTX, proveedorConocido: () => false })).toEqual(['proveedor_nuevo']));
});

describe('decidir', () => {
  it('sin bloqueos: registrar, con los avisos', () => expect(decidir(validar(desdeModelo({ ...BUENA, receptor_nif: '' }), CTX), true)).toMatchObject({ tipo: 'registrar', avisos: [{ regla: 'receptor_sin_nif' }] }));
  it('bloqueo de lectura y queda segundo intento: segundo intento', () => expect(decidir(validar(desdeModelo({ ...BUENA, legible: false }), CTX), true).tipo).toBe('segundo_intento'));
  it('bloqueo de lectura sin segundo intento: revisión', () => expect(decidir(validar(desdeModelo({ ...BUENA, legible: false }), CTX), false).tipo).toBe('revision'));
  it('bloqueo de negocio: revisión directa (otro modelo leería lo mismo)', () =>
    expect(decidir(validar(desdeModelo(BUENA), { ...CTX, posibleDuplicadoDe: 'doc-1' }), true)).toMatchObject({ tipo: 'revision', motivos: [{ regla: 'posible_duplicado' }] }));
  it('mezcla de lectura y negocio: revisión (la tiene que ver una persona de todas formas)', () =>
    expect(decidir(validar(desdeModelo({ ...BUENA, legible: false }), { ...CTX, posibleDuplicadoDe: 'doc-1' }), true).tipo).toBe('revision'));
});

describe('importe de cada plazo (fase 12: desconocido no es cero)', () => {
  const dos = (a: string, b: string) => ({ ...BUENA, vencimientos: [{ fecha: '2026-11-01', importe: a, evidencia: 'e' }, { fecha: '2026-12-01', importe: b, evidencia: 'e' }] });

  it('varios plazos con todos sus importes: pasa', () => {
    expect(bloquea(dos('100.00', '18.21'))).toEqual([]);
  });

  it('varios plazos y a uno le falta el importe: bloquea (se guardaría 0 € y nadie lo pagaría)', () => {
    expect(bloquea(dos('100.00', ''))).toEqual(['importe_plazo']);
    expect(reglas(dos('', '')).find((r) => r.regla === 'importe_plazo')?.mensaje).toBe('falta el importe del plazo 1, 2 de 2');
  });

  it('un solo plazo sin importe: pasa (es el total a pagar)', () => {
    expect(bloquea({ ...BUENA, vencimientos: [{ fecha: '2026-12-01', importe: '', evidencia: 'e' }] })).toEqual([]);
  });

  it('es de extracción: otro modelo puede leer el importe', () => {
    expect(reglas(dos('100.00', '')).find((r) => r.regla === 'importe_plazo')?.origen).toBe('extraccion');
  });
});

describe('moneda (fase 12: sólo euros)', () => {
  const con = (total: string, linea = 'Base 100,00') => ({
    ...BUENA,
    total_a_pagar_evidencia: total,
    moneda: '',
    total_factura_evidencia: total,
    lineas_impuesto: BUENA.lineas_impuesto.map((l) => ({ ...l, evidencia: linea })),
  });

  it('importes en euros, con «€», «EUR» o sin símbolo: pasa', () => {
    expect(bloquea(con('TOTAL 118,21 €'))).toEqual([]);
    expect(bloquea(con('Total EUR 118.21'))).toEqual([]);
    expect(bloquea(con('TOTAL A PAGAR 118,21'))).toEqual([]);
  });

  it('en dólares, libras o con el código de otra moneda: bloquea y lo dice', () => {
    expect(bloquea(con('Total $118.21'))).toEqual(['moneda_no_soportada']);
    expect(bloquea(con('Amount due: 118.21 USD'))).toEqual(['moneda_no_soportada']);
    expect(bloquea(con('Total £118.21'))).toEqual(['moneda_no_soportada']);
    expect(reglas(con('Total $118.21')).find((r) => r.regla === 'moneda_no_soportada')?.mensaje).toBe('la factura parece estar en USD: sólo se registran facturas en euros');
  });

  it('si algún importe está en euros, no bloquea (un «$» suelto en un concepto no es la moneda)', () => {
    expect(bloquea(con('Total $118.21', 'Base 100,00 €'))).toEqual([]);
  });

  it('una palabra que contiene un código (p. ej. «CADUCA») no es una moneda', () => {
    expect(bloquea(con('TOTAL 118,21 CADUCA 01/12'))).toEqual([]);
  });

  describe('con la moneda leída', () => {
    const IRLANDA = 'IE6388047V';
    const conMoneda = (moneda: string, total = 'Total 118,21', emisor_nif = BUENA.emisor_nif) => ({ ...con(total), moneda, emisor_nif });

    it('otra moneda bloquea aunque los importes no lleven símbolo: «All amounts in USD» sólo en la cabecera', () => {
      expect(bloquea(conMoneda('USD'))).toEqual(['moneda_no_soportada']);
      expect(bloquea(conMoneda('usd'))).toEqual(['moneda_no_soportada']);
      expect(bloquea(conMoneda('BRL'))).toEqual(['moneda_no_soportada']);
    });

    it('EUR pasa, salvo que los importes digan otra cosa: la lectura no tapa la evidencia', () => {
      expect(bloquea(conMoneda('EUR'))).toEqual([]);
      expect(bloquea(conMoneda('€'))).toEqual([]);
      expect(bloquea(conMoneda('EUR', 'Total $118.21'))).toEqual(['moneda_no_soportada']);
    });

    it('sin moneda y de un proveedor español: se registra, avisando (se cuenta, no se bloquea)', () => {
      expect(bloquea(conMoneda(''))).toEqual([]);
      expect(reglas(conMoneda('')).find((r) => r.regla === 'moneda_sin_identificar')?.gravedad).toBe('aviso');
    });

    it('sin moneda y de un proveedor de otro país: a una persona, que lo puede aceptar', () => {
      const f = conMoneda('', 'Total 118,21', IRLANDA);
      expect(bloquea(f)).toContain('moneda_sin_identificar');
      expect(reglas(f).find((r) => r.regla === 'moneda_sin_identificar')).toMatchObject({ gravedad: 'bloquea', origen: 'negocio' });
      expect(bloqueosQueNoSeAceptan(reglas(f).filter((r) => r.regla === 'moneda_sin_identificar'))).toEqual([]);
    });

    it('sin el campo pero con «€» en los importes: es euro, sea de donde sea el proveedor', () => {
      expect(reglas(conMoneda('', 'Total 118,21 €', IRLANDA)).find((r) => r.regla === 'moneda_sin_identificar')).toBeUndefined();
    });

    it('la moneda extranjera no se acepta confirmando: se resuelve cambiando el dato', () => {
      expect(bloqueosQueNoSeAceptan(reglas(conMoneda('USD')).filter((r) => r.gravedad === 'bloquea')).map((r) => r.regla)).toEqual(['moneda_no_soportada']);
    });
  });

  it('es de negocio: va directo a una persona (otro modelo leería lo mismo)', () => {
    expect(reglas(con('Total $118.21')).find((r) => r.regla === 'moneda_no_soportada')?.origen).toBe('negocio');
  });
});

describe('IBAN (fase 16)', () => {
  it('válido o sin IBAN: pasa', () => {
    expect(bloquea({ ...BUENA, iban_proveedor: 'ES3699990006006666666666' })).toEqual([]);
    expect(bloquea({ ...BUENA, iban_proveedor: '' })).toEqual([]);
  });
  it('una cifra de más o cambiada: bloquea, de extracción (otro modelo puede leerlo bien)', () => {
    expect(bloquea({ ...BUENA, iban_proveedor: 'ES36999900060066666666666' })).toEqual(['iban_invalido']);
    expect(bloquea({ ...BUENA, iban_proveedor: 'ES3699990006006666666667' })).toEqual(['iban_invalido']);
    expect(reglas({ ...BUENA, iban_proveedor: 'ES3699990006006666666667' }).find((r) => r.regla === 'iban_invalido')?.origen).toBe('extraccion');
  });
  it('enmascarado («…****»): no bloquea', () => {
    expect(bloquea({ ...BUENA, iban_proveedor: 'ES2199990921009292****' })).toEqual([]);
  });
});
