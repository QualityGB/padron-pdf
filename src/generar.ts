import PDFDocument from "pdfkit";
import { PassThrough } from "node:stream";
import type { OpcionesPadron, ResultadoPadron, CiudadanoPadron, MarcaPartido, OpcionesPlantilla } from "./tipos";

const VERDE = "#1D9E75";
const GRIS = "#6B6A66";
const MARGEN = 36;

const nombreCompleto = (c: CiudadanoPadron) =>
  [c.nombres, c.apellido1, c.apellido2].filter(Boolean).join(" ").trim() || "—";

/**
 * Genera un padrón en PDF por streaming: nunca carga todos los ciudadanos en
 * memoria — los consume del async iterable y los va escribiendo página a página,
 * subiendo el PDF al storage en paralelo. Escala a millones de filas.
 */
export async function generarPadron(opts: OpcionesPadron): Promise<ResultadoPadron> {
  const {
    fuenteDatos, fuenteFotos, storage, nombreArchivo, plantilla, marca,
    concurrenciaFotos = 8, onProgreso,
  } = opts;
  const conFoto = (plantilla.conFoto ?? true) && Boolean(fuenteFotos);
  const tamanoFoto = plantilla.tamanoFoto ?? 48;

  const doc = new PDFDocument({ size: "LETTER", margin: MARGEN, bufferPages: true, autoFirstPage: false });

  // El PDF se escribe a un stream que va directo al storage (sin buffer total).
  const paso = new PassThrough();
  doc.pipe(paso);
  const urlPromesa = storage.guardar(nombreArchivo, paso);

  let total = 0;
  let y = 0;
  let primeraEnPagina = true;

  const nuevaPagina = () => {
    doc.addPage();
    dibujarMarcaFondo(doc, marca);
    y = encabezado(doc, plantilla, marca);
    primeraEnPagina = true;
  };
  nuevaPagina();

  const anchoUtil = doc.page.width - MARGEN * 2;
  const altoFila = Math.max(conFoto ? tamanoFoto + 12 : 34, 34);
  const limiteY = doc.page.height - MARGEN - 24;

  // Pre-carga de fotos con concurrencia: se piden por adelantado en ventanas.
  const cola: CiudadanoPadron[] = [];
  for await (const c of fuenteDatos) {
    cola.push(c);
    if (cola.length >= concurrenciaFotos) {
      await volcarLote(cola.splice(0, cola.length));
    }
  }
  if (cola.length) await volcarLote(cola);

  async function volcarLote(lote: CiudadanoPadron[]) {
    const fotos = conFoto && fuenteFotos
      ? await Promise.all(lote.map((c) => fuenteFotos(c.cedula).catch(() => null)))
      : lote.map(() => null);

    lote.forEach((c, i) => {
      if (y + altoFila > limiteY) nuevaPagina();
      dibujarFila(doc, c, fotos[i], y, anchoUtil, altoFila, conFoto, tamanoFoto, primeraEnPagina);
      primeraEnPagina = false;
      y += altoFila;
      total++;
    });
    onProgreso?.(total);
  }

  // Numeración de páginas (footer) usando bufferPages.
  const rango = doc.bufferedPageRange();
  const paginas = rango.count;
  for (let i = 0; i < paginas; i++) {
    doc.switchToPage(rango.start + i);
    pie(doc, plantilla, i + 1, paginas);
  }

  doc.end();
  const url = await urlPromesa;
  return { url, total, paginas };
}

function dibujarMarcaFondo(doc: PDFKit.PDFDocument, marca?: MarcaPartido) {
  if (!marca?.texto) return;
  const { width, height } = doc.page;
  doc.save();
  doc.rotate(-30, { origin: [width / 2, height / 2] });
  doc.fillColor(marca.color ?? "#000000").opacity(marca.opacidad ?? 0.08)
    .fontSize(54).font("Helvetica-Bold")
    .text(marca.texto, 0, height / 2 - 30, { width, align: "center" });
  doc.restore();
  doc.opacity(1);
}

function encabezado(doc: PDFKit.PDFDocument, p: OpcionesPlantilla, marca?: MarcaPartido): number {
  let x = MARGEN;
  const top = MARGEN;
  if (marca?.logo) {
    try { doc.image(marca.logo, x, top, { fit: [40, 40] }); x += 50; } catch { /* logo inválido */ }
  }
  doc.fillColor("#1A1A1A").font("Helvetica-Bold").fontSize(15).text(p.titulo, x, top, { lineBreak: false });
  if (p.subtitulo) {
    doc.fillColor(GRIS).font("Helvetica").fontSize(9.5).text(p.subtitulo, x, top + 19, { lineBreak: false });
  }
  const yLinea = top + (p.subtitulo ? 36 : 26);
  doc.moveTo(MARGEN, yLinea).lineTo(doc.page.width - MARGEN, yLinea).lineWidth(1).strokeColor(VERDE).stroke();
  return yLinea + 8;
}

function dibujarFila(
  doc: PDFKit.PDFDocument, c: CiudadanoPadron, foto: Buffer | null,
  y: number, ancho: number, alto: number, conFoto: boolean, tamanoFoto: number, _primera: boolean
) {
  const x = MARGEN;
  let xTexto = x + 4;
  if (conFoto) {
    const fy = y + (alto - tamanoFoto) / 2;
    if (foto) {
      try { doc.image(foto, x + 2, fy, { fit: [tamanoFoto, tamanoFoto] }); } catch { recuadroFoto(doc, x + 2, fy, tamanoFoto); }
    } else {
      recuadroFoto(doc, x + 2, fy, tamanoFoto);
    }
    xTexto = x + tamanoFoto + 12;
  }
  const anchoTexto = ancho - (xTexto - x) - 4;

  // Cada línea se limita a su altura con ellipsis: nunca se desborda ni solapa.
  doc.fillColor("#1A1A1A").font("Helvetica-Bold").fontSize(10)
    .text(nombreCompleto(c), xTexto, y + 4, { width: anchoTexto, height: 12, ellipsis: true });

  const linea2 = [
    `Cédula: ${c.cedula}`,
    c.colegio ? `Colegio: ${c.colegio}` : null,
    c.recinto ? `Recinto: ${c.recinto}` : null,
  ].filter(Boolean).join("   ·   ");
  doc.fillColor(GRIS).font("Helvetica").fontSize(8.5)
    .text(linea2, xTexto, y + 18, { width: anchoTexto, height: 11, ellipsis: true });

  const linea3 = [
    c.municipio ? `Municipio: ${c.municipio}` : null,
    c.sexo ? `Sexo: ${c.sexo}` : null,
    c.fechanacimiento ? `Nac.: ${c.fechanacimiento}` : null,
    ...Object.entries(c.extra ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
  ].filter(Boolean).join("   ·   ");
  if (linea3) {
    doc.fillColor(GRIS).fontSize(8.5).text(linea3, xTexto, y + 30, { width: anchoTexto, height: 11, ellipsis: true });
  }

  doc.moveTo(x, y + alto - 2).lineTo(x + ancho, y + alto - 2).lineWidth(0.4).strokeColor("#E5E2DA").stroke();
}

function recuadroFoto(doc: PDFKit.PDFDocument, x: number, y: number, t: number) {
  doc.save().rect(x, y, t, t).fillColor("#F1EFE8").fill();
  doc.fillColor("#B4B2A9").fontSize(7).text("s/foto", x, y + t / 2 - 4, { width: t, align: "center" });
  doc.restore();
}

function pie(doc: PDFKit.PDFDocument, p: OpcionesPlantilla, n: number, total: number) {
  const y = doc.page.height - MARGEN - 6;
  doc.fillColor(GRIS).font("Helvetica").fontSize(8).opacity(1);
  if (p.pie) doc.text(p.pie, MARGEN, y, { lineBreak: false });
  doc.text(`Página ${n} de ${total}`, doc.page.width - MARGEN - 120, y, { width: 120, align: "right", lineBreak: false });
}
