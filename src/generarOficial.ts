// Generador del PADRÓN ELECTORAL en PDF — diseño OFICIAL (modelo JCE/PDN):
// portada + una sección por recinto (con su meta-grid) + sub-grupos por colegio
// + tarjetas de elector con foto, sello "JCE" y CHECKBOX para marcar a lápiz.
// Colores oficiales (tricolor dominicano). Streaming con PDFKit → storage.
//
// Es AGNÓSTICO de la base de datos: recibe `fuenteDatos` (async iterable de
// electores ya ENRIQUECIDOS y ORDENADOS por recinto→colegio→cédula). Lo usa
// tanto la API de la JCE (datos de la junta) como el software del partido
// (sus propios miembros) — cada quien arma su `fuenteDatos` desde SU base.
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import type { AdaptadorStorage, MarcaPartido } from "./tipos";

const NAVY900 = "#0F1E3D", NAVY800 = "#1A2F5A", NAVY100 = "#E2E8F4";
const RED600 = "#C8102E", AMBER500 = "#E0A106";
const STRONG = "#15223B", BODY = "#374151", MUTED = "#6B7280", FAINT = "#9AA1AC";
const BORDER = "#E5E7EB", SUNKEN = "#F7F6F2", CARD = "#FFFFFF";

const M = 40;
const PAGE_W = 612, PAGE_H = 792;
const CONTENT_W = PAGE_W - M * 2;
const FOOTER_Y = PAGE_H - 30;

const up = (s: unknown) => String(s ?? "").toUpperCase();
const fmtNum = (n: unknown) => Number(n ?? 0).toLocaleString("es-DO");

/** Meta del recinto que se muestra en su cabecera (grid de 8 campos). */
export interface RecintoMetaPadron {
  sector?: string | null;
  circ?: string | null;
  muni?: string | null;
  prov?: string | null;
  ciudad?: string | null;
  zona?: string | null;
  colegios?: number | string | null;
  electores?: number | string | null;
}

/** Un elector ya enriquecido para el diseño oficial (agrupado por recinto/colegio). */
export interface ElectorPadron {
  cedula: string;
  nombres?: string | null;
  apellido1?: string | null;
  apellido2?: string | null;
  /** Texto del sexo (ej. "MASCULINO" / "FEMENINO"). */
  sexo?: string | null;
  /** Código del sexo para colorear ("M" / "F"). */
  sexoCode?: string | null;
  fechanacimiento?: string | null;
  /** Código del colegio/mesa (se muestra en la tarjeta y agrupa). */
  colegio?: string | null;
  /** Nº de electores del colegio (para el pill del colegio). */
  colegioElectores?: number | string | null;
  recintoNombre: string;
  recintoDireccion?: string | null;
  recintoCodigo?: string | null;
  recintoMeta?: RecintoMetaPadron;
}

/** Cabecera/portada del documento. */
export interface MetaPadron {
  /** Breadcrumb del ámbito, ej. ["Distrito Nacional", "Distrito Nacional", "Recinto X"]. */
  scope: string[];
  /** Nivel, ej. "Recinto" / "Municipio" / "Provincia" / "Colegio". */
  level: string;
  /** Código del documento, ej. "PADRON-20260101-0001". */
  code: string;
  /** Fecha y hora de generación (texto ya formateado). */
  date: string;
  time: string;
  counts: { electores: number; recintos: number; colegios: number };
  /** Marca/sello del partido (opcional). */
  marca?: MarcaPartido;
  /** Fuente larga para la portada. Default: "API JCE — base de datos nacional". */
  fuente?: string;
  /** Fuente corta para el pie. Default: "Generado vía API JCE". */
  fuenteCorta?: string;
}

export interface OpcionesPadronOficial {
  meta: MetaPadron;
  fuenteDatos: AsyncIterable<ElectorPadron>;
  fuenteFotos?: (cedula: string) => Promise<Buffer | null> | Buffer | null;
  storage: AdaptadorStorage;
  nombreArchivo: string;
}

export async function generarPadronOficial(
  { meta, fuenteDatos, fuenteFotos, storage, nombreArchivo }: OpcionesPadronOficial,
): Promise<{ url: string; total: number; paginas: number }> {
  const doc = new PDFDocument({ size: "LETTER", margin: M, bufferPages: true, autoFirstPage: false });
  const paso = new PassThrough();
  const urlPromesa = storage.guardar(nombreArchivo, paso);
  doc.pipe(paso);

  const scopeTxt = (meta.scope || []).join("  ›  ");
  const fuenteLarga = meta.fuente ?? "API JCE — base de datos nacional";
  const fuenteCorta = meta.fuenteCorta ?? "Generado vía API JCE";
  const totalPagesPlaceholder = "{N}";
  let total = 0;

  // Truncado robusto: mide el ancho real (setear font+fontSize antes de llamar).
  const trunc = (str: unknown, maxW: number): string => {
    let s = String(str ?? "");
    if (doc.widthOfString(s) <= maxW) return s;
    while (s.length > 1 && doc.widthOfString(s + "…") > maxW) s = s.slice(0, -1);
    return s.replace(/\s+$/, "") + "…";
  };

  const tricolor = (x: number, yy: number, w = 26) => {
    const pad = 3, bw = w - pad * 2, bh = 3, gap = 2;
    doc.save().roundedRect(x, yy, w, bh * 3 + gap * 2 + pad * 2, 4).fill(NAVY800);
    ["#FFFFFF", RED600, AMBER500].forEach((c, i) => {
      doc.roundedRect(x + pad, yy + pad + i * (bh + gap), bw, bh, 1.5).fill(c);
    });
    doc.restore();
  };
  const iconoLandmark = (cx: number, cy: number) => {
    doc.save().fillColor(NAVY800).strokeColor(NAVY800).lineWidth(1.1);
    doc.moveTo(cx - 8, cy - 3).lineTo(cx, cy - 9).lineTo(cx + 8, cy - 3).closePath().fill();
    doc.rect(cx - 8, cy + 6, 16, 2).fill();
    [-6, -2, 2, 6].forEach((dx) => doc.rect(cx + dx - 0.7, cy - 2, 1.6, 8).fill());
    doc.restore();
  };
  const marcaFondo = () => {
    const m = meta.marca;
    if (!m?.texto) return;
    doc.save();
    doc.rotate(-30, { origin: [PAGE_W / 2, PAGE_H / 2] });
    doc.fillColor(m.color || NAVY800).opacity(m.opacidad ?? 0.06)
      .font("Helvetica-Bold").fontSize(60)
      .text(up(m.texto), 0, PAGE_H / 2 - 30, { width: PAGE_W, align: "center" });
    doc.restore().opacity(1);
  };

  const runHead = (): number => {
    const yy = M;
    tricolor(M, yy, 24);
    doc.fillColor(NAVY800).font("Helvetica-Bold").fontSize(10.5)
      .text("PADRÓN ELECTORAL · JCE", M + 32, yy - 1, { lineBreak: false });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8)
      .text(scopeTxt, M + 32, yy + 12, { width: CONTENT_W - 160, lineBreak: false, ellipsis: true });
    doc.fillColor(NAVY800).font("Courier-Bold").fontSize(8.5)
      .text(meta.code, PAGE_W - M - 160, yy, { width: 160, align: "right", lineBreak: false });
    doc.moveTo(M, yy + 26).lineTo(PAGE_W - M, yy + 26).lineWidth(1.4).strokeColor(NAVY800).stroke();
    return yy + 38;
  };
  const footer = () => {
    doc.fillColor(FAINT).font("Helvetica").fontSize(8)
      .text(`${fuenteCorta} · ${meta.date} · ${meta.code}`, M, FOOTER_Y, { lineBreak: false });
  };

  let y = 0;
  const nuevaPaginaElectores = () => { doc.addPage(); marcaFondo(); footer(); y = runHead(); };
  const asegurar = (h: number) => { if (y + h > FOOTER_Y - 8) nuevaPaginaElectores(); };

  // ---- PORTADA ----
  doc.addPage(); marcaFondo();
  {
    const cx = M + 28, cy = M + 26;
    doc.save().circle(cx, cy, 26).lineWidth(2).strokeColor(NAVY800).stroke();
    doc.fillColor(NAVY800).font("Helvetica-Bold").fontSize(13).text("JCE", cx - 26, cy - 7, { width: 52, align: "center" });
    doc.restore();
    doc.fillColor(NAVY800).font("Helvetica-Bold").fontSize(13).text("JUNTA CENTRAL ELECTORAL", M + 70, M + 12, { width: CONTENT_W - 140, align: "center" });
    doc.fillColor(MUTED).font("Helvetica").fontSize(10.5).text("República Dominicana", M + 70, M + 30, { width: CONTENT_W - 140, align: "center" });
    tricolor(PAGE_W - M - 34, M + 6, 34);
    doc.fillColor(NAVY800).font("Helvetica-Bold").fontSize(9).text("PDN", PAGE_W - M - 40, M + 36, { width: 40, align: "center" });
    doc.moveTo(M, M + 58).lineTo(PAGE_W - M, M + 58).lineWidth(2).strokeColor(NAVY800).stroke();
    doc.moveTo(M, M + 62).lineTo(PAGE_W - M, M + 62).lineWidth(0.8).strokeColor(NAVY800).stroke();

    let ty = M + 120;
    doc.fillColor(RED600).font("Helvetica-Bold").fontSize(13).text("P A D R Ó N   E L E C T O R A L", M, ty, { width: CONTENT_W, align: "center", characterSpacing: 1 });
    ty += 26;
    doc.fillColor(NAVY900).font("Helvetica-Bold").fontSize(30).text(up(meta.scope[meta.scope.length - 1] || "República Dominicana"), M, ty, { width: CONTENT_W, align: "center" });
    ty = doc.y + 6;
    doc.fillColor(MUTED).font("Helvetica").fontSize(12).text(`Nivel: ${meta.level}`, M, ty, { width: CONTENT_W, align: "center" });
    ty = doc.y + 14;
    doc.fillColor(BODY).font("Helvetica").fontSize(11).text(scopeTxt, M, ty, { width: CONTENT_W, align: "center" });
    ty = doc.y + 28;

    const boxes: [string, number][] = [["Electores", meta.counts.electores], ["Recintos", meta.counts.recintos], ["Colegios", meta.counts.colegios]];
    const bw = (CONTENT_W - 28) / 3;
    boxes.forEach((b, i) => {
      const bx = M + i * (bw + 14);
      doc.roundedRect(bx, ty, bw, 76, 10).fillAndStroke(SUNKEN, BORDER);
      doc.fillColor(NAVY800).font("Helvetica-Bold").fontSize(26).text(fmtNum(b[1]), bx, ty + 16, { width: bw, align: "center" });
      doc.fillColor(MUTED).font("Helvetica").fontSize(11).text(b[0], bx, ty + 50, { width: bw, align: "center" });
    });

    const fy = PAGE_H - 120;
    doc.moveTo(M, fy).lineTo(PAGE_W - M, fy).lineWidth(1).strokeColor(BORDER).stroke();
    const linea = (lbl: string, val: string, yy: number) => {
      doc.fillColor(STRONG).font("Helvetica-Bold").fontSize(10).text(lbl, M, yy, { continued: true });
      doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(val);
    };
    linea("Código: ", meta.code, fy + 12);
    linea("Generado: ", `${meta.date} · ${meta.time}`, fy + 28);
    linea("Fuente: ", fuenteLarga, fy + 44);
    doc.fillColor(NAVY800).font("Helvetica-Bold").fontSize(10).text(`Página 1 de ${totalPagesPlaceholder}`, PAGE_W - M - 220, fy + 12, { width: 220, align: "right" });
    doc.fillColor(FAINT).font("Helvetica-Oblique").fontSize(9)
      .text("Documento oficial de uso interno del partido.\nDatos protegidos — Ley 15-19 de Régimen Electoral.", PAGE_W - M - 240, fy + 30, { width: 240, align: "right" });
  }

  // ---- PÁGINAS DE ELECTORES ----
  nuevaPaginaElectores();
  let recActual: string | null = null, colActual: string | null = null, lineaRecinto = 0;
  let rowY = 0;
  const COL_GAP = 12, CARD_W = (CONTENT_W - COL_GAP) / 2, CARD_H = 58, FOTO = 44;
  let colIdx = 0;

  const meta2 = (label: string, val: unknown, x: number, w: number) => {
    doc.fillColor(FAINT).font("Helvetica-Bold").fontSize(7.5).text(trunc(up(label), w), x, rowY, { lineBreak: false });
    doc.fillColor(STRONG).font("Helvetica-Bold").fontSize(9).text(trunc(val || "—", w), x, rowY + 10, { lineBreak: false });
  };

  const dibujarRecinto = (r: ElectorPadron) => {
    asegurar(120);
    const bx = M, bw = CONTENT_W;
    const m = r.recintoMeta || {};
    const bh = 92;
    doc.roundedRect(bx, y, bw, bh, 10).fillAndStroke(SUNKEN, BORDER);
    doc.roundedRect(bx + 12, y + 12, 30, 30, 7).fill(NAVY100);
    iconoLandmark(bx + 12 + 15, y + 12 + 15);
    doc.fillColor(NAVY900).font("Helvetica-Bold").fontSize(13.5);
    doc.text(trunc(`RECINTO: ${up(r.recintoNombre)}`, bw - 170), bx + 50, y + 12, { lineBreak: false });
    doc.fillColor(MUTED).font("Helvetica").fontSize(9.5);
    doc.text(trunc(r.recintoDireccion || "—", bw - 170), bx + 50, y + 28, { lineBreak: false });
    doc.fillColor(NAVY800).font("Helvetica-Bold").fontSize(9)
      .text(`Recinto ${r.recintoCodigo || ""}`, bx + bw - 110, y + 14, { width: 98, align: "right", lineBreak: false });
    rowY = y + 50;
    const gw = (bw - 24) / 4;
    ([["Sector / Paraje", m.sector], ["Circunscripción", m.circ], ["Municipio", m.muni], ["Provincia", m.prov]] as [string, unknown][])
      .forEach((c, i) => meta2(c[0], c[1], bx + 12 + i * gw, gw - 8));
    rowY += 24;
    ([["Ciudad / Sección", m.ciudad], ["Zona", m.zona], ["Colegios", String(m.colegios ?? "—")], ["Electores", fmtNum(m.electores)]] as [string, unknown][])
      .forEach((c, i) => meta2(c[0], c[1], bx + 12 + i * gw, gw - 8));
    y += bh + 12;
  };

  const dibujarColegioPill = (cod: string, n: number | string) => {
    asegurar(24);
    doc.roundedRect(M, y, 84, 16, 8).fill(NAVY800);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8.5).text(`COLEGIO ${cod}`, M, y + 4, { width: 84, align: "center", lineBreak: false });
    doc.moveTo(M + 92, y + 8).lineTo(PAGE_W - M - 70, y + 8).lineWidth(1).strokeColor(BORDER).stroke();
    doc.fillColor(FAINT).font("Helvetica-Bold").fontSize(8.5).text(`${n} electores`, PAGE_W - M - 70, y + 4, { width: 70, align: "right", lineBreak: false });
    y += 24; colIdx = 0; rowY = y;
  };

  const dibujarTarjeta = async (v: ElectorPadron & { linea: number }) => {
    if (colIdx === 0) { asegurar(CARD_H + 9); rowY = y; }
    const x = M + colIdx * (CARD_W + COL_GAP);
    doc.roundedRect(x, rowY, CARD_W, CARD_H, 7).fillAndStroke(CARD, BORDER);
    const fx = x + 8, fy2 = rowY + (CARD_H - FOTO) / 2;
    let foto: Buffer | null = null;
    try { foto = (await fuenteFotos?.(v.cedula)) ?? null; } catch { foto = null; }
    if (foto) {
      try { doc.save().roundedRect(fx, fy2, FOTO, FOTO, 5).clip().image(foto, fx, fy2, { fit: [FOTO, FOTO], align: "center", valign: "center" }).restore(); }
      catch { doc.roundedRect(fx, fy2, FOTO, FOTO, 5).fillAndStroke("#EFEEE9", BORDER); }
    } else {
      doc.roundedRect(fx, fy2, FOTO, FOTO, 5).fillAndStroke("#EFEEE9", BORDER);
      doc.fillColor(FAINT).font("Helvetica").fontSize(7).text("s/foto", fx, fy2 + FOTO / 2 - 4, { width: FOTO, align: "center" });
    }
    doc.roundedRect(fx, fy2 + FOTO - 9, FOTO, 9, 0).fill("#FFFFFF");
    doc.fillColor(FAINT).font("Helvetica-Bold").fontSize(6.5).text("JCE", fx, fy2 + FOTO - 8, { width: FOTO, align: "center", lineBreak: false });
    // checkbox para marcar a lápiz
    const CHK = 14, RESERVA = CHK + 10;
    const cbx = x + CARD_W - RESERVA + 2, cby = rowY + (CARD_H - CHK) / 2;
    doc.roundedRect(cbx, cby, CHK, CHK, 3).lineWidth(1.2).fillAndStroke("#FFFFFF", "#9AA1AC");

    const tx = fx + FOTO + 9, tw = CARD_W - FOTO - 26 - RESERVA;
    doc.fillColor(FAINT).font("Helvetica-Bold").fontSize(8).text(`#${String(v.linea).padStart(3, "0")}`, tx, rowY + 7, { lineBreak: false });
    doc.fillColor(v.sexoCode === "F" ? RED600 : NAVY800).font("Helvetica-Bold").fontSize(8)
      .text(v.sexo || "", tx, rowY + 7, { width: tw, align: "right", lineBreak: false });
    doc.fillColor(STRONG).font("Helvetica-Bold").fontSize(9.5);
    doc.text(trunc(up(`${v.nombres ?? ""} ${v.apellido1 ?? ""} ${v.apellido2 ?? ""}`).replace(/\s+/g, " ").trim(), tw), tx, rowY + 18, { lineBreak: false });
    doc.fillColor(NAVY800).font("Courier-Bold").fontSize(9.5).text(v.cedula, tx, rowY + 31, { lineBreak: false });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text(trunc(`Nac. ${v.fechanacimiento || "—"} · Colegio ${v.colegio || "—"}`, tw), tx, rowY + 43, { lineBreak: false });

    colIdx++;
    if (colIdx >= 2) { colIdx = 0; y = rowY + CARD_H + 9; }
  };

  for await (const v of fuenteDatos) {
    if (v.recintoNombre !== recActual) {
      if (colIdx === 1) { colIdx = 0; y = rowY + CARD_H + 9; }
      recActual = v.recintoNombre; colActual = null; lineaRecinto = 0;
      dibujarRecinto(v);
    }
    if ((v.colegio ?? null) !== colActual) {
      if (colIdx === 1) { colIdx = 0; y = rowY + CARD_H + 9; }
      colActual = v.colegio ?? null;
      dibujarColegioPill(v.colegio ?? "", v.colegioElectores ?? "");
    }
    lineaRecinto++;
    await dibujarTarjeta({ ...v, linea: lineaRecinto });
    total++;
  }
  if (total === 0) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(12).text("No se encontraron electores para este ámbito.", M, y + 20, { width: CONTENT_W, align: "center" });
  }

  // numerar páginas (anular margen inferior evita que PDFKit duplique hojas)
  const rango = doc.bufferedPageRange();
  const N = rango.count;
  for (let i = 0; i < N; i++) {
    doc.switchToPage(rango.start + i);
    doc.page.margins.bottom = 0;
    if (i === 0) continue;
    doc.fillColor(FAINT).font("Helvetica").fontSize(8)
      .text(`Página ${i + 1} de ${N}`, PAGE_W - M - 120, FOOTER_Y, { width: 120, align: "right", lineBreak: false });
  }
  doc.switchToPage(rango.start);
  doc.page.margins.bottom = 0;
  const fy = PAGE_H - 120;
  doc.save().rect(PAGE_W - M - 220, fy + 10, 220, 16).fill("#FFFFFF").restore();
  doc.fillColor(NAVY800).font("Helvetica-Bold").fontSize(10)
    .text(`Página 1 de ${N}`, PAGE_W - M - 220, fy + 12, { width: 220, align: "right", lineBreak: false });

  doc.end();
  const url = await urlPromesa;
  return { url, total, paginas: N };
}
