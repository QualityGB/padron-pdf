// @qualitygb/padron-pdf — generador de padrones electorales en PDF.
//
// AGNÓSTICO de base de datos: le pasas un `fuenteDatos` (async iterable). Lo usa
// la API de la JCE (datos de la junta) y el software del partido (sus miembros).
//   - generarPadronOficial: diseño OFICIAL (portada JCE, agrupado por recinto,
//     checkbox para marcar a lápiz). Recomendado.
//   - generarPadron: diseño simple (lista plana). Para usos básicos.

export { generarPadronOficial } from "./generarOficial";
export type {
  ElectorPadron,
  RecintoMetaPadron,
  MetaPadron,
  OpcionesPadronOficial,
} from "./generarOficial";

export { generarPadron } from "./generar";

export { almacenamientoLocal } from "./storage/local";
export type { OpcionesLocal } from "./storage/local";
export { almacenamientoS3 } from "./storage/s3";
export type { OpcionesS3 } from "./storage/s3";

export { fuenteFotosConCache, presignFotos, descargarFotoUrl } from "./fotos";
export type { OpcionesFotoCache, OpcionesPresign } from "./fotos";

export type {
  CiudadanoPadron,
  AdaptadorStorage,
  MarcaPartido,
  OpcionesPlantilla,
  OpcionesPadron,
  ResultadoPadron,
} from "./tipos";
