/**
 * Internal toggle: Normal Scan acquisition pipeline.
 * Not exposed to end users — A/B / emergency rollback only.
 *
 * - legacy: SessionController stability + per-card focus + hi-res eligibility
 * - geometry-v2: Geometry-style CAPTURE_SAFE + short confirm + one snapshot
 */

export type SingleCapturePipeline = 'legacy' | 'geometry-v2';

/** Default to geometry-v2 (successful Geometry acquisition architecture). */
let active: SingleCapturePipeline = 'geometry-v2';

export const getSingleCapturePipeline = (): SingleCapturePipeline => active;

export const setSingleCapturePipeline = (next: SingleCapturePipeline): void => {
  active = next === 'legacy' ? 'legacy' : 'geometry-v2';
};

export const isGeometryV2Pipeline = (): boolean => active === 'geometry-v2';

/**
 * Host/unit suites that assert the pre-migration focus/stability path must
 * opt into legacy. Mobile builds keep the geometry-v2 default.
 */
export const useLegacyCapturePipelineForTests = (): void => {
  active = 'legacy';
};