import { fechaLocal, type FechaLocal } from '../core/fechas.js';
import { extraerNif } from '../core/nif.js';
import type { SalidaModelo } from './salida.js';

/**
 * La factura leída, en el formato del dominio, venga del modelo o de un XML.
 * Importes en **céntimos enteros** (sin errores de coma flotante al sumar),
 * porcentajes como número.
 *
 * Normalizar no decide nada: lo que no se puede interpretar (una fecha que no
 * es fecha) se deja a null y se anota en `problemas`, para que la validación lo
 * mande a revisión. Nunca se «arregla» un dato.
 */

export type Centimos = number;

export interface LineaImpuesto {
  readonly base: Centimos;
  readonly tipoIva: number;
  readonly cuotaIva: Centimos;
  readonly tipoRe: number;
  readonly cuotaRe: Centimos;
}

export type CampoConEvidencia = 'emisor' | 'numero' | 'fecha_emision' | 'total_factura' | 'total_a_pagar' | `linea_${number}` | `vencimiento_${number}`;

export interface FacturaLeida {
  readonly origen: 'modelo' | 'xml';
  readonly esFactura: boolean;
  readonly legible: boolean;
  readonly tipo: 'factura' | 'rectificativa' | 'simplificada' | 'proforma' | 'otro';
  readonly emisor: { readonly nombre: string | null; readonly nif: string | null };
  readonly receptor: { readonly nombre: string | null; readonly nif: string | null };
  readonly numero: string | null;
  readonly fechaEmision: FechaLocal | null;
  readonly lineasImpuesto: readonly LineaImpuesto[];
  readonly retencion: { readonly base: Centimos; readonly tipo: number; readonly cuota: Centimos } | null;
  readonly otros: readonly { readonly concepto: string; readonly importe: Centimos }[];
  /**
   * Total de la factura (bases + IVA + RE − retención). Si el documento no lo
   * trae aparte (sólo «total a pagar»), lo calcula el código: `totalFacturaOrigen`
   * dice cuál de los dos es (el calculado no se puede «encontrar» en el texto).
   */
  readonly totalFactura: Centimos | null;
  readonly totalFacturaOrigen: 'documento' | 'calculado';
  readonly totalAPagar: Centimos | null;
  /** Código de la moneda de los importes (`EUR`, `USD`…); `null` si el documento no la indica. */
  readonly moneda: string | null;
  readonly vencimientos: readonly { readonly fecha: FechaLocal; readonly importe: Centimos | null }[];
  readonly formaPago: Exclude<SalidaModelo['forma_pago'], 'desconocida'> | null;
  readonly iban: string | null;
  readonly referencias: { readonly pedidos: readonly string[]; readonly albaranes: readonly string[] };
  readonly facturaRectificada: string | null;
  /** Evidencia literal de cada campo clave (null si el modelo no dio ninguna; en un XML no aplica). */
  readonly evidencias: Readonly<Partial<Record<CampoConEvidencia, string | null>>>;
  /** Lo que no se ha podido interpretar. Vacío es que todo se ha leído en su formato. */
  readonly problemas: readonly string[];
}

/** «eur», «€», «$»…: el código de la moneda. Lo que no se reconoce se conserva: tampoco es EUR. */
export function normalizarMoneda(x: string | null): string | null {
  const limpio = (x ?? '').trim().toUpperCase();
  if (limpio === '') return null;
  return { '€': 'EUR', EURO: 'EUR', EUROS: 'EUR', $: 'USD', US$: 'USD', '£': 'GBP', '¥': 'JPY' }[limpio] ?? limpio;
}

export const aCentimos = (euros: number): Centimos => Math.round(euros * 100);

/** Quita espacios del número de factura: «F 2026 / 001» y «F2026/001» son el mismo. */
export const normalizarNumero = (numero: string): string => numero.replace(/\s+/g, '').toUpperCase();

const vacio = (s: string): boolean => s.trim() === '';

function fecha(texto: string, campo: string, problemas: string[]): FechaLocal | null {
  if (vacio(texto)) return null;
  try {
    return fechaLocal(texto.trim());
  } catch {
    problemas.push(`${campo}: «${texto}» no es una fecha AAAA-MM-DD válida`);
    return null;
  }
}

/** Un importe en texto («-1234.56») a céntimos. "" es null; algo que no es un número, null y anotado. */
function importe(texto: string, campo: string, problemas: string[]): Centimos | null {
  if (vacio(texto)) return null;
  const n = Number(texto.trim());
  if (!Number.isFinite(n)) {
    problemas.push(`${campo}: «${texto}» no es un importe`);
    return null;
  }
  return aCentimos(n);
}

/** Un porcentaje en texto. "" se lee como 0 (sin recargo); algo que no es número, 0 y anotado. */
function porcentaje(texto: string, campo: string, problemas: string[]): number {
  if (vacio(texto)) return 0;
  const n = Number(texto.trim());
  if (!Number.isFinite(n)) {
    problemas.push(`${campo}: «${texto}» no es un porcentaje`);
    return 0;
  }
  return n;
}

const oNull = (s: string): string | null => (vacio(s) ? null : s.trim());

/** El del documento si lo trae; si no, bases + IVA + RE − retención (regla 5: el código calcula). */
export function totalFactura(
  delDocumento: Centimos | null,
  lineas: readonly LineaImpuesto[],
  retencion: Centimos,
): { totalFactura: Centimos | null; totalFacturaOrigen: 'documento' | 'calculado' } {
  if (delDocumento !== null) return { totalFactura: delDocumento, totalFacturaOrigen: 'documento' };
  if (lineas.length === 0) return { totalFactura: null, totalFacturaOrigen: 'calculado' };
  return { totalFactura: lineas.reduce((a, l) => a + l.base + l.cuotaIva + l.cuotaRe, 0) - retencion, totalFacturaOrigen: 'calculado' };
}

export function desdeModelo(s: SalidaModelo): FacturaLeida {
  const problemas: string[] = [];
  // En el orden en que se leen: primero la fecha de emisión, luego los plazos.
  const fechaEmision = fecha(s.fecha_emision, 'fecha_emision', problemas);
  const lineasImpuesto = s.lineas_impuesto.map((l, i) => ({
    // Una línea de impuestos sin base o sin cuota no es «0»: es un dato que falta,
    // y se anota para que la validación lo vea.
    base: importe(l.base, `lineas_impuesto.${i}.base`, problemas) ?? 0,
    tipoIva: porcentaje(l.tipo_iva, `lineas_impuesto.${i}.tipo_iva`, problemas),
    cuotaIva: importe(l.cuota_iva, `lineas_impuesto.${i}.cuota_iva`, problemas) ?? 0,
    tipoRe: porcentaje(l.tipo_re, `lineas_impuesto.${i}.tipo_re`, problemas),
    cuotaRe: importe(l.cuota_re, `lineas_impuesto.${i}.cuota_re`, problemas) ?? 0,
  }));
  s.lineas_impuesto.forEach((l, i) => {
    if (vacio(l.base) || vacio(l.cuota_iva)) problemas.push(`lineas_impuesto.${i}: falta la base o la cuota`);
  });
  const vencimientos = s.vencimientos.flatMap((v, i) => {
    const f = fecha(v.fecha, `vencimientos.${i}`, problemas);
    return f === null ? [] : [{ fecha: f, importe: importe(v.importe, `vencimientos.${i}.importe`, problemas) }];
  });
  const r = s.retenciones_irpf[0];
  if (s.retenciones_irpf.length > 1) problemas.push(`hay ${s.retenciones_irpf.length} retenciones de IRPF; se toma la primera`);

  const evidencias: Partial<Record<CampoConEvidencia, string | null>> = {
    emisor: oNull(s.emisor_evidencia),
    numero: oNull(s.numero_evidencia),
    fecha_emision: oNull(s.fecha_emision_evidencia),
    total_factura: oNull(s.total_factura_evidencia),
    total_a_pagar: oNull(s.total_a_pagar_evidencia),
  };
  s.lineas_impuesto.forEach((l, i) => (evidencias[`linea_${i}`] = oNull(l.evidencia)));
  s.vencimientos.forEach((v, i) => (evidencias[`vencimiento_${i}`] = oNull(v.evidencia)));

  const nif = (x: string): string | null => (vacio(x) ? null : extraerNif(x));
  return {
    origen: 'modelo',
    esFactura: s.es_factura,
    legible: s.legible,
    tipo: s.tipo,
    emisor: { nombre: oNull(s.emisor_nombre), nif: nif(s.emisor_nif) },
    receptor: { nombre: oNull(s.receptor_nombre), nif: nif(s.receptor_nif) },
    numero: vacio(s.numero) ? null : normalizarNumero(s.numero),
    fechaEmision,
    lineasImpuesto,
    retencion:
      r === undefined
        ? null
        : {
            base: importe(r.base, 'retencion.base', problemas) ?? 0,
            tipo: porcentaje(r.tipo, 'retencion.tipo', problemas),
            cuota: Math.abs(importe(r.cuota, 'retencion.cuota', problemas) ?? 0),
          },
    otros: s.otros_conceptos.map((o, i) => ({ concepto: o.concepto, importe: importe(o.importe, `otros.${i}`, problemas) ?? 0 })),
    ...totalFactura(importe(s.total_factura, 'total_factura', problemas), lineasImpuesto, r === undefined ? 0 : Math.abs(importe(r.cuota, 'retencion.cuota', []) ?? 0)),
    totalAPagar: importe(s.total_a_pagar, 'total_a_pagar', problemas),
    moneda: normalizarMoneda(s.moneda),
    vencimientos,
    formaPago: s.forma_pago === 'desconocida' ? null : s.forma_pago,
    iban: vacio(s.iban_proveedor) ? null : s.iban_proveedor.replace(/\s+/g, '').toUpperCase(),
    referencias: { pedidos: s.pedidos, albaranes: s.albaranes },
    facturaRectificada: oNull(s.factura_rectificada),
    evidencias,
    problemas,
  };
}

/** Sumas por concepto, para el cuadre (Fase 3) y la evaluación. */
export function sumas(f: FacturaLeida): { base: Centimos; iva: Centimos; re: Centimos } {
  return f.lineasImpuesto.reduce((a, l) => ({ base: a.base + l.base, iva: a.iva + l.cuotaIva, re: a.re + l.cuotaRe }), { base: 0, iva: 0, re: 0 });
}
