import { fechaLocal } from '../src/core/fechas.js';
import { desdeModelo } from '../src/extraccion/factura-leida.js';
import type { SalidaModelo } from '../src/extraccion/salida.js';
import { decidir, validar, type ContextoValidacion } from '../src/validacion/reglas.js';

/**
 * Runs fictional model outputs through the real validation rules, with no AI,
 * database, or API key. The rule messages are in Spanish, as users see them.
 *
 *   npm run demo
 */

const CORRECT = {
  es_factura: true,
  legible: true,
  tipo: 'factura',
  emisor_nombre: 'Laboratorios Imaginarios, S.A.',
  emisor_nif: 'A99999120',
  emisor_evidencia: 'e',
  receptor_nombre: 'Farmacia Ejemplo',
  receptor_nif: '99999901H',
  numero: 'LI-26-0398',
  numero_evidencia: 'e',
  fecha_emision: '2026-10-02',
  fecha_emision_evidencia: 'e',
  lineas_impuesto: [
    { base: '100.00', tipo_iva: '4', cuota_iva: '4.00', tipo_re: '0.5', cuota_re: '0.50', evidencia: 'e' },
    { base: '10.00', tipo_iva: '21', cuota_iva: '2.10', tipo_re: '5.2', cuota_re: '0.52', evidencia: 'e' },
  ],
  retenciones_irpf: [],
  otros_conceptos: [{ concepto: 'Gastos bancarios', importe: '1.09', evidencia: 'e' }],
  total_factura: '117.12',
  total_factura_evidencia: 'e',
  total_a_pagar: '118.21',
  total_a_pagar_evidencia: 'e',
  moneda: 'EUR',
  vencimientos: [{ fecha: '2026-12-01', importe: '118.21', evidencia: 'e' }],
  forma_pago: 'giro',
  iban_proveedor: '',
  pedidos: [],
  albaranes: [],
  factura_rectificada: '',
  notas: '',
} satisfies SalidaModelo;

const CONTEXT = {
  empresas: [{ id: 'principal', nif: '99999901H', regimenIva: 'recargo_equivalencia' }],
  hoy: fechaLocal('2026-10-20'),
  antiguedadMaximaDias: 400,
  toleranciaCuadreCentimos: 2,
  comprobacion: null,
  proveedorConocido: () => true,
  posibleDuplicadoDe: null,
} satisfies ContextoValidacion;

const CASES: ReadonlyArray<readonly [string, SalidaModelo]> = [
  ['Correct invoice', CORRECT],
  ['Total misread by the model', { ...CORRECT, total_factura: '171.12' }],
  ['Supplier tax ID with a bad check digit', { ...CORRECT, emisor_nif: 'A99999121' }],
  ['Year misread (2023 instead of 2026)', { ...CORRECT, fecha_emision: '2023-10-02' }],
  ['Due date before the issue date (advance payment)', { ...CORRECT, vencimientos: [{ fecha: '2026-09-15', importe: '118.21', evidencia: 'e' }] }],
];

for (const [name, output] of CASES) {
  const result = decidir(validar(desdeModelo(output), CONTEXT), true);
  console.log(`\n${name}\n  -> ${result.tipo}`);
  const details = result.tipo === 'registrar' ? result.avisos : result.motivos;
  for (const d of details) console.log(`     [${d.gravedad}] ${d.regla}: ${d.mensaje}`);
}
