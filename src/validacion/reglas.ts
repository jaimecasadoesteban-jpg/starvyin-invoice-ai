import { diasEntre, type FechaLocal } from '../core/fechas.js';
import { validarIban } from '../core/iban.js';
import { validarNif, validarNifEmisor } from '../core/nif.js';
import type { Comprobacion } from '../extraccion/evidencias.js';
import { sumas, type FacturaLeida } from '../extraccion/factura-leida.js';

/**
 * Validación por código de una factura leída (docs/ENGINEERING_RULES.md, regla 5: el modelo
 * transcribe; el código calcula y decide). Funciones puras: todo lo que viene de
 * la base (duplicados, proveedores conocidos) llega ya resuelto en el contexto.
 *
 * Cada regla dice:
 * - **gravedad**: `bloquea` (no se registra: segundo intento o revisión) o `aviso`
 *   (se registra y queda marcada).
 * - **origen**: `extraccion` si lo más probable es una mala lectura (merece un
 *   segundo intento con otro modelo) o `negocio` si el documento es así y lo
 *   tiene que mirar una persona (otro modelo leería lo mismo).
 *
 * Ninguna regla pasa a `bloquea` sin medir antes, con las lecturas de la
 * evaluación, cuánto bloquea de lo que estaba bien (`scripts/medir-reglas.ts`).
 * Cada regla nace de un fallo concreto de extracción.
 */

export type Gravedad = 'bloquea' | 'aviso';
export type Origen = 'extraccion' | 'negocio';

export interface Resultado {
  readonly regla: IdRegla;
  readonly gravedad: Gravedad;
  readonly origen: Origen;
  readonly mensaje: string;
}

export type IdRegla =
  | 'ilegible'
  | 'datos_ininterpretables'
  | 'obligatorios'
  | 'nif_emisor'
  | 'receptor_desconocido'
  | 'receptor_no_coincide'
  | 'empresa_sin_determinar'
  | 'receptor_sin_nif'
  | 'cuadre'
  | 'cuota_linea'
  | 'tipo_impositivo'
  | 'signo'
  | 'rectificativa_positiva'
  | 'fecha_futura'
  | 'fecha_antigua'
  | 'vencimiento_anterior'
  | 'vencimientos_no_suman'
  | 'importe_plazo'
  | 'moneda_no_soportada'
  | 'moneda_sin_identificar'
  | 'iban_invalido'
  | 'valor_no_en_documento'
  | 'nif_no_verificable'
  | 'posible_duplicado'
  | 'proveedor_nuevo';

export interface EmpresaDelCliente {
  readonly id: string;
  readonly nif: string;
  readonly regimenIva: 'general' | 'recargo_equivalencia' | 'igic';
}

export interface ContextoValidacion {
  readonly empresas: readonly EmpresaDelCliente[];
  /** Si el documento entró por un buzón de UNA empresa, cuál (en un buzón común, undefined). */
  readonly empresaDelBuzon?: string;
  readonly hoy: FechaLocal;
  readonly antiguedadMaximaDias: number;
  readonly toleranciaCuadreCentimos: number;
  /** Valores comprobados contra el texto del PDF; `null` si el documento es XML. */
  readonly comprobacion: Comprobacion | null;
  /** NIF de emisores ya aprobados por una persona en facturas anteriores de esa empresa. */
  readonly proveedorConocido: (nif: string) => boolean;
  /** Otra factura del mismo emisor, misma fecha y mismo total con OTRO número (de la base). */
  readonly posibleDuplicadoDe: string | null;
}

/** Tipos de IVA (e IGIC) vigentes, en %. */
const TIPOS_IVA = new Set([0, 4, 5, 10, 21]);
const TIPOS_IGIC = new Set([0, 3, 5, 7, 9.5, 15, 20]);
/** Recargo de equivalencia que corresponde a cada tipo de IVA. */
const RE_DE: Readonly<Record<number, number>> = { 0: 0, 4: 0.5, 5: 0.62, 10: 1.4, 21: 5.2 };

function soloNoSujetos(f: FacturaLeida): boolean {
  if (f.otros.length === 0 || f.totalAPagar === null) return false;
  return f.otros.reduce((a, o) => a + o.importe, 0) === f.totalAPagar && (f.totalFactura === null || f.totalFactura === 0);
}

export interface Validacion {
  readonly resultados: readonly Resultado[];
  /** La empresa de la factura, si se ha podido determinar. */
  readonly empresaId: string | null;
}

export function validar(f: FacturaLeida, ctx: ContextoValidacion): Validacion {
  const r: Resultado[] = [];
  const add = (regla: IdRegla, gravedad: Gravedad, origen: Origen, mensaje: string): void => {
    r.push({ regla, gravedad, origen, mensaje });
  };
  const tol = ctx.toleranciaCuadreCentimos;
  const eur = (c: number): string => (c / 100).toFixed(2);

  // ── Lectura ────────────────────────────────────────────────────────────────
  if (!f.legible) add('ilegible', 'bloquea', 'extraccion', 'el documento no se lee con seguridad');
  if (f.problemas.length > 0) add('datos_ininterpretables', 'bloquea', 'extraccion', f.problemas.join('; '));

  const faltan = [
    f.emisor.nif === null && 'NIF del emisor',
    f.numero === null && 'número',
    f.fechaEmision === null && 'fecha de emisión',
    // Sin líneas de impuesto sólo vale una factura que es todo conceptos no sujetos
    // (caso real: una de gastos bancarios, con total de factura 0).
    f.lineasImpuesto.length === 0 && !soloNoSujetos(f) && 'líneas de impuesto',
    f.totalAPagar === null && 'total a pagar',
  ].filter((x): x is string => x !== false);
  if (faltan.length > 0) add('obligatorios', 'bloquea', 'extraccion', `faltan: ${faltan.join(', ')}`);

  // Un NIF con el control mal: o mala lectura, o error del emisor. Otro modelo
  // puede leerlo bien; si no, una persona.
  if (f.emisor.nif !== null && !validarNifEmisor(f.emisor.nif).valido) add('nif_emisor', 'bloquea', 'extraccion', `NIF del emisor no válido: ${f.emisor.nif}`);

  // El IBAN donde cobra el proveedor, con sus cifras de control: una cifra de más o de menos (fotos,
  // escaneos) y alguien pagaría a otra cuenta. De extracción: otro modelo puede leerlo bien. Uno
  // enmascarado («…****») no es del proveedor ni se puede usar: no bloquea (lo vigila el aviso de cuentas).
  if (f.iban !== null) {
    const v = validarIban(f.iban);
    if (!v.valido && v.motivo !== 'enmascarado') add('iban_invalido', 'bloquea', 'extraccion', `el IBAN del proveedor leído no es válido (${v.motivo === 'control' ? 'no cuadran sus cifras de control' : 'no tiene el largo de un IBAN'}): ${f.iban}`);
  }

  // ── De qué empresa es ──────────────────────────────────────────────────────
  let empresaId: string | null = null;
  const porNif = f.receptor.nif === null ? undefined : ctx.empresas.find((e) => e.nif === f.receptor.nif);
  if (ctx.empresaDelBuzon !== undefined) {
    empresaId = ctx.empresaDelBuzon;
    if (f.receptor.nif !== null && porNif?.id !== ctx.empresaDelBuzon) {
      add('receptor_no_coincide', 'bloquea', 'negocio', `el receptor (${f.receptor.nif}) no es la empresa de este buzón`);
    }
  } else if (porNif !== undefined) {
    empresaId = porNif.id;
  } else if (f.receptor.nif !== null) {
    add('receptor_desconocido', 'bloquea', 'negocio', `el receptor (${f.receptor.nif}) no es ninguna empresa del cliente`);
  } else if (ctx.empresas.length === 1) {
    empresaId = ctx.empresas[0]?.id ?? null;
    add('receptor_sin_nif', 'aviso', 'negocio', 'la factura no muestra el NIF del receptor; se asigna a la única empresa');
  } else {
    add('empresa_sin_determinar', 'bloquea', 'negocio', 'no se puede saber de qué empresa es (sin NIF del receptor y varias empresas)');
  }
  const empresa = ctx.empresas.find((e) => e.id === empresaId);

  // ── Cuadre ────────────────────────────────────────
  // base + IVA + RE − retención = total factura; total factura + no sujetos = total a pagar.
  // Si el total de la factura lo calculó el código, la primera igualdad es trivial
  // y la que cuenta es la segunda contra el total a pagar del documento.
  if (f.lineasImpuesto.length > 0 && f.totalAPagar !== null && f.totalFactura !== null) {
    const s = sumas(f);
    const ret = f.retencion?.cuota ?? 0;
    const otros = f.otros.reduce((a, o) => a + o.importe, 0);
    const calculado = s.base + s.iva + s.re - ret;
    const fallos: string[] = [];
    if (Math.abs(calculado - f.totalFactura) > tol) fallos.push(`bases+IVA+RE−ret = ${eur(calculado)} y el total de la factura es ${eur(f.totalFactura)}`);
    if (Math.abs(f.totalFactura + otros - f.totalAPagar) > tol) fallos.push(`total factura + no sujetos = ${eur(f.totalFactura + otros)} y el total a pagar es ${eur(f.totalAPagar)}`);
    if (fallos.length > 0) add('cuadre', 'bloquea', 'extraccion', fallos.join('; '));
  }

  // ── Cada línea de impuesto ─────────────────────────────────────────────────
  f.lineasImpuesto.forEach((l, i) => {
    // Tolerancia por redondeo: 2 céntimos o 0,05 % de la base (las cuotas que se
    // suman producto a producto se separan del cálculo sobre el total).
    const tolLinea = Math.max(2, Math.ceil(Math.abs(l.base) * 0.0005));
    const iva = Math.round((l.base * l.tipoIva) / 100);
    const re = Math.round((l.base * l.tipoRe) / 100);
    if (Math.abs(iva - l.cuotaIva) > tolLinea || Math.abs(re - l.cuotaRe) > tolLinea) {
      add('cuota_linea', 'bloquea', 'extraccion', `línea ${i + 1}: la cuota no corresponde a base × tipo`);
    }
    const igic = empresa?.regimenIva === 'igic';
    if (!(igic ? TIPOS_IGIC : TIPOS_IVA).has(l.tipoIva)) add('tipo_impositivo', 'bloquea', 'extraccion', `línea ${i + 1}: tipo ${l.tipoIva} % no existe`);
    // En recargo de equivalencia, el RE es el que corresponde al IVA… o 0 (los
    // servicios y suministros no llevan recargo: la factura de la luz de una farmacia).
    if (!igic && l.tipoRe !== 0 && RE_DE[l.tipoIva] !== l.tipoRe) add('tipo_impositivo', 'bloquea', 'extraccion', `línea ${i + 1}: recargo ${l.tipoRe} % no corresponde al IVA ${l.tipoIva} %`);
  });

  // ── Signo ──────────────────────────────────────────────────────────────────
  if (f.totalFactura !== null && f.totalFactura < 0 && f.tipo !== 'rectificativa') {
    add('signo', 'bloquea', 'extraccion', 'total negativo y el documento no es una rectificativa');
  }
  if (f.tipo === 'rectificativa' && f.totalFactura !== null && f.totalFactura > 0) {
    add('rectificativa_positiva', 'aviso', 'negocio', 'rectificativa con total positivo (puede ser correcto: rectificación al alza)');
  }

  // ── Fechas (año mal leído) ─────────────────────────────
  if (f.fechaEmision !== null) {
    const dias = diasEntre(f.fechaEmision, ctx.hoy);
    if (dias < 0) add('fecha_futura', 'bloquea', 'extraccion', `fecha de emisión futura (${f.fechaEmision})`);
    if (dias > ctx.antiguedadMaximaDias) add('fecha_antigua', 'bloquea', 'extraccion', `fecha de emisión de hace ${dias} días (${f.fechaEmision})`);
    // Pago anticipado real: aviso, nunca bloqueo.
    if (f.vencimientos.some((v) => f.fechaEmision !== null && v.fecha < f.fechaEmision)) {
      add('vencimiento_anterior', 'aviso', 'negocio', 'hay un vencimiento anterior a la fecha de emisión');
    }
  }
  // Varios plazos y a uno le falta el importe: desconocido no es cero (se guardaría 0 € y nadie lo pagaría).
  // Con un solo plazo, su importe es el total a pagar.
  if (f.vencimientos.length > 1) {
    const sinImporte = f.vencimientos.flatMap((v, i) => (v.importe === null ? [i + 1] : []));
    if (sinImporte.length > 0) add('importe_plazo', 'bloquea', 'extraccion', `falta el importe del plazo ${sinImporte.join(', ')} de ${f.vencimientos.length}`);
  }
  const importes = f.vencimientos.map((v) => v.importe);
  if (f.totalAPagar !== null && importes.length > 0 && importes.every((x): x is number => x !== null)) {
    const suma = importes.reduce((a, x) => a + x, 0);
    if (Math.abs(suma - f.totalAPagar) > tol) add('vencimientos_no_suman', 'aviso', 'extraccion', `los plazos suman ${eur(suma)} y el total a pagar es ${eur(f.totalAPagar)}`);
  }

  // ── Moneda: todo se guarda y se muestra en euros ─────────────────────────────
  // Una factura en otra moneda se registraría con un importe falso. La moneda leída
  // (también la de un XML) o, si no, el texto literal de los importes (evidencias):
  // una moneda extranjera y ningún euro. Sin ninguna pista, se acepta de un emisor
  // español (avisando, para contarlo); de otro país no se da por hecho que sea euro.
  const moneda = f.moneda !== null && f.moneda !== 'EUR' ? f.moneda : monedaExtranjera(f);
  if (moneda !== null) add('moneda_no_soportada', 'bloquea', 'negocio', `la factura parece estar en ${moneda}: sólo se registran facturas en euros`);
  else if (f.moneda === null && !hayEuroEnLosImportes(f)) {
    const deFuera = f.emisor.nif !== null && !validarNif(f.emisor.nif).valido;
    add('moneda_sin_identificar', deFuera ? 'bloquea' : 'aviso', 'negocio', deFuera ? 'el proveedor no es español y la factura no indica la moneda: comprueba que está en euros' : 'la factura no indica la moneda: se entiende que está en euros');
  }

  // ── ¿Los valores están en el documento? (vencimiento inventado) ─
  if (ctx.comprobacion?.comprobable === true) {
    const noEstan = Object.entries(ctx.comprobacion.campos)
      .filter(([campo, v]) => v === 'no_encontrado' && campo !== 'emisor_nif')
      .map(([campo]) => campo);
    if (noEstan.length > 0) add('valor_no_en_documento', 'bloquea', 'extraccion', `no aparecen en el documento: ${noEstan.join(', ')}`);

    // El NIF del emisor a veces va en una imagen de la cabecera y no está en el
    // texto (evaluación: 27 de 2.302 valores). Si es de un proveedor ya
    // aprobado, vale; si es la primera vez, que lo mire una persona.
    if (ctx.comprobacion.campos.emisor_nif === 'no_encontrado' && f.emisor.nif !== null && !ctx.proveedorConocido(f.emisor.nif)) {
      add('nif_no_verificable', 'bloquea', 'negocio', `el NIF del emisor (${f.emisor.nif}) no está en el texto del documento y no es de un proveedor conocido`);
    }
  }

  // ── Duplicados y proveedores ───────────────────────────────────────────────
  if (ctx.posibleDuplicadoDe !== null) {
    add('posible_duplicado', 'bloquea', 'negocio', `mismo emisor, fecha y total que otra factura con otro número (${ctx.posibleDuplicadoDe})`);
  }
  if (f.emisor.nif !== null && validarNifEmisor(f.emisor.nif).valido && !ctx.proveedorConocido(f.emisor.nif)) {
    add('proveedor_nuevo', 'aviso', 'negocio', `primera factura de ${f.emisor.nombre ?? f.emisor.nif}`);
  }

  return { resultados: r, empresaId };
}

export type Decision =
  | { readonly tipo: 'registrar'; readonly avisos: readonly Resultado[] }
  | { readonly tipo: 'segundo_intento'; readonly motivos: readonly Resultado[] }
  | { readonly tipo: 'revision'; readonly motivos: readonly [Resultado, ...Resultado[]] };

/**
 * Qué hacer con el resultado. Un bloqueo de extracción merece **un** segundo
 * intento con otro modelo si todavía no se ha hecho; uno de negocio va directo a
 * una persona (otro modelo leería lo mismo y sólo costaría dinero).
 */
export function decidir(v: Validacion, puedeSegundoIntento: boolean): Decision {
  const bloqueos = v.resultados.filter((x) => x.gravedad === 'bloquea');
  const [primero, ...resto] = bloqueos;
  if (primero === undefined) return { tipo: 'registrar', avisos: v.resultados };
  if (puedeSegundoIntento && bloqueos.every((x) => x.origen === 'extraccion')) return { tipo: 'segundo_intento', motivos: bloqueos };
  return { tipo: 'revision', motivos: [primero, ...resto] };
}

const EXTRANJERA = /(?<![A-Z])(USD|GBP|CHF|JPY|CNY|MXN|CAD|AUD|SEK|NOK|DKK|PLN|MAD)(?![A-Z])|US\$|\$|£|¥/;
const EURO = /€|(?<![A-Z])EUR(?![A-Z])|euros?\b/i;

/** Lo que una persona no puede aceptar con un «sí, es correcta»: el importe se guardaría en euros sin serlo. */
const NO_SE_PUEDEN_ACEPTAR: ReadonlySet<IdRegla> = new Set(['moneda_no_soportada']);

/** Los bloqueos que hay que resolver cambiando el dato: los de extracción y los que ninguna confirmación arregla. */
export function bloqueosQueNoSeAceptan<R extends Pick<Resultado, 'origen' | 'regla'>>(bloqueos: readonly R[]): R[] {
  return bloqueos.filter((x) => x.origen === 'extraccion' || NO_SE_PUEDEN_ACEPTAR.has(x.regla));
}

const textosDeImportes = (f: FacturaLeida): string[] =>
  Object.entries(f.evidencias)
    .filter(([campo, v]) => v !== null && v !== undefined && (campo.startsWith('total') || campo.startsWith('linea_') || campo.startsWith('vencimiento_')))
    .map(([, v]) => v ?? '');

const hayEuroEnLosImportes = (f: FacturaLeida): boolean => textosDeImportes(f).some((t) => EURO.test(t));

/** La moneda extranjera que aparece en los importes leídos, si ninguno está en euros; si no, `null`. */
export function monedaExtranjera(f: FacturaLeida): string | null {
  const textos = textosDeImportes(f);
  if (textos.length === 0 || hayEuroEnLosImportes(f)) return null;
  for (const t of textos) {
    const m = EXTRANJERA.exec(t);
    if (m !== null) return m[0] === '$' || m[0] === 'US$' ? 'USD' : m[0] === '£' ? 'GBP' : m[0] === '¥' ? 'JPY' : m[0];
  }
  return null;
}
