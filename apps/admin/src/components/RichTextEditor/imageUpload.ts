// Upload seam for editor images. Today no adapter provides `upload`, so the
// image dialog is URL-insert only. When the minio-backed upload endpoint
// lands, pass an adapter with `upload` from the richtext field wiring — the
// editor internals already branch on its presence and need no changes.

export type RichTextImageUploadResult = {
  url: string;
  alt?: string;
};

export type RichTextImageUploadAdapter = {
  /** When present the image dialog offers a file picker that uploads first. */
  upload?: (file: File) => Promise<RichTextImageUploadResult>;
};

export const defaultImageUploadAdapter: RichTextImageUploadAdapter = {};

// UX mirror of the server-side sanitizer's URL allowlist — the API remains
// the security boundary (see apps/api src/lib/sanitize.ts).
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isLinkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' ||
      url.protocol === 'https:' ||
      url.protocol === 'mailto:'
    );
  } catch {
    return false;
  }
}
