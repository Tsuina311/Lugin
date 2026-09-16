/** Geometry Test artifact dimension integrity (phone + host). */

import { CARD_HEIGHT, CARD_WIDTH } from '../geometry';

export type GeometryArtifactRole = 'card-warp' | 'source' | 'metadata' | 'summary' | 'thumbnail';

export type GeometryArtifactDims = {
  role: GeometryArtifactRole;
  logicalWidth: number | null;
  logicalHeight: number | null;
  encodedWidth: number | null;
  encodedHeight: number | null;
  bytes: number;
};

export type GeometryArtifactStatus =
  | 'ARTIFACT_OK'
  | 'ARTIFACT_DOWNSCALED'
  | 'ARTIFACT_DIMENSION_MISMATCH'
  | 'ARTIFACT_MISSING';

export const GEOMETRY_CARD_ARTIFACT_WIDTH = CARD_WIDTH;
export const GEOMETRY_CARD_ARTIFACT_HEIGHT = CARD_HEIGHT;

/** Classify encoded PNG vs in-memory / expected dimensions. */
export const classifyGeometryArtifact = (args: {
  role: GeometryArtifactRole;
  logicalWidth: number | null;
  logicalHeight: number | null;
  encodedWidth: number | null;
  encodedHeight: number | null;
  bytes?: number | null;
}): GeometryArtifactStatus => {
  if (args.bytes != null && args.bytes <= 0) return 'ARTIFACT_MISSING';
  if (args.encodedWidth == null || args.encodedHeight == null) return 'ARTIFACT_MISSING';

  if (args.role === 'card-warp') {
    if (
      args.encodedWidth === GEOMETRY_CARD_ARTIFACT_WIDTH &&
      args.encodedHeight === GEOMETRY_CARD_ARTIFACT_HEIGHT
    ) {
      return 'ARTIFACT_OK';
    }
    if (args.encodedWidth <= 120 || args.encodedHeight <= 168) {
      return 'ARTIFACT_DOWNSCALED';
    }
    return 'ARTIFACT_DIMENSION_MISMATCH';
  }

  if (args.role === 'source') {
    if (args.logicalWidth == null || args.logicalHeight == null) {
      return args.encodedWidth > 0 && args.encodedHeight > 0
        ? 'ARTIFACT_OK'
        : 'ARTIFACT_MISSING';
    }
    if (
      args.encodedWidth === args.logicalWidth &&
      args.encodedHeight === args.logicalHeight
    ) {
      return 'ARTIFACT_OK';
    }
    if (args.encodedWidth < args.logicalWidth || args.encodedHeight < args.logicalHeight) {
      // Classic thumbnail trap (maxWidth=120).
      if (args.encodedWidth <= 120) return 'ARTIFACT_DOWNSCALED';
      return 'ARTIFACT_DIMENSION_MISMATCH';
    }
    return 'ARTIFACT_DIMENSION_MISMATCH';
  }

  return 'ARTIFACT_OK';
};

export const assertGeometryCardArtifactDims = (args: {
  encodedWidth: number;
  encodedHeight: number;
  bytes: number;
}): void => {
  if (args.bytes <= 0) {
    throw new Error('geometry card artifact empty');
  }
  if (
    args.encodedWidth !== GEOMETRY_CARD_ARTIFACT_WIDTH ||
    args.encodedHeight !== GEOMETRY_CARD_ARTIFACT_HEIGHT
  ) {
    throw new Error(
      `geometry card artifact must be ${GEOMETRY_CARD_ARTIFACT_WIDTH}×${GEOMETRY_CARD_ARTIFACT_HEIGHT}, ` +
        `got ${args.encodedWidth}×${args.encodedHeight}`,
    );
  }
};

export const assertGeometrySourceArtifactDims = (args: {
  logicalWidth: number;
  logicalHeight: number;
  encodedWidth: number;
  encodedHeight: number;
  bytes: number;
}): void => {
  if (args.bytes <= 0) {
    throw new Error('geometry source artifact empty');
  }
  if (
    args.encodedWidth !== args.logicalWidth ||
    args.encodedHeight !== args.logicalHeight
  ) {
    throw new Error(
      `geometry source artifact must match buffer ${args.logicalWidth}×${args.logicalHeight}, ` +
        `got ${args.encodedWidth}×${args.encodedHeight}`,
    );
  }
};
