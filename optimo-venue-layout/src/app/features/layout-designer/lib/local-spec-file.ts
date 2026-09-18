/** Read seating spec from .txt / .svg blueprint files without calling Azure. */

export function isLocalSpecFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.txt') ||
    name.endsWith('.svg') ||
    file.type === 'text/plain' ||
    file.type === 'image/svg+xml'
  );
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsText(file);
  });
}

/** Pull visible labels from an SVG seating-chart sheet. */
export function textFromSvgMarkup(svg: string): string {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const lines: string[] = [];
    doc.querySelectorAll('text').forEach((node) => {
      const value = node.textContent?.replace(/\s+/g, ' ').trim();
      if (value) {
        lines.push(value);
      }
    });
    if (lines.length > 0) {
      return lines.join('\n');
    }
  }
  return svg
    .replace(/<[^>]+>/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}
