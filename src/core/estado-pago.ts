import { diasEntre, type FechaLocal } from './fechas.js';

/**
 * Estado de pago de un plazo (vencimiento), **calculado al leer**.
 *
 * En la base sólo se guarda lo que alguien afirma: `pendiente`, `pagado` (con su
 * fecha) o `domiciliado`. «Vencido» y «vence pronto» dependen de qué día es hoy
 * y no se guardan nunca: si se guardaran, los escribiría un cron, y el día que
 * el cron no corriera una factura pagada seguiría «vencida» o una vencida
 * seguiría «pendiente» (docs/ENGINEERING_RULES.md, regla 8).
 *
 * los recibos domiciliados se dan por pagados al llegar su fecha
 * (configurable por cliente), hasta que exista la conciliación bancaria.
 */

export type EstadoGuardado = 'pendiente' | 'pagado' | 'domiciliado';

export interface Plazo {
  readonly fecha: FechaLocal;
  readonly estado: EstadoGuardado;
}

export interface OpcionesPago {
  /** «Vence pronto» si faltan este número de días o menos (el mayor de `avisos.vencimientos.dias_antes`). */
  readonly diasVencePronto: number;
  /** un domiciliado se da por cargado el día de su vencimiento. */
  readonly domiciliadosPagadosAlVencer: boolean;
}

export type EstadoPago =
  | { readonly estado: 'pagado' }
  | { readonly estado: 'domiciliado_cargado' }
  | { readonly estado: 'domiciliado_pendiente'; readonly dias: number }
  | { readonly estado: 'vencido'; readonly diasDeRetraso: number }
  | { readonly estado: 'vence_hoy' }
  | { readonly estado: 'vence_pronto'; readonly dias: number }
  | { readonly estado: 'pendiente'; readonly dias: number };

export function estadoDePago(plazo: Plazo, hoy: FechaLocal, opciones: OpcionesPago): EstadoPago {
  if (plazo.estado === 'pagado') return { estado: 'pagado' };

  const dias = diasEntre(hoy, plazo.fecha);

  if (plazo.estado === 'domiciliado') {
    if (dias <= 0 && opciones.domiciliadosPagadosAlVencer) return { estado: 'domiciliado_cargado' };
    if (dias >= 0) return { estado: 'domiciliado_pendiente', dias };
    // Domiciliado, vencido y sin darse por pagado: hay que mirar si se cargó.
    return { estado: 'vencido', diasDeRetraso: -dias };
  }

  if (dias < 0) return { estado: 'vencido', diasDeRetraso: -dias };
  if (dias === 0) return { estado: 'vence_hoy' };
  if (dias <= opciones.diasVencePronto) return { estado: 'vence_pronto', dias };
  return { estado: 'pendiente', dias };
}
