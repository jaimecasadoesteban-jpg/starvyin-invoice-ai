import { extractText, getDocumentProxy, getMeta } from 'unpdf';

import type { FacturaLeida } from './factura-leida.js';

/**
 * Comprueba que los **valores** clave que ha leído el modelo **están de verdad
 * en el texto del PDF**. Es lo que convierte «no inventes un vencimiento» de
 * una petición en el prompt (que el modelo puede incumplir) en
 * una comprobación (docs/ENGINEERING_RULES.md, regla 5).
 *
 * Primera versión: se buscaba la evidencia literal que copia el modelo. La
 * evaluación lo descartó: los modelos copian bien la fila de la tabla («Nº
 * Factura · Fecha · …» con sus valores), pero el texto que sale del PDF
 * reordena celdas y saltos de línea, y ~1 de cada 3 evidencias correctas «no
 * aparecía». Se habrían ido a revisión facturas bien leídas. Lo que de verdad
 * importa es más simple y más robusto: que el número, la fecha (en alguno de
 * sus formatos), el NIF y cada importe (en formato español o con punto)
 * aparezcan en el documento. La evidencia literal se guarda para enseñarla en
 * la revisión.
 *
 * Sólo aplica a PDF con capa de texto. En un escaneo o una foto no hay texto
 * con el que comparar: `no_comprobable`, y el control queda en el cuadre.
 */

export interface TextoPdf {
  readonly texto: string;
  /**
   * `false` si el texto es de OCR de un escáner: trae basura («REt6 ro J0FRH»)
   * y los valores que el modelo lee bien de la imagen «no aparecen» en él. La
   * evaluación lo enseñó con un escaneo que sí traía capa de texto.
   */
  readonly fiable: boolean;
}

/** Escáneres y programas de OCR que aparecen como autor del PDF. «hp» sólo como palabra (dentro de «PHP» no es un escáner). */
const ESCANER = /\b(canon|epson|ricoh|xerox|brother|kyocera|konica|lexmark|sharp|hp|scanner|scan|ocr|abbyy|tesseract|camscanner|image conversion)\b/i;

export async function textoDePdf(bytes: Uint8Array): Promise<TextoPdf> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  const { info } = await getMeta(pdf);
  const autor = [info['Creator'], info['Producer']].filter((x): x is string => typeof x === 'string').join(' ');
  return { texto: text, fiable: !esDeEscaner(autor) };
}

/** ¿El autor del PDF (Creator/Producer) es un escáner o un programa de OCR? */
export function esDeEscaner(autor: string): boolean {
  return ESCANER.test(autor);
}

const MINIMO_TEXTO = 40;

/** Sin espacios ni saltos, en minúsculas: la extracción de texto junta y separa palabras a su antojo. */
const compactar = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** Formas en que puede aparecer un importe en una factura española. */
export function formasDeImporte(centimos: number): string[] {
  const abs = Math.abs(centimos);
  const entero = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, '0');
  const miles = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return [...new Set([`${miles},${dec}`, `${entero},${dec}`, `${entero}.${dec}`, `${String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`])];
}

/** Formas en que puede aparecer una fecha AAAA-MM-DD. */
export function formasDeFecha(iso: string): string[] {
  const [a, m, d] = iso.split('-');
  if (a === undefined || m === undefined || d === undefined) return [iso];
  const aa = a.slice(2);
  const sinCero = (x: string): string => String(Number(x));
  const formas = [iso];
  for (const s of ['/', '-', '.']) {
    formas.push(`${d}${s}${m}${s}${a}`, `${d}${s}${m}${s}${aa}`, `${sinCero(d)}${s}${sinCero(m)}${s}${a}`);
  }
  return [...new Set(formas)];
}

export type ResultadoValor = 'encontrado' | 'no_encontrado';

export type CampoComprobado = 'emisor_nif' | 'numero' | 'fecha_emision' | 'total_a_pagar' | `linea_${number}_base` | `linea_${number}_cuota` | `vencimiento_${number}`;

export type Comprobacion =
  | { readonly comprobable: false }
  | { readonly comprobable: true; readonly campos: Readonly<Partial<Record<CampoComprobado, ResultadoValor>>> };

/**
 * El total de la factura NO se busca: a veces el modelo lo da sin que esté
 * impreso (lo calcula) y además el cuadre ya lo controla contra las líneas y el
 * total a pagar, que sí se buscan.
 */
export function comprobarValores(f: FacturaLeida, pdf: TextoPdf): Comprobacion {
  const texto = compactar(pdf.texto);
  if (!pdf.fiable || texto.length < MINIMO_TEXTO) return { comprobable: false };
  const esta = (formas: readonly string[]): ResultadoValor => (formas.some((x) => texto.includes(compactar(x))) ? 'encontrado' : 'no_encontrado');

  const campos: Partial<Record<CampoComprobado, ResultadoValor>> = {};
  if (f.emisor.nif !== null) {
    // El NIF puede venir con prefijo o guiones en el documento: se compara compactado y sin ellos.
    campos.emisor_nif = texto.replace(/[.\-/]/g, '').includes(compactar(f.emisor.nif)) ? 'encontrado' : 'no_encontrado';
  }
  if (f.numero !== null) campos.numero = esta([f.numero]);
  if (f.fechaEmision !== null) campos.fecha_emision = esta(formasDeFecha(f.fechaEmision));
  if (f.totalAPagar !== null) campos.total_a_pagar = esta(formasDeImporte(f.totalAPagar));
  f.lineasImpuesto.forEach((l, i) => {
    campos[`linea_${i}_base`] = esta(formasDeImporte(l.base));
    campos[`linea_${i}_cuota`] = esta(formasDeImporte(l.cuotaIva));
  });
  f.vencimientos.forEach((v, i) => (campos[`vencimiento_${i}`] = esta(formasDeFecha(v.fecha))));
  return { comprobable: true, campos };
}
