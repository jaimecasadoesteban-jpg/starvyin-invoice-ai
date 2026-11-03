import { describe, expect, it } from 'vitest';

import { extraerNif, NIF_EMISOR_GUARDADO, normalizarNif, pareceDeEjemplo, validarIvaUe, validarNif, validarNifEmisor } from '../../src/core/nif.js';

describe('validarNif', () => {
  it.each([
    ['12345678Z', 'dni'],
    ['99999901H', 'dni'], // del juego de pruebas
    ['X1234567L', 'nie'],
    ['B99999021', 'cif'], // del juego de pruebas
    ['F99999112', 'cif'],
    ['A12345674', 'cif'],
    ['P1234567D', 'cif'], // P exige control con letra
  ])('%s es un %s válido', (nif, tipo) => {
    expect(validarNif(nif)).toEqual({ valido: true, nif, tipo });
  });

  it.each([
    ['12345678A', 'control'],
    ['X1234567A', 'control'],
    ['B99999170', 'control'], // el «NIF erróneo» del caso 11 del juego (el bueno es B99999179)
    ['A1234567D', 'control'], // A exige control con número
    ['P12345674', 'control'], // P exige control con letra
    ['1234567Z', 'formato'],
    ['I1234567A', 'formato'], // la I no es letra de CIF
    ['', 'formato'],
  ])('%s no es válido (%s)', (nif, motivo) => {
    expect(validarNif(nif)).toMatchObject({ valido: false, motivo });
  });

  it('normaliza antes de validar: espacios, guiones, minúsculas y prefijo ES', () => {
    expect(validarNif(' es-b 9999 9021 ')).toEqual({ valido: true, nif: 'B99999021', tipo: 'cif' });
    expect(normalizarNif('ES12345678Z')).toBe('12345678Z');
  });

  it('reconoce los NIF del rango de ejemplo', () => {
    expect(pareceDeEjemplo('99999901H')).toBe(true);
    expect(pareceDeEjemplo('B99999021')).toBe(true);
    expect(pareceDeEjemplo('12345678Z')).toBe(false);
  });
});

describe('NIF-IVA de otros países de la UE (fase 19): sólo para el emisor', () => {
  it.each([
    ['IE9999990WA'], // irlandés: 7 cifras y dos letras
    ['IE9Z99999W'], // irlandés antiguo
    ['NL999999999B01'],
    ['DE999999999'],
    ['FR9X999999999'],
    ['ATU99999999'],
    ['LU99999999'],
  ])('%s: formato de su país', (nif) => {
    expect(validarIvaUe(nif)).toEqual({ valido: true, nif, tipo: 'ue' });
    expect(validarNifEmisor(nif).valido).toBe(true);
    expect(NIF_EMISOR_GUARDADO.test(nif)).toBe(true);
  });

  it.each([
    ['NL999999999', 'falta el B01'],
    ['DE99999999', 'una cifra de menos'],
    ['IE99999WA', 'irlandés corto'],
    ['US999999999', 'no es de la UE'],
    ['XX999999999', 'país que no existe'],
  ])('%s no vale (%s)', (nif) => {
    expect(validarIvaUe(nif).valido).toBe(false);
    expect(validarNifEmisor(nif).valido).toBe(false);
  });

  it('España no entra por aquí: un NIF español con el control mal sigue sin valer (y no se cuela como europeo)', () => {
    expect(validarIvaUe('ESB99999021').valido).toBe(false);
    expect(validarNifEmisor('B99999170')).toMatchObject({ valido: false, motivo: 'control' });
  });

  it('las empresas del cliente siguen siendo sólo españolas: validarNif no acepta un NIF europeo', () => {
    expect(validarNif('IE9999990WA').valido).toBe(false);
  });

  it('normaliza: espacios y guiones fuera; «GR» de Grecia pasa a «EL», como en el VIES', () => {
    expect(validarNifEmisor('ie 9999990 wa')).toMatchObject({ valido: true, nif: 'IE9999990WA' });
    expect(validarNifEmisor('GR999999999')).toMatchObject({ valido: true, nif: 'EL999999999' });
  });

  it('extraerNif saca el europeo de un texto con la etiqueta o algo pegado', () => {
    expect(extraerNif('VAT No.: IE9999990WA')).toBe('IE9999990WA');
    expect(extraerNif('BTW/VAT ID NL999999999B01')).toBe('NL999999999B01');
    expect(extraerNif('B99999021')).toBe('B99999021');
  });
});
