/**
 * Escarpment helpers: gap-fill for cliff faces.
 */

/** Minimum cliff-run length that earns stairs through the face. */
export const WIDE_CLIFF = 28;

/**
 * Fill gaps of at most `maxGap` unmarked tiles between marks on the same row.
 * Turns a dashed escarpment into a continuous face without inventing cliffs
 * across whole panels of flat ground.
 */
export function fillCliffGaps(marks: Uint8Array, w: number, h: number, maxGap: number): void {
  for (let y = 2; y < h - 3; y++) {
    let x = 2;
    while (x < w - 2) {
      if (!marks[y * w + x]) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < w - 2 && marks[y * w + end]) end++;
      let gap = 0;
      while (end + gap < w - 2 && !marks[y * w + end + gap]) gap++;
      if (gap > 0 && gap <= maxGap && end + gap < w - 2 && marks[y * w + end + gap]) {
        for (let k = 0; k < gap; k++) marks[y * w + end + k] = 1;
        x = end + gap;
      } else {
        x = end;
      }
    }
  }
}
