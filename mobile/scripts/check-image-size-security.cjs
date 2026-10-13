/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS install check. */
// Run after npm ci: node scripts/check-image-size-security.cjs
// GHSA-5p2g-fcmc-qvqq / GHSA-w3rx-r6r6-pgpr and Metro's removed sync-file API.
// Malformed inputs run in isolated processes so a parser regression cannot hang CI.
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const mobileRoot = path.resolve(__dirname, '..');
const metroPath = require.resolve('metro/private/Assets');
const metro = require(metroPath);
// Resolve from the actual caller, including a future nested dependency layout.
const metroRequire = createRequire(metroPath);
const imageSizePath = metroRequire.resolve('image-size');
const { imageSize } = metroRequire('image-size');

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

async function checkAsset(file) {
  const data = await metro.getAssetData(
    file,
    path.relative(mobileRoot, file),
    [],
    'android',
    '/assets',
  );
  const firstContent = fs.readFileSync(data.files[0]);
  const expected = imageSize(firstContent);
  assert.equal(data.width, expected.width / data.scales[0], file);
  assert.equal(data.height, expected.height / data.scales[0], file);
  assert.equal(data.__packager_asset, true, file);
  assert.ok(data.files.includes(file), `Requested asset must be retained: ${file}`);
  assert.equal(data.files.length, data.scales.length, file);
  const hash = createHash('md5');
  data.files.forEach((asset) => hash.update(fs.readFileSync(asset)));
  assert.equal(data.hash, hash.digest('hex'), file);
  assert.deepEqual(metro.getAssetSize(data.type, firstContent, file), {
    width: expected.width,
    height: expected.height,
  });
  return data;
}

test('Metro resolves the fixed image-size 2.0.4 buffer API', () => {
  // 2.0.4's published CJS entry is dist/cjs/index.js.
  const packagePath = path.resolve(path.dirname(imageSizePath), '../../package.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(manifest.name, 'image-size');
  assert.equal(manifest.version, '2.0.4');
  assert.equal(typeof imageSize, 'function');
  assert.equal(metroRequire('image-size').default, imageSize);
});

test('Metro 0.84.4 patch is present and applied with reviewed checksums', () => {
  assert.equal(require('metro/package.json').version, '0.84.4');
  const checksums = [
    [
      path.join(mobileRoot, 'patches/metro+0.84.4.patch'),
      '1a25bcc54a0647814a2a85599251e6360cc1a1a151233ef0ca3375cff0baf324',
    ],
    [metroPath, 'b1f808868a9b86cb78b176f3cb290afd88529aef8133369c2352126acb43349d'],
  ];
  for (const [file, expected] of checksums) {
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected, file);
  }
});

test('Metro reads every current application image through both asset APIs', async () => {
  const files = filesIn(path.join(mobileRoot, 'assets')).filter((file) =>
    metro.isAssetTypeAnImage(path.extname(file).slice(1)),
  );
  assert.ok(files.length > 0, 'The application image fixture set must not be empty');
  for (const file of files) await checkAsset(file);
  process.stdout.write(
    `Verified ${files.length} application images: dimensions, scales, files, hash\n`,
  );
});

test('Metro reads a scaled PNG inside a .zip/ named directory', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-image-size-'));
  try {
    const zipDirectory = path.join(directory, 'fixture.zip');
    fs.mkdirSync(zipDirectory);
    const file = path.join(zipDirectory, 'fixture@2x.png');
    fs.copyFileSync(path.join(mobileRoot, 'assets/icon.png'), file);
    const data = await checkAsset(file);
    assert.deepEqual(data.scales, [2]);
    assert.deepEqual(data.files, [file]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Metro keeps non-image TTF assets out of the image parser', async () => {
  const file =
    require.resolve('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf');
  const data = await metro.getAssetData(file, 'Feather.ttf', [], 'android', '/assets');
  assert.equal(data.type, 'ttf');
  assert.equal(data.width, undefined);
  assert.equal(data.height, undefined);
  assert.deepEqual(data.files, [file]);
  assert.deepEqual(data.scales, [1]);
  assert.equal(data.hash, createHash('md5').update(fs.readFileSync(file)).digest('hex'));
  assert.equal(metro.getAssetSize('ttf', fs.readFileSync(file), file), null);
});

test('Metro continues to reject empty image assets', () => {
  assert.throws(
    () => metro.getAssetSize('png', Buffer.alloc(0), 'empty.png'),
    /cannot be an empty file/,
  );
});

// ICNS entryLength=0 used to leave imageOffset unchanged.
const icns = Buffer.alloc(16);
icns.write('icns', 0);
icns.writeUInt32BE(16, 4);
icns.write('icp4', 8);

// JXL partial-codestream boxSize=0 used to revisit the same jxlp box.
const jxl = Buffer.alloc(32);
jxl.writeUInt32BE(12, 0);
jxl.write('JXL ', 4);
jxl.set([13, 10, 135, 10], 8);
jxl.writeUInt32BE(12, 12);
jxl.write('ftyp', 16);
jxl.write('jxl ', 20);
jxl.write('jxlp', 28);

// HEIF's ispe loop in 2.0.2 accepted boxSize=0 and never advanced.
const heif = Buffer.alloc(60);
heif.writeUInt32BE(12, 0);
heif.write('ftyp', 4);
heif.write('heic', 8);
heif.writeUInt32BE(48, 12);
heif.write('meta', 16);
heif.writeUInt32BE(36, 24);
heif.write('iprp', 28);
heif.writeUInt32BE(28, 32);
heif.write('ipco', 36);
heif.write('ispe', 44);
heif.writeUInt32BE(1, 52);
heif.writeUInt32BE(1, 56);

for (const [format, content] of Object.entries({ ICNS: icns, JXL: jxl, HEIF: heif })) {
  test(`${format} zero-length structure is rejected without hanging`, () => {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `const assert = require('node:assert/strict');
         const { imageSize } = require(process.argv[1]);
         assert.throws(() => imageSize(Buffer.from(process.argv[2], 'base64')), {
           name: 'TypeError', message: new RegExp('Invalid ' + process.argv[3]),
         });`,
        imageSizePath,
        content.toString('base64'),
        format,
      ],
      { encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 8192 },
    );
    assert.ifError(child.error);
    assert.equal(child.signal, null, `${format}: ${child.stderr}`);
    assert.equal(child.status, 0, `${format}: ${child.stderr}`);
  });
}
