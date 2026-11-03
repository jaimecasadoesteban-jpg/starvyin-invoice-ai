/**
 * Máquina de estados de un documento recibido.
 *
 * Función pura: recibe el estado y un evento y devuelve el estado nuevo o un
 * error. No toca la base ni el reloj; quien persiste es `src/db/documentos.ts`,
 * que bloquea la fila antes de aplicar la transición.
 *
 * docs/ENGINEERING_RULES.md, regla 4: **ningún documento termina en silencio**. Por eso:
 * - `en_revision` no se construye sin al menos un motivo (tipo `Motivos`).
 * - Un error de extracción no puede quedarse en `error_extraccion` para siempre:
 *   al agotar los intentos pasa a revisión.
 * - `duplicado` siempre dice de qué es duplicado.
 */

export const ESTADOS = [
  'recibido',
  'extraido',
  'error_extraccion',
  'en_revision',
  'pendiente_reenvio',
  'registrada',
  'duplicado',
  'no_factura',
  'descartado',
  'sustituido',
] as const;
export type EstadoDocumento = (typeof ESTADOS)[number];

/** Estados de los que no se sale con eventos normales (sí con una corrección explícita, más adelante). */
export const FINALES: readonly EstadoDocumento[] = ['registrada', 'duplicado', 'no_factura', 'descartado', 'sustituido'];

/** Al menos un motivo: un documento en revisión sin motivo es un documento que nadie sabe por qué mirar. */
export type Motivos = readonly [string, ...string[]];

export type Evento =
  /** Imagen sin contenido útil (logo de una firma): se descarta antes de llamar al modelo. */
  | { readonly tipo: 'descartar_sin_modelo'; readonly razon: string }
  /** Mismo archivo (hash) o misma factura (NIF + número + ejercicio) que otro documento. */
  | { readonly tipo: 'detectar_duplicado'; readonly originalId: string }
  /** Formato que no se sabe leer (DOCX, ZIP…): a revisión, nunca descartado en silencio. */
  /** `detalle`: el error técnico, sólo para el historial (el motivo que ve la persona es `formato`). */
  | { readonly tipo: 'formato_no_soportado'; readonly formato: string; readonly detalle?: string }
  /** El modelo dice que no es una factura (publicidad, carta…). */
  | { readonly tipo: 'no_es_factura' }
  | { readonly tipo: 'extraccion_ok' }
  /** `intentos` cuenta también este. Al llegar al máximo, a revisión. */
  | { readonly tipo: 'extraccion_fallida'; readonly intentos: number; readonly maximo: number; readonly error: string }
  /** Resultado de la validación por código. */
  | { readonly tipo: 'validacion_ok' }
  | { readonly tipo: 'validacion_bloquea'; readonly reglas: Motivos }
  /** Decisión de una persona en la cola de revisión. */
  | { readonly tipo: 'revision_registrar' }
  | { readonly tipo: 'revision_no_factura' }
  | { readonly tipo: 'revision_duplicado'; readonly originalId: string }
  | { readonly tipo: 'revision_pedir_reenvio'; readonly razon: string }
  /** Una persona pide leerlo otra vez (tras un arreglo, o si la IA estuvo caída): vuelve a la cola, desde cero. */
  | { readonly tipo: 'revision_volver_a_leer' }
  /** Ha llegado el documento que sustituye a éste (tras pedir reenvío). */
  | { readonly tipo: 'reenviado'; readonly nuevoId: string };

export type TipoEvento = Evento['tipo'];

export type Transicion =
  | {
      readonly ok: true;
      readonly a: EstadoDocumento;
      /** Lo que se guarda en `documentos.motivos`: por qué está así. */
      readonly motivos: readonly string[];
      readonly duplicadoDe?: string;
    }
  | { readonly ok: false; readonly error: 'transicion_invalida'; readonly de: EstadoDocumento; readonly evento: TipoEvento };

const invalida = (de: EstadoDocumento, evento: TipoEvento): Transicion => ({ ok: false, error: 'transicion_invalida', de, evento });

export function transicionar(de: EstadoDocumento, evento: Evento): Transicion {
  switch (evento.tipo) {
    case 'descartar_sin_modelo':
      return de === 'recibido' ? { ok: true, a: 'descartado', motivos: [evento.razon] } : invalida(de, evento.tipo);

    case 'detectar_duplicado':
      return de === 'recibido' || de === 'extraido'
        ? { ok: true, a: 'duplicado', motivos: [`duplicado de ${evento.originalId}`], duplicadoDe: evento.originalId }
        : invalida(de, evento.tipo);

    case 'formato_no_soportado':
      return de === 'recibido' ? { ok: true, a: 'en_revision', motivos: [`formato no soportado: ${evento.formato}`] } : invalida(de, evento.tipo);

    case 'no_es_factura':
      return de === 'recibido' || de === 'error_extraccion' ? { ok: true, a: 'no_factura', motivos: ['el modelo dice que no es una factura'] } : invalida(de, evento.tipo);

    case 'extraccion_ok':
      return de === 'recibido' || de === 'error_extraccion' ? { ok: true, a: 'extraido', motivos: [] } : invalida(de, evento.tipo);

    case 'extraccion_fallida': {
      if (de !== 'recibido' && de !== 'error_extraccion') return invalida(de, evento.tipo);
      return evento.intentos >= evento.maximo
        ? { ok: true, a: 'en_revision', motivos: [`extracción fallida ${evento.intentos} veces: ${evento.error}`] }
        : { ok: true, a: 'error_extraccion', motivos: [evento.error] };
    }

    case 'validacion_ok':
      return de === 'extraido' ? { ok: true, a: 'registrada', motivos: [] } : invalida(de, evento.tipo);

    case 'validacion_bloquea':
      return de === 'extraido' ? { ok: true, a: 'en_revision', motivos: [...evento.reglas] } : invalida(de, evento.tipo);

    case 'revision_registrar':
      return de === 'en_revision' ? { ok: true, a: 'registrada', motivos: [] } : invalida(de, evento.tipo);

    case 'revision_no_factura':
      return de === 'en_revision' ? { ok: true, a: 'no_factura', motivos: ['una persona dice que no es una factura'] } : invalida(de, evento.tipo);

    case 'revision_duplicado':
      return de === 'en_revision'
        ? { ok: true, a: 'duplicado', motivos: [`duplicado de ${evento.originalId}`], duplicadoDe: evento.originalId }
        : invalida(de, evento.tipo);

    case 'revision_pedir_reenvio':
      return de === 'en_revision' ? { ok: true, a: 'pendiente_reenvio', motivos: [evento.razon] } : invalida(de, evento.tipo);

    case 'revision_volver_a_leer':
      return de === 'en_revision' ? { ok: true, a: 'recibido', motivos: [] } : invalida(de, evento.tipo);

    case 'reenviado':
      return de === 'pendiente_reenvio' ? { ok: true, a: 'sustituido', motivos: [`sustituido por ${evento.nuevoId}`] } : invalida(de, evento.tipo);
  }
}
