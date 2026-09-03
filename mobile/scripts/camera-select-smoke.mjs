#!/usr/bin/env node
/**
 * Pin the rear-camera choice to the real Samsung measurement.
 *
 * Observed on the test device:
 *   - "Back Triple Camera": virtual, wide+ultra-wide+telephoto,
 *     supportsFocusMetering true, image materially better than Chrome.
 *   - "Back Camera": physical ultra-wide-angle, supportsFocusMetering false,
 *     visibly softer.
 *
 * The first heuristic preferred a *physical* wide-angle and would rank an
 * ultra-wide-only device above a virtual multi-camera. These cases exist so
 * that regression cannot come back silently — and so the rule stays
 * capability-based rather than matching model or lens names.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');
const entry = join(mobileRoot, 'src/camera/selectMainRearDevice.ts');

const esbuild = await createRequire(join(repoRoot, 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-camera-'));
const outfile = join(bundleDir, 'selectMainRearDevice.mjs');

try {
  await esbuild.build({
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    outfile,
    platform: 'neutral',
    tsconfigRaw: { compilerOptions: { baseUrl: mobileRoot } },
  });

  const { describeDevice, selectMainRearDevice } = await import(pathToFileURL(outfile).href);

  const device = (over) => ({
    id: 'x',
    localizedName: 'Camera',
    maxZoom: 8,
    minZoom: 1,
    modelID: 'm',
    physicalDevices: [],
    position: 'back',
    supportsFocusMetering: false,
    type: 'wide-angle',
    isVirtualDevice: false,
    ...over,
  });

  // The two devices actually present on the test Samsung.
  const backTriple = device({
    id: 'triple',
    isVirtualDevice: true,
    localizedName: 'Back Triple Camera',
    physicalDevices: [{ type: 'wide-angle' }, { type: 'ultra-wide-angle' }, { type: 'telephoto' }],
    supportsFocusMetering: true,
    type: 'triple',
  });
  const backUltraWide = device({
    id: 'ultra',
    localizedName: 'Back Camera',
    supportsFocusMetering: false,
    type: 'ultra-wide-angle',
  });

  // 1. The measured case, in both list orders so ordering cannot rescue it.
  {
    check(
      'Samsung: triple beats ultra-wide',
      selectMainRearDevice([backUltraWide, backTriple])?.id === 'triple',
    );
    check(
      'Samsung: order-independent',
      selectMainRearDevice([backTriple, backUltraWide])?.id === 'triple',
    );
  }

  // 2. Focus metering outranks lens type: a lens the focus gate cannot drive
  //    is useless for close-up cards however sharp it might be.
  {
    const wideNoFocus = device({ id: 'wide-nofocus', supportsFocusMetering: false });
    const teleFocus = device({ id: 'tele-focus', supportsFocusMetering: true, type: 'telephoto' });
    check(
      'focus metering preferred over lens type',
      selectMainRearDevice([wideNoFocus, teleFocus])?.id === 'tele-focus',
    );
  }

  // 3. With focus metering equal, a real wide-angle wins.
  {
    const wide = device({ id: 'wide', supportsFocusMetering: true });
    const tele = device({ id: 'tele', supportsFocusMetering: true, type: 'telephoto' });
    check('wide-angle preferred at equal focus', selectMainRearDevice([tele, wide])?.id === 'wide');
  }

  // 4. Ultra-wide-only is always last, even when it is the only one that
  //    reports focus metering.
  {
    const ultraFocus = device({
      id: 'ultra-focus',
      supportsFocusMetering: true,
      type: 'ultra-wide-angle',
    });
    const plainWide = device({ id: 'plain-wide', supportsFocusMetering: false });
    check(
      'ultra-wide-only ranks last',
      selectMainRearDevice([ultraFocus, plainWide])?.id === 'plain-wide',
    );
  }

  // 5. Front cameras are never chosen, and an empty list is not a crash.
  {
    check(
      'front cameras ignored',
      selectMainRearDevice([device({ id: 'front', position: 'front' })]) === undefined,
    );
    check('empty list yields undefined', selectMainRearDevice([]) === undefined);
  }

  // 6. Selection must not depend on names — renaming everything changes nothing.
  {
    const renamed = [
      { ...backUltraWide, localizedName: 'Lens A' },
      { ...backTriple, localizedName: 'Lens B' },
    ];
    check('name-independent', selectMainRearDevice(renamed)?.id === 'triple');
  }

  // 7. The debug line must surface focus metering, since that is the signal
  //    that turned out to matter on device.
  {
    const text = describeDevice(backTriple);
    check('describeDevice reports focus support', text.includes('focus'), text);
    check(
      'describeDevice reports no-focus',
      describeDevice(backUltraWide).includes('no-focus'),
      describeDevice(backUltraWide),
    );
  }

  if (failures > 0) {
    console.error(`camera-select smoke: ${failures} check(s) failed`);
    process.exit(1);
  }

  console.log('camera-select smoke ok');
  console.log('  Samsung triple > ultra-wide, focus metering ranked first, name-independent');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
