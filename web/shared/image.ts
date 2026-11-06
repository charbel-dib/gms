/** Shrinks a photo in the browser before upload (phones take 4–12 MB photos): max side, JPEG, under the server limit. */
export async function shrinkImage(file: File, maxSide = 900): Promise<string> {
  if (!/^image\/(png|jpeg|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error("Choose a photo (JPG, PNG or WebP)");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("This image can't be read. Try a JPG or PNG."));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // transparent PNGs get a white background in JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.75, 0.6, 0.45]) {
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length * 0.75 < 560_000) return data;
    }
    throw new Error("This image is too large even after resizing");
  } finally {
    URL.revokeObjectURL(url);
  }
}
