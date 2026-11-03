import { describe, expect, it } from 'vitest';

import { ESTADOS, FINALES, transicionar, type EstadoDocumento, type Evento, type TipoEvento } from '../../src/core/estado-documento.js';

/** Un evento de ejemplo de cada tipo. */
const EVENTOS = {
  descartar_sin_modelo: { tipo: 'descartar_sin_modelo', razon: 'imagen de 140×42 sin texto' },
  detectar_duplicado: { tipo: 'detectar_duplicado', originalId: 'doc-original' },
  formato_no_soportado: { tipo: 'formato_no_soportado', formato: 'docx' },
  no_es_factura: { tipo: 'no_es_factura' },
  extraccion_ok: { tipo: 'extraccion_ok' },
  extraccion_fallida: { tipo: 'extraccion_fallida', intentos: 1, maximo: 3, error: 'tiempo agotado' },
  validacion_ok: { tipo: 'validacion_ok' },
  validacion_bloquea: { tipo: 'validacion_bloquea', reglas: ['cuadre'] },
  revision_registrar: { tipo: 'revision_registrar' },
  revision_no_factura: { tipo: 'revision_no_factura' },
  revision_duplicado: { tipo: 'revision_duplicado', originalId: 'doc-original' },
  revision_pedir_reenvio: { tipo: 'revision_pedir_reenvio', razon: 'foto ilegible' },
  revision_volver_a_leer: { tipo: 'revision_volver_a_leer' },
  reenviado: { tipo: 'reenviado', nuevoId: 'doc-nuevo' },
} satisfies { [K in TipoEvento]: Extract<Evento, { tipo: K }> };

/** LA tabla de transiciones válidas. Todo lo que no está aquí tiene que ser inválido. */
const VALIDAS: readonly (readonly [EstadoDocumento, TipoEvento, EstadoDocumento])[] = [
  ['recibido', 'descartar_sin_modelo', 'descartado'],
  ['recibido', 'detectar_duplicado', 'duplicado'],
  ['extraido', 'detectar_duplicado', 'duplicado'],
  ['recibido', 'formato_no_soportado', 'en_revision'],
  ['recibido', 'no_es_factura', 'no_factura'],
  ['error_extraccion', 'no_es_factura', 'no_factura'],
  ['recibido', 'extraccion_ok', 'extraido'],
  ['error_extraccion', 'extraccion_ok', 'extraido'],
  ['recibido', 'extraccion_fallida', 'error_extraccion'],
  ['error_extraccion', 'extraccion_fallida', 'error_extraccion'],
  ['extraido', 'validacion_ok', 'registrada'],
  ['extraido', 'validacion_bloquea', 'en_revision'],
  ['en_revision', 'revision_registrar', 'registrada'],
  ['en_revision', 'revision_no_factura', 'no_factura'],
  ['en_revision', 'revision_duplicado', 'duplicado'],
  ['en_revision', 'revision_pedir_reenvio', 'pendiente_reenvio'],
  ['en_revision', 'revision_volver_a_leer', 'recibido'],
  ['pendiente_reenvio', 'reenviado', 'sustituido'],
];

describe('transicionar', () => {
  it.each(VALIDAS)('%s --%s--> %s', (de, evento, a) => {
    expect(transicionar(de, EVENTOS[evento])).toMatchObject({ ok: true, a });
  });

  const TODAS = ESTADOS.flatMap((de) => (Object.keys(EVENTOS) as TipoEvento[]).map((evento) => [de, evento] as const));
  const INVALIDAS = TODAS.filter(([de, evento]) => !VALIDAS.some(([d, e]) => d === de && e === evento));

  it('la tabla cubre todas las combinaciones (si no, este test no vigila nada)', () => {
    expect(TODAS.length).toBe(ESTADOS.length * Object.keys(EVENTOS).length);
    expect(INVALIDAS.length).toBe(TODAS.length - VALIDAS.length);
  });

  it.each(INVALIDAS)('%s no admite %s', (de, evento) => {
    expect(transicionar(de, EVENTOS[evento])).toEqual({ ok: false, error: 'transicion_invalida', de, evento });
  });

  it('de los estados finales no se sale con ningún evento', () => {
    for (const final of FINALES) {
      for (const evento of Object.values(EVENTOS)) expect(transicionar(final, evento).ok).toBe(false);
    }
  });
});

describe('ningún documento termina en silencio', () => {
  it('en revisión lleva siempre los motivos (las reglas que bloquearon)', () => {
    expect(transicionar('extraido', { tipo: 'validacion_bloquea', reglas: ['cuadre', 'nif_emisor'] })).toMatchObject({
      a: 'en_revision',
      motivos: ['cuadre', 'nif_emisor'],
    });
  });

  it('un formato que no se sabe leer va a revisión, no se descarta', () => {
    expect(transicionar('recibido', EVENTOS.formato_no_soportado)).toMatchObject({ a: 'en_revision', motivos: ['formato no soportado: docx'] });
  });

  it('un error de extracción reintenta mientras quedan intentos…', () => {
    expect(transicionar('error_extraccion', { tipo: 'extraccion_fallida', intentos: 2, maximo: 3, error: 'caído' })).toMatchObject({
      a: 'error_extraccion',
    });
  });

  it('…y al agotarlos pasa a revisión, no se queda en error para siempre', () => {
    expect(transicionar('error_extraccion', { tipo: 'extraccion_fallida', intentos: 3, maximo: 3, error: 'caído' })).toMatchObject({
      a: 'en_revision',
      motivos: ['extracción fallida 3 veces: caído'],
    });
  });

  it('un duplicado dice de qué es duplicado', () => {
    expect(transicionar('recibido', EVENTOS.detectar_duplicado)).toMatchObject({ a: 'duplicado', duplicadoDe: 'doc-original' });
    expect(transicionar('en_revision', EVENTOS.revision_duplicado)).toMatchObject({ a: 'duplicado', duplicadoDe: 'doc-original' });
  });

  it('validar algo que no está extraído es un error, no un registro', () => {
    expect(transicionar('recibido', EVENTOS.validacion_ok).ok).toBe(false);
  });
});
