import { describe, expect, it } from 'vitest';

import { estadoDePago, type OpcionesPago } from '../../src/core/estado-pago.js';
import { diaLocal, diasEntre, fechaLocal, zonaValida } from '../../src/core/fechas.js';

describe('fechas', () => {
  it('fechaLocal rechaza formatos y fechas que no existen', () => {
    expect(fechaLocal('2026-10-25')).toBe('2026-10-25');
    expect(() => fechaLocal('25/10/2026')).toThrow(/formato/);
    expect(() => fechaLocal('2026-02-31')).toThrow(/inexistente/);
    expect(() => fechaLocal('2026-13-01')).toThrow(/inexistente/);
  });

  it('el día de hoy depende de la zona del cliente: medianoche en Madrid no es medianoche en UTC', () => {
    // 22:30 UTC del 24 = 00:30 del 25 en Madrid (horario de verano, UTC+2).
    expect(diaLocal(new Date('2026-10-24T22:30:00Z'), 'Europe/Madrid')).toBe('2026-10-25');
    expect(diaLocal(new Date('2026-10-24T21:59:59Z'), 'Europe/Madrid')).toBe('2026-10-24');
  });

  it('Canarias va una hora por detrás: el mismo instante puede ser otro día', () => {
    const instante = new Date('2026-10-24T22:30:00Z');
    expect(diaLocal(instante, 'Atlantic/Canary')).toBe('2026-10-24');
    expect(diaLocal(instante, 'Europe/Madrid')).toBe('2026-10-25');
  });

  it('el cambio de hora (25-10-2026) no rompe la cuenta de días', () => {
    expect(diasEntre(fechaLocal('2026-10-24'), fechaLocal('2026-10-26'))).toBe(2);
    expect(diasEntre(fechaLocal('2026-03-28'), fechaLocal('2026-03-30'))).toBe(2);
    expect(diasEntre(fechaLocal('2026-10-26'), fechaLocal('2026-10-24'))).toBe(-2);
  });

  it('valida zonas horarias (una mal escrita en el YAML no arranca)', () => {
    expect(zonaValida('Europe/Madrid')).toBe(true);
    expect(zonaValida('Europa/Madrid')).toBe(false);
  });
});

describe('estadoDePago (calculado al leer, nunca guardado)', () => {
  const HOY = fechaLocal('2026-10-20');
  const OPCIONES = { diasVencePronto: 7, domiciliadosPagadosAlVencer: true } satisfies OpcionesPago;
  const plazo = (fecha: string, estado: 'pendiente' | 'pagado' | 'domiciliado' = 'pendiente') => ({ fecha: fechaLocal(fecha), estado });

  it.each([
    ['2026-11-30', { estado: 'pendiente', dias: 41 }],
    ['2026-10-27', { estado: 'vence_pronto', dias: 7 }],
    ['2026-10-21', { estado: 'vence_pronto', dias: 1 }],
    ['2026-10-20', { estado: 'vence_hoy' }],
    ['2026-10-19', { estado: 'vencido', diasDeRetraso: 1 }],
  ])('pendiente con vencimiento %s → %o', (fecha, esperado) => {
    expect(estadoDePago(plazo(fecha), HOY, OPCIONES)).toEqual(esperado);
  });

  it('pagado es pagado, aunque la fecha haya pasado', () => {
    expect(estadoDePago(plazo('2026-01-01', 'pagado'), HOY, OPCIONES)).toEqual({ estado: 'pagado' });
  });

  describe('domiciliados', () => {
    it('antes de su fecha: pendiente de cargo, con los días', () => {
      expect(estadoDePago(plazo('2026-10-25', 'domiciliado'), HOY, OPCIONES)).toEqual({ estado: 'domiciliado_pendiente', dias: 5 });
    });

    it('el día del vencimiento y después: se da por cargado', () => {
      expect(estadoDePago(plazo('2026-10-20', 'domiciliado'), HOY, OPCIONES)).toEqual({ estado: 'domiciliado_cargado' });
      expect(estadoDePago(plazo('2026-10-01', 'domiciliado'), HOY, OPCIONES)).toEqual({ estado: 'domiciliado_cargado' });
    });

    it('si el cliente no quiere darlos por pagados, uno pasado de fecha cuenta como vencido', () => {
      const sinAuto = { ...OPCIONES, domiciliadosPagadosAlVencer: false };
      expect(estadoDePago(plazo('2026-10-19', 'domiciliado'), HOY, sinAuto)).toEqual({ estado: 'vencido', diasDeRetraso: 1 });
      expect(estadoDePago(plazo('2026-10-20', 'domiciliado'), HOY, sinAuto)).toEqual({ estado: 'domiciliado_pendiente', dias: 0 });
    });
  });

  it('el mismo plazo cambia de estado con el día, sin que nadie escriba nada', () => {
    const p = plazo('2026-10-25');
    expect(estadoDePago(p, fechaLocal('2026-10-24'), OPCIONES).estado).toBe('vence_pronto');
    expect(estadoDePago(p, fechaLocal('2026-10-25'), OPCIONES).estado).toBe('vence_hoy');
    expect(estadoDePago(p, fechaLocal('2026-10-26'), OPCIONES).estado).toBe('vencido');
  });
});
