/**
 * Put a named quad into one decoded image's pixel space.
 *
 * Fixture `imageWidth` / `imageHeight` are the PNG. Session metadata
 * `photo.decodedWidth` / `photo.decodedHeight` are the phone capture, when
 * an outline was stored in that larger space. Scale is image/capture on
 * each axis, and the two factors must match. There is no default scale.
 */

const KEYS = ['tl', 'tr', 'br', 'bl'];

export const quadCorners = quad => KEYS.map(key => quad[key]);

export const quadFitsImage = (quad, width, height, slack = 0) =>
  quadCorners(quad).every(([x, y]) => x >= -slack && y >= -slack && x <= width + slack && y <= height + slack);

const scaleOf = (image, capture) => {
  if (!Number.isFinite(image) || !Number.isFinite(capture) || image <= 0 || capture <= 0) {
    throw new Error(`missing image or capture dimension (${image} vs ${capture})`);
  }
  return image / capture;
};

/**
 * @param {object} args
 * @param {object} args.quad tl/tr/br/bl in either PNG pixels or capture pixels
 * @param {number} args.imageWidth decoded PNG width; must match the fixture record
 * @param {number} args.imageHeight decoded PNG height
 * @param {number} [args.captureWidth] metadata photo.decodedWidth
 * @param {number} [args.captureHeight] metadata photo.decodedHeight
 * @param {string} [args.label]
 */
export const quadInImageSpace = ({ quad, imageWidth, imageHeight, captureWidth = null, captureHeight = null, label = 'quad' }) => {
  if (!quadFitsImage(quad, imageWidth, imageHeight, 1)) {
    const sx = scaleOf(imageWidth, captureWidth);
    const sy = scaleOf(imageHeight, captureHeight);
    if (Math.abs(sx - sy) > 1e-6) {
      throw new Error(`${label} capture scale is not uniform (${sx} vs ${sy})`);
    }
    const scaled = {};
    for (const key of KEYS) scaled[key] = [quad[key][0] * sx, quad[key][1] * sy];
    if (!quadFitsImage(scaled, imageWidth, imageHeight, 1)) {
      throw new Error(`${label} is outside ${imageWidth}x${imageHeight} after capture scale ${sx}`);
    }
    return { quad: scaled, scale: sx, space: 'capture' };
  }
  return { quad, scale: 1, space: 'image' };
};

/** Throw if a quad is not in this decoded image's pixel space. */
export const assertImageSpace = (quad, width, height, label) => {
  for (const key of KEYS) {
    const point = quad?.[key];
    if (!Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite)) {
      throw new Error(`${label} ${key} is not a finite point`);
    }
    const [x, y] = point;
    if (x < -width * 0.05 || y < -height * 0.05 || x > width * 1.05 || y > height * 1.05) {
      throw new Error(`${label} ${key} (${x.toFixed(1)}, ${y.toFixed(1)}) is outside ${width}x${height}`);
    }
  }
};
