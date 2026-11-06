import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFRef } from "pdf-lib";
import sharp from "sharp";

type SourceImage =
  | { kind: "jpeg"; data: Buffer }
  | { kind: "raw"; data: Buffer; width: number; height: number; channels: 1 | 3 };

/**
 * Pixels of a PDF image sharp can re-encode: a JPEG stream as is, or a
 * Flate-compressed 8-bit RGB/gray bitmap (how many scanners save pages).
 * Null for anything else (CMYK, palettes, masks, predictors, custom decode).
 */
function readImage(stream: PDFRawStream): SourceImage | null {
  const dict = stream.dict;
  if (dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") return null;
  if (dict.get(PDFName.of("Decode"))) return null;
  if (dict.get(PDFName.of("ImageMask"))?.toString() === "true") return null;
  if (stream.contents.byteLength < 50 * 1024) return null;
  const filter = dict.get(PDFName.of("Filter"))?.toString();
  const colorSpace = dict.get(PDFName.of("ColorSpace"))?.toString() ?? "";
  if (/CMYK|Indexed|Separation|DeviceN/i.test(colorSpace)) return null;

  if (filter === "/DCTDecode") {
    return { kind: "jpeg", data: Buffer.from(stream.contents) };
  }

  if (filter === "/FlateDecode" && !dict.get(PDFName.of("DecodeParms"))) {
    const channels =
      colorSpace === "/DeviceRGB" ? 3 : colorSpace === "/DeviceGray" ? 1 : null;
    const bpc = Number(dict.get(PDFName.of("BitsPerComponent"))?.toString());
    const width = Number(dict.get(PDFName.of("Width"))?.toString());
    const height = Number(dict.get(PDFName.of("Height"))?.toString());
    if (!channels || bpc !== 8 || !(width > 0) || !(height > 0)) return null;
    try {
      const data = inflateSync(stream.contents);
      if (data.byteLength !== width * height * channels) return null;
      return { kind: "raw", data, width, height, channels };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Re-encode the scanned images inside a PDF (JPEG or 8-bit Flate bitmaps) so the
 * file fits under `maxBytes`, keeping it a PDF with its text and layout.
 * Steps down resolution and quality until it fits. Returns null when even the
 * smallest step doesn't fit, or the PDF can't be read.
 */
export async function compressPdfToFit(
  input: Buffer,
  maxBytes: number,
): Promise<Buffer | null> {
  if (input.byteLength <= maxBytes) return input;

  // Long side in pixels (~2200px is ≈190 DPI on A4) and JPEG quality.
  const steps = [
    { maxSide: 2200, quality: 75 },
    { maxSide: 1800, quality: 65 },
    { maxSide: 1500, quality: 55 },
    { maxSide: 1200, quality: 45 },
    { maxSide: 1000, quality: 40 },
  ];

  for (const step of steps) {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(input, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
    } catch {
      return null;
    }

    const images: Array<[PDFRef, PDFRawStream, SourceImage]> = [];
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const image = readImage(obj);
      if (image) images.push([ref, obj, image]);
    }
    if (images.length === 0) return null;

    for (const [ref, stream, image] of images) {
      try {
        const gray =
          image.kind === "raw"
            ? image.channels === 1
            : stream.dict.get(PDFName.of("ColorSpace"))?.toString() === "/DeviceGray";
        let pipeline = (
          image.kind === "jpeg"
            ? sharp(image.data, { failOn: "none" })
            : sharp(image.data, {
                raw: { width: image.width, height: image.height, channels: image.channels },
              })
        ).resize(step.maxSide, step.maxSide, {
          fit: "inside",
          withoutEnlargement: true,
        });
        if (gray) pipeline = pipeline.toColourspace("b-w");
        const { data, info } = await pipeline
          .jpeg({ quality: step.quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
          .toBuffer({ resolveWithObject: true });
        if (data.byteLength >= stream.contents.byteLength) continue;

        const dict = stream.dict.clone(doc.context);
        dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
        dict.delete(PDFName.of("DecodeParms"));
        dict.set(PDFName.of("Width"), PDFNumber.of(info.width));
        dict.set(PDFName.of("Height"), PDFNumber.of(info.height));
        dict.set(PDFName.of("Length"), PDFNumber.of(data.byteLength));
        dict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
        doc.context.assign(ref, PDFRawStream.of(dict, new Uint8Array(data)));
      } catch {
        // Leave an image sharp can't read as it was.
      }
    }

    const output = Buffer.from(await doc.save({ useObjectStreams: true }));
    if (output.byteLength <= maxBytes) return output;
  }

  return null;
}
