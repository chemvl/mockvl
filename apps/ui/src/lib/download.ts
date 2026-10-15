/** Save text as a file via a temporary object URL. */
export function downloadText(filename: string, content: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
