import exifr from 'exifr';

type RawMetadata = {
  exifData: Record<string, unknown> | undefined;
  xmpData: Record<string, unknown> | undefined;
  iptcData: Record<string, unknown> | undefined;
  iccData: Record<string, unknown> | undefined;
  gpsRaw: Record<string, unknown> | undefined;
};

export async function extractMetadataFromOriginal(file: File): Promise<RawMetadata> {
  // Один сегментированный проход вместо пяти: exifr.xmp/iptc/icc не существуют
  // в exifr@7, а mergeOutput:false отдаёт те же сегменты из одного парса.
  const segments = (await exifr.parse(file, {
    ifd0: {},
    exif: true,
    gps: true,
    xmp: true,
    iptc: true,
    icc: true,
    translateKeys: true,
    mergeOutput: false
  })) as Record<string, Record<string, unknown> | undefined> | undefined;

  const exifData = { ...(segments?.ifd0 ?? {}), ...(segments?.exif ?? {}) };

  return {
    exifData,
    xmpData: segments?.xmp ?? {},
    iptcData: segments?.iptc ?? {},
    iccData: segments?.icc ?? {},
    gpsRaw: segments?.gps ?? {}
  };
}

type HeicDecodeResult = {
  file: File;
  width: number;
  height: number;
};

const HEIC_MAX_SIDE = 2200;

function createImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image-load'));
    };
    image.src = url;
  });
}

export async function decodeHeicToJpegForPreview(sourceFile: File): Promise<HeicDecodeResult> {
  const heic2anyModule = await import('heic2any');
  const heic2any = (heic2anyModule.default ?? heic2anyModule) as unknown as (options: {
    blob: Blob;
    toType?: string;
    quality?: number;
  }) => Promise<Blob | Blob[]>;

  let jpegBlob: Blob;
  try {
    const converted = await heic2any({ blob: sourceFile, toType: 'image/jpeg', quality: 0.92 });
    jpegBlob = Array.isArray(converted) ? converted[0] : converted;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'heic-convert';
    throw new Error(`heic-convert:${reason}`);
  }

  const image = await createImageFromBlob(jpegBlob);
  const maxSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, HEIC_MAX_SIDE / Math.max(1, maxSide));
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas');
  }
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error('jpeg-encode'));
        return;
      }
      resolve(result);
    }, 'image/jpeg', 0.92);
  });

  const safeName = sourceFile.name.replace(/\.(heic|heif)$/i, '') || 'photo';
  const file = new File([blob], `${safeName}.jpg`, { type: 'image/jpeg' });

  return {
    file,
    width: image.naturalWidth,
    height: image.naturalHeight
  };
}
