import { describe, expect, it } from 'vitest';

import { validarIban } from '../../src/core/iban.js';

/** IBAN ficticios (generados con su control correcto, como los del juego de pruebas). */
const BUENO = 'ES3699990006006666666666';

describe('validarIban', () => {
  it('uno bueno, con o sin espacios, en mayúsculas o minúsculas', () => {
    expect(validarIban(BUENO)).toEqual({ valido: true, iban: BUENO });
    expect(validarIban('es36 9999 0006 0066 6666 6666').valido).toBe(true);
  });

  it('una cifra de más o de menos (lo que pasa en fotos con «666666»): longitud', () => {
    expect(validarIban(`${BUENO}6`)).toEqual({ valido: false, motivo: 'longitud' });
    expect(validarIban(BUENO.slice(0, -1))).toEqual({ valido: false, motivo: 'longitud' });
  });

  it('una cifra cambiada o dos traspuestas: control', () => {
    expect(validarIban('ES3699990006006666666667')).toEqual({ valido: false, motivo: 'control' });
    expect(validarIban('ES3699990006006666666656')).toEqual({ valido: false, motivo: 'control' });
  });

  it('enmascarado (la cuenta del cliente impresa a medias): ni válido ni error de lectura', () => {
    expect(validarIban('ES2199990921009292****')).toEqual({ valido: false, motivo: 'enmascarado' });
    expect(validarIban('ES21 9999 0921 XXXX XXXX 9292')).toEqual({ valido: false, motivo: 'enmascarado' });
  });

  it('otro país con su longitud; basura, formato', () => {
    expect(validarIban('DE89370400440532013000').valido).toBe(true); // el de ejemplo de la norma
    expect(validarIban('no es un iban').valido).toBe(false);
  });
});
