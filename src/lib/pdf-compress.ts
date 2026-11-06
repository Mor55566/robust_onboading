import { PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFRef } from "pdf-lib";
import sharp from "sharp";

/**
 * Re-encode the JPEG images inside a PDF (scans are almost all JPEG) so the
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

    const images: Array<[PDFRef, PDFRawStream]> = [];
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      if (dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
      // Only plain JPEG images; chained filters, CMYK and custom decode
      // arrays are left alone rather than risk changing how they look.
      if (dict.get(PDFName.of("Filter"))?.toString() !== "/DCTDecode") continue;
      if (dict.get(PDFName.of("Decode"))) continue;
      if (/CMYK/i.test(dict.get(PDFName.of("ColorSpace"))?.toString() ?? "")) continue;
      if (obj.contents.byteLength < 50 * 1024) continue;
      images.push([ref, obj]);
    }
    if (images.length === 0) return null;

    for (const [ref, stream] of images) {
      try {
        const gray =
          stream.dict.get(PDFName.of("ColorSpace"))?.toString() === "/DeviceGray";
        let pipeline = sharp(Buffer.from(stream.contents), { failOn: "none" })
          .rotate()
          .resize(step.maxSide, step.maxSide, {
            fit: "inside",
            withoutEnlargement: true,
          });
        if (gray) pipeline = pipeline.toColourspace("b-w");
        const { data, info } = await pipeline
          .jpeg({ quality: step.quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
          .toBuffer({ resolveWithObject: true });
        if (data.byteLength >= stream.contents.byteLength) continue;

        const dict = stream.dict.clone(doc.context);
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
