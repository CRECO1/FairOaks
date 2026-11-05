/**
 * Big pictures (phone photos run 4–12 MB) → a normal-sized JPEG, in the browser, before they are stored or emailed.
 * Anything that isn't a large photo, or any failure, comes back unchanged. Shared by the email composer and My Drive uploads.
 */
export async function shrinkImage(file: File, opts: { maxSide?: number; quality?: number; minBytes?: number } = {}): Promise<File> {
  const { maxSide = 2000, quality = 0.82, minBytes = 900_000 } = opts;
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size < minBytes || typeof createImageBitmap === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}
