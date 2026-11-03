import { XMLParser } from 'fast-xml-parser';

import { fechaLocal, type FechaLocal } from '../core/fechas.js';
import { normalizarNif } from '../core/nif.js';
import { aCentimos, normalizarNumero, totalFactura, type FacturaLeida, type LineaImpuesto, normalizarMoneda } from './factura-leida.js';

/**
 * Lee una factura electrónica **Facturae 3.2.x** sin modelo: coste cero y sin
 * interpretación. Devuelve el mismo `FacturaLeida` que el
 * modelo, así que pasa por la misma validación.
 *
 * Pendiente (Fase 3, módulo 7a): verificar la firma XAdES, y los formatos UBL y
 * CII. Hasta entonces, un XML que no es Facturae devuelve `null` y el documento
 * va a revisión como formato no soportado.
 */

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (nombre) => ['Invoice', 'Tax', 'Installment', 'InvoiceLine'].includes(nombre),
});

type Nodo = Record<string, unknown>;
const esNodo = (v: unknown): v is Nodo => typeof v === 'object' && v !== null && !Array.isArray(v);
const hijo = (n: unknown, ...ruta: string[]): unknown => ruta.reduce<unknown>((a, k) => (esNodo(a) ? a[k] : undefined), n);
const texto = (n: unknown, ...ruta: string[]): string | null => {
  const v = hijo(n, ...ruta);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const lista = (n: unknown, ...ruta: string[]): unknown[] => {
  const v = hijo(n, ...ruta);
  return Array.isArray(v) ? v : [];
};

/** Códigos de medio de pago de Facturae → forma de pago del dominio. */
const MEDIOS: Record<string, FacturaLeida['formaPago']> = { '01': 'contado', '02': 'domiciliacion', '04': 'transferencia', '05': 'giro', '19': 'tarjeta' };

export function esFacturae(xml: string): boolean {
  return /<([a-z0-9]+:)?Facturae[\s>]/i.test(xml);
}

export function leerFacturae(xml: string): FacturaLeida | null {
  if (!esFacturae(xml)) return null;
  const raiz = hijo(parser.parse(xml), 'Facturae');
  const problemas: string[] = [];

  const importe = (n: unknown, ...ruta: string[]): number | null => {
    const t = texto(n, ...ruta);
    if (t === null) return null;
    const v = Number(t);
    if (Number.isNaN(v)) {
      problemas.push(`${ruta.join('.')}: «${t}» no es un número`);
      return null;
    }
    return v;
  };
  const fecha = (t: string | null, campo: string): FechaLocal | null => {
    if (t === null) return null;
    try {
      return fechaLocal(t);
    } catch {
      problemas.push(`${campo}: «${t}» no es una fecha válida`);
      return null;
    }
  };
  const parte = (p: unknown): { nombre: string | null; nif: string | null } => {
    const nif = texto(p, 'TaxIdentification', 'TaxIdentificationNumber');
    const persona = [texto(p, 'Individual', 'Name'), texto(p, 'Individual', 'FirstSurname'), texto(p, 'Individual', 'SecondSurname')].filter((x) => x !== null);
    return { nombre: texto(p, 'LegalEntity', 'CorporateName') ?? (persona.length > 0 ? persona.join(' ') : null), nif: nif === null ? null : normalizarNif(nif) };
  };

  const facturas = lista(raiz, 'Invoices', 'Invoice');
  if (facturas.length !== 1) problemas.push(`el lote tiene ${facturas.length} facturas; se lee sólo la primera`);
  const f = facturas[0];

  const serie = texto(f, 'InvoiceHeader', 'InvoiceSeriesCode');
  const num = texto(f, 'InvoiceHeader', 'InvoiceNumber');
  const clase = texto(f, 'InvoiceHeader', 'InvoiceClass');
  const tipoDoc = texto(f, 'InvoiceHeader', 'InvoiceDocumentType');

  const lineasImpuesto: LineaImpuesto[] = lista(f, 'TaxesOutputs', 'Tax').map((t) => ({
    base: aCentimos(importe(t, 'TaxableBase', 'TotalAmount') ?? 0),
    tipoIva: importe(t, 'TaxRate') ?? 0,
    cuotaIva: aCentimos(importe(t, 'TaxAmount', 'TotalAmount') ?? 0),
    tipoRe: importe(t, 'EquivalenceSurcharge') ?? 0,
    cuotaRe: aCentimos(importe(t, 'EquivalenceSurchargeAmount', 'TotalAmount') ?? 0),
  }));

  const retenido = lista(f, 'TaxesWithheld', 'Tax')[0];
  const retencion =
    retenido === undefined
      ? null
      : { base: aCentimos(importe(retenido, 'TaxableBase', 'TotalAmount') ?? 0), tipo: importe(retenido, 'TaxRate') ?? 0, cuota: aCentimos(importe(retenido, 'TaxAmount', 'TotalAmount') ?? 0) };

  const total = importe(f, 'InvoiceTotals', 'InvoiceTotal');
  const aPagar = importe(f, 'InvoiceTotals', 'TotalExecutableAmount') ?? importe(f, 'InvoiceTotals', 'TotalOutstandingAmount') ?? total;
  // Lo que separa el total de la factura del total a pagar en Facturae (pagos a
  // cuenta, retenciones de garantía…) se anota como concepto explícito, para
  // que el cuadre lo vea; no se reparte ni se interpreta.
  const otros = total !== null && aPagar !== null && aCentimos(aPagar) !== aCentimos(total)
    ? [{ concepto: 'diferencia entre total y total a pagar en el XML', importe: aCentimos(aPagar) - aCentimos(total) }]
    : [];

  const plazos = lista(f, 'PaymentDetails', 'Installment');
  const vencimientos = plazos.flatMap((p, i) => {
    const d = fecha(texto(p, 'InstallmentDueDate'), `vencimientos.${i}`);
    const imp = importe(p, 'InstallmentAmount');
    return d === null ? [] : [{ fecha: d, importe: imp === null ? null : aCentimos(imp) }];
  });
  const iban = plazos.map((p) => texto(p, 'AccountToBeCredited', 'IBAN')).find((x) => x !== null) ?? null;
  const medio = plazos.map((p) => texto(p, 'PaymentMeans')).find((x) => x !== null);

  return {
    origen: 'xml',
    esFactura: true,
    legible: true,
    tipo: clase === 'OR' || clase === 'CR' ? 'rectificativa' : tipoDoc === 'FA' ? 'simplificada' : 'factura',
    emisor: parte(hijo(raiz, 'Parties', 'SellerParty')),
    receptor: parte(hijo(raiz, 'Parties', 'BuyerParty')),
    numero: num === null ? null : normalizarNumero(serie === null ? num : `${serie}-${num}`),
    fechaEmision: fecha(texto(f, 'InvoiceIssueData', 'IssueDate'), 'fecha_emision'),
    lineasImpuesto,
    retencion,
    otros,
    ...totalFactura(total === null ? null : aCentimos(total), lineasImpuesto, retencion?.cuota ?? 0),
    totalAPagar: aPagar === null ? null : aCentimos(aPagar),
    moneda: normalizarMoneda(texto(f, 'InvoiceIssueData', 'InvoiceCurrencyCode') ?? texto(raiz, 'FileHeader', 'Batch', 'InvoiceCurrencyCode')),
    vencimientos,
    formaPago: medio === undefined ? null : (MEDIOS[medio] ?? 'otro'),
    iban: iban === null ? null : iban.replace(/\s+/g, '').toUpperCase(),
    referencias: { pedidos: [], albaranes: [] },
    facturaRectificada: texto(f, 'Corrective', 'InvoiceNumber'),
    evidencias: {},
    problemas,
  };
}
