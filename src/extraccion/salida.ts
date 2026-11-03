import { z } from 'zod';

/**
 * Lo que devuelve el modelo: salida cerrada, forzada con salida estructurada
 *. **Transcribe, no calcula**: cada línea de la tabla de
 * impuestos por separado y la evidencia literal de cada dato; las sumas y los
 * cuadres los hace el código (docs/ENGINEERING_RULES.md, regla 5).
 *
 * **Todo es texto, y `""` significa «no aparece en el documento».** La primera
 * versión usaba `null` y números, y la API la rechazó: cada campo que puede ser
 * null es una alternativa más en la gramática que compila la salida
 * estructurada, y con tantos la gramática era «demasiado grande». Con texto
 * plano la gramática es pequeña y la salida igual de cerrada; convertir y
 * comprobar los importes lo hace el código (`factura-leida.ts`), que es quien
 * tiene que hacerlo de todas formas.
 */

const texto = (descripcion: string) => z.string().describe(descripcion);
const evidencia = texto('Texto copiado LITERALMENTE del documento donde aparece el dato; "" si no aparece');
const importe = (descripcion: string) => texto(`${descripcion}. Número con punto decimal y signo menos si es negativo (p. ej. "-1234.56"); "" si no aparece`);

export const salidaModeloSchema = z.object({
  es_factura: z.boolean().describe('true si es una factura, factura rectificativa, abono o factura simplificada con importes'),
  legible: z.boolean().describe('false si la imagen o el escaneo no se puede leer con seguridad'),
  tipo: z.enum(['factura', 'rectificativa', 'simplificada', 'proforma', 'otro']),
  emisor_nombre: texto('Quien factura; "" si no aparece'),
  emisor_nif: texto('NIF/CIF de quien factura, tal como aparece; "" si no aparece'),
  emisor_evidencia: evidencia,
  receptor_nombre: texto('A quien se factura; "" si no aparece'),
  receptor_nif: texto('NIF/CIF del cliente, tal como aparece; "" si no aparece'),
  numero: texto('Número de factura; "" si no aparece'),
  numero_evidencia: evidencia,
  fecha_emision: texto('AAAA-MM-DD; "" si no aparece'),
  fecha_emision_evidencia: evidencia,
  lineas_impuesto: z
    .array(
      z.object({
        base: importe('Base imponible de la línea'),
        tipo_iva: importe('Porcentaje de IVA, p. ej. "21"'),
        cuota_iva: importe('Cuota de IVA'),
        tipo_re: importe('Porcentaje de recargo de equivalencia; "0" si no hay'),
        cuota_re: importe('Cuota de recargo de equivalencia; "0" si no hay'),
        evidencia,
      }),
    )
    .describe('Una entrada por cada línea de la tabla o resumen de impuestos, transcrita tal cual. Sin sumar.'),
  retenciones_irpf: z
    .array(z.object({ base: importe('Base de la retención'), tipo: importe('Porcentaje'), cuota: importe('Importe retenido, en positivo'), evidencia }))
    .describe('Retención de IRPF si la hay (como mucho una); vacío si no'),
  otros_conceptos: z
    .array(z.object({ concepto: texto('Nombre del concepto'), importe: importe('Importe'), evidencia }))
    .describe('Importes NO sujetos a IVA que cambian el total a pagar: gastos bancarios, fianzas, capital social…'),
  total_factura: importe('Total de la factura'),
  total_factura_evidencia: evidencia,
  total_a_pagar: importe('Total a pagar'),
  total_a_pagar_evidencia: evidencia,
  moneda: texto('Código de tres letras de la moneda de los importes (EUR, USD, GBP…), esté donde esté en el documento; "" si no consta'),
  vencimientos: z.array(z.object({ fecha: texto('AAAA-MM-DD'), importe: importe('Importe del plazo'), evidencia })),
  forma_pago: z.enum(['domiciliacion', 'transferencia', 'giro', 'contado', 'tarjeta', 'otro', 'desconocida']),
  iban_proveedor: texto('IBAN donde cobra el proveedor; "" si no aparece'),
  pedidos: z.array(z.string()).describe('Números de pedido citados en la factura'),
  albaranes: z.array(z.string()).describe('Números de albarán citados en la factura'),
  factura_rectificada: texto('Número de la factura que se rectifica, si es rectificativa; "" si no'),
  notas: texto('Breve. Dudas o particularidades de este documento.'),
});

export type SalidaModelo = z.infer<typeof salidaModeloSchema>;
