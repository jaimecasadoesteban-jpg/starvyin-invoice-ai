import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { comprobarValores, esDeEscaner, formasDeFecha, formasDeImporte, textoDePdf } from '../../src/extraccion/evidencias.js';
import { aCentimos, desdeModelo, sumas } from '../../src/extraccion/factura-leida.js';
import type { SalidaModelo } from '../../src/extraccion/salida.js';
import { esFacturae, leerFacturae } from '../../src/extraccion/facturae.js';

const JUEGO = new URL('../../pruebas/', import.meta.url).pathname;
const esperado = JSON.parse(readFileSync(`${JUEGO}esperado.json`, 'utf8')) as {
  facturas: Record<string, { campos: Record<string, unknown> & { lineas_impuesto: Record<string, string>[]; vencimientos: { fecha: string; importe: string }[] } }>;
};
const centimos = (s: string): number => aCentimos(Number(s));

describe('Facturae (sin modelo)', () => {
  const xml = readFileSync(`${JUEGO}facturas/16_facturae.xml`, 'utf8');
  const e = esperado.facturas['16_facturae.xml']!.campos;
  const f = leerFacturae(xml);

  it('reconoce un Facturae', () => {
    expect(esFacturae(xml)).toBe(true);
    expect(f).not.toBeNull();
  });

  it('lee lo mismo que dice el resultado esperado del juego de pruebas', () => {
    expect(f?.origen).toBe('xml');
    expect(f?.emisor.nif).toBe(e['emisor_nif']);
    expect(f?.receptor.nif).toBe(e['receptor_nif']);
    expect(f?.numero).toBe(e['numero']);
    expect(f?.fechaEmision).toBe(e['fecha_emision']);
    expect(f?.totalFactura).toBe(centimos(String(e['total_factura'])));
    expect(f?.totalAPagar).toBe(centimos(String(e['total_a_pagar'])));
    expect(f?.lineasImpuesto).toEqual(
      e.lineas_impuesto.map((l) => ({
        base: centimos(l['base']!),
        tipoIva: Number(l['tipo_iva']),
        cuotaIva: centimos(l['cuota_iva']!),
        tipoRe: Number(l['tipo_re']),
        cuotaRe: centimos(l['cuota_re']!),
      })),
    );
    expect(f?.vencimientos).toEqual(e.vencimientos.map((v) => ({ fecha: v.fecha, importe: centimos(v.importe) })));
    expect(f?.iban).toBe(e['iban_proveedor']);
    expect(f?.problemas).toEqual([]);
  });

  it('una rectificativa (InvoiceClass OR) es rectificativa, con la factura que rectifica', () => {
    const rect = xml.replace('<InvoiceClass>OO</InvoiceClass>', '<InvoiceClass>OR</InvoiceClass>').replace('<InvoiceIssueData>', '<Corrective><InvoiceNumber>XML-1</InvoiceNumber></Corrective><InvoiceIssueData>');
    expect(leerFacturae(rect)).toMatchObject({ tipo: 'rectificativa', facturaRectificada: 'XML-1' });
  });

  it('un XML que no es Facturae (UBL, todavía no soportado) devuelve null: irá a revisión', () => {
    expect(leerFacturae('<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>')).toBeNull();
  });

  it('una fecha imposible no se arregla: se deja a null y se anota', () => {
    const roto = leerFacturae(xml.replace('<IssueDate>2026-10-10</IssueDate>', '<IssueDate>2026-02-31</IssueDate>'));
    expect(roto?.fechaEmision).toBeNull();
    expect(roto?.problemas.join()).toMatch(/fecha_emision/);
  });
});

const base = {
  es_factura: true,
  legible: true,
  tipo: 'factura',
  emisor_nombre: 'X',
  emisor_nif: 'es-a 9999 9120',
  emisor_evidencia: 'CIF A99999120',
  receptor_nombre: 'Y',
  receptor_nif: '',
  numero: ' li-26 0398 ',
  numero_evidencia: 'LI-26 0398',
  fecha_emision: '02/10/2026',
  fecha_emision_evidencia: '02/10/2026',
  lineas_impuesto: [
    { base: '0.1', tipo_iva: '21', cuota_iva: '0.02', tipo_re: '', cuota_re: '0', evidencia: 'a' },
    { base: '0.2', tipo_iva: '10', cuota_iva: '0.02', tipo_re: '0', cuota_re: '0', evidencia: 'b' },
  ],
  retenciones_irpf: [],
  otros_conceptos: [],
  total_factura: '0.34',
  total_factura_evidencia: 't',
  total_a_pagar: 'mucho',
  total_a_pagar_evidencia: 't',
  moneda: 'EUR',
  vencimientos: [
    { fecha: '2026-12-01', importe: '0.34', evidencia: 'v' },
    { fecha: 'pronto', importe: '', evidencia: 'v2' },
  ],
  forma_pago: 'desconocida',
  iban_proveedor: 'es36 9999 0006',
  pedidos: [],
  albaranes: [],
  factura_rectificada: '',
  notas: '',
} satisfies SalidaModelo;
const f = desdeModelo(base);

describe('desdeModelo', () => {

  it('importes en céntimos enteros: 0,1 + 0,2 suma 0,30 exactos', () => {
    expect(sumas(f).base).toBe(30);
  });

  it('redondea, no trunca: 0,29 × 100 en coma flotante es 28,999…', () => {
    expect(aCentimos(0.29)).toBe(29);
    expect(aCentimos(1.15)).toBe(115);
    expect(aCentimos(-7035.28)).toBe(-703528);
  });

  it('normaliza NIF, número e IBAN', () => {
    expect(f.emisor.nif).toBe('A99999120');
    expect(f.numero).toBe('LI-260398');
    expect(f.iban).toBe('ES3699990006');
  });

  it('una fecha que no es AAAA-MM-DD no se interpreta: null y anotada', () => {
    expect(f.fechaEmision).toBeNull();
    expect(f.problemas).toEqual([
      'fecha_emision: «02/10/2026» no es una fecha AAAA-MM-DD válida',
      'vencimientos.1: «pronto» no es una fecha AAAA-MM-DD válida',
      'total_a_pagar: «mucho» no es un importe',
    ]);
    expect(f.totalAPagar).toBeNull();
    expect(f.vencimientos).toEqual([{ fecha: '2026-12-01', importe: 34 }]);
  });
});

describe('la moneda de una Facturae', () => {
  const xml = readFileSync(`${JUEGO}facturas/16_facturae.xml`, 'utf8');
  it('la lee: en euros, EUR; en dólares, USD, aunque los importes no lleven símbolo', () => {
    expect(leerFacturae(xml)?.moneda).toBe('EUR');
    expect(leerFacturae(xml.replaceAll('<InvoiceCurrencyCode>EUR<', '<InvoiceCurrencyCode>USD<'))?.moneda).toBe('USD');
  });
  it('si la factura no la trae, la del lote; y sin ninguna, no se da por hecha', () => {
    const sinLaDeLaFactura = xml.replace(/(<InvoiceIssueData>.*?)<InvoiceCurrencyCode>EUR<\/InvoiceCurrencyCode>/s, '$1');
    expect(leerFacturae(sinLaDeLaFactura)?.moneda).toBe('EUR');
    expect(leerFacturae(xml.replaceAll('<InvoiceCurrencyCode>EUR</InvoiceCurrencyCode>', ''))?.moneda).toBeNull();
  });
});

describe('total de la factura', () => {
  it('si el documento sólo trae el total a pagar, lo calcula el código (y lo dice)', () => {
    const g = desdeModelo({ ...base, total_factura: '', total_a_pagar: '0.34' });
    expect(g.totalFactura).toBe(30 + 4);
    expect(g.totalFacturaOrigen).toBe('calculado');
  });

  it('si lo trae, es el del documento', () => {
    expect(desdeModelo(base)).toMatchObject({ totalFactura: 34, totalFacturaOrigen: 'documento' });
  });
});

describe('comprobar que los valores leídos están en el PDF', () => {
  it('formas de un importe y de una fecha en una factura española', () => {
    expect(formasDeImporte(123456)).toEqual(['1.234,56', '1234,56', '1234.56', '1,234.56']);
    expect(formasDeImporte(-703528)).toContain('7.035,28');
    expect(formasDeFecha('2026-03-05')).toEqual(expect.arrayContaining(['05/03/2026', '05.03.2026', '05-03-26', '5/3/2026', '2026-03-05']));
  });

  it('en un PDF con texto: lo que está, encontrado; un vencimiento inventado, no encontrado', async () => {
    const texto = await textoDePdf(readFileSync(`${JUEGO}facturas/02_laboratorio.pdf`));
    const e = esperado.facturas['02_laboratorio.pdf']!.campos;
    const leida = desdeModelo({
      ...base,
      emisor_nif: String(e['emisor_nif']),
      numero: String(e['numero']),
      fecha_emision: String(e['fecha_emision']),
      total_a_pagar: String(e['total_a_pagar']),
      total_factura: '',
      lineas_impuesto: [],
      vencimientos: [
        { fecha: e.vencimientos[0]!.fecha, importe: '', evidencia: '' },
        { fecha: '2026-06-26', importe: '', evidencia: '' },
      ],
    });
    expect(comprobarValores(leida, texto)).toEqual({
      comprobable: true,
      campos: { emisor_nif: 'encontrado', numero: 'encontrado', fecha_emision: 'encontrado', total_a_pagar: 'encontrado', vencimiento_0: 'encontrado', vencimiento_1: 'no_encontrado' },
    });
  });

  it('el total de la factura no se busca en el texto (lo controla el cuadre; a veces no está impreso)', () => {
    const r = comprobarValores(desdeModelo(base), { texto: 'cabecera '.repeat(10), fiable: true });
    expect(r.comprobable && 'total_factura' in r.campos).toBe(false);
  });

  it('tolera que la extracción del PDF pegue o separe palabras', () => {
    const r = comprobarValores(desdeModelo({ ...base, numero: 'LI-26-0398', emisor_nif: '' }), { texto: 'cabecera '.repeat(10) + 'NºFactura:LI-26-\n0398', fiable: true });
    expect(r.comprobable && r.campos.numero).toBe('encontrado');
  });

  it.each([
    ['Canon', true],
    ['Scanner System Image Conversion', true],
    ['ABBYY FineReader', true],
    ['HP Scan', true],
    ['SAP NetWeaver 740', false],
    ['Crystal Reports', false],
    ['PHPExcel / TCPDF', false], // «hp» dentro de «PHP» no es un escáner
    ['CakePHP invoice generator', false],
    ['Microsoft Reporting Services', false],
  ])('autor del PDF «%s»: escáner = %s', (autor, escaner) => {
    expect(esDeEscaner(autor)).toBe(escaner);
  });

  it('un texto de OCR de escáner (no fiable) no se usa para comprobar: los valores bien leídos de la imagen «no aparecerían»', () => {
    expect(comprobarValores(f, { texto: 'REt6 ro J0FRH '.repeat(10), fiable: false })).toEqual({ comprobable: false });
  });

  it('en un escaneo (sin texto) no es comprobable, no «todo encontrado»', async () => {
    const texto = await textoDePdf(readFileSync(`${JUEGO}facturas/04_parafarmacia_escaneada.pdf`));
    expect(comprobarValores(f, texto)).toEqual({ comprobable: false });
  });
});
