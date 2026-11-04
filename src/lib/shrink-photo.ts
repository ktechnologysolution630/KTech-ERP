const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.8;

/**
 * Scales a camera photo down to JPEG in the browser: a phone photo is often larger than a server
 * action accepts, and slow to send from a site. A photo the browser cannot decode is returned as it is.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
