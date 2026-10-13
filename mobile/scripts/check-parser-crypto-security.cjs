'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS postinstall check. */
/* global __filename */

// Unreleased, reviewed-local backports; package versions are deliberately unchanged.
// braces: Corvette052, https://github.com/micromatch/braces/pull/88
// a795ee83ecd011131b2d618fe754ac5a8e124dae, plus local parent-chain guards.
// forge: matthewscottconroy, https://github.com/digitalbazaar/forge/pull/1159
// db05494352dd3c9a5a07c5270333dcc78866cad2 (lib/rsa.js unchanged from that PR).
// This checks malformed-signature rejection, not an independent cryptographic audit
// or a demonstration of signature forgery without a private key.
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const mobileRoot = path.resolve(__dirname, '..');
let passed = 0;
function check(label, run) {
  try {
    run();
    passed++;
  } catch (error) {
    throw new Error(`${label}: ${error.message}`, { cause: error });
  }
}

function verifyInstallation() {
  check('reviewed patch and installed source checksums', () => {
    const checksums = [
      [
        'patches/braces+3.0.3.patch',
        'd03afbf5ff55e55d2ae7d6ae50c9b7d458c8033a03305947eecbcf7e780241d8',
      ],
      [
        'patches/node-forge+1.4.0.patch',
        'fdc0530ecdd524a46e1b2fdbe1e45c18e01efb645a310fa5a89f736dcfedcf66',
      ],
      [
        'node_modules/braces/lib/assert-depth.js',
        'b321fae68263e0a3c923ccf43c05e8d0c01689375587ce6ecec924a04f9ac747',
      ],
      [
        'node_modules/braces/lib/compile.js',
        '0527119921a3117bfbb7a3a86d400bcaf26c3988628688301ee17c5cc0003719',
      ],
      [
        'node_modules/braces/lib/expand.js',
        'bdcde9b36e94d248c5035ab8f98f4a20189c973fa44ee68cd576ba7ebf28022b',
      ],
      [
        'node_modules/braces/lib/parse.js',
        'e5785862edf7deb86ea583bafc88089fdd06dce265b61eaf2daf411a129be7b8',
      ],
      [
        'node_modules/braces/lib/stringify.js',
        '056ab10d759e5d2ca81fc888b122acf450c692b5e409dc19a41aca06aba8f2ef',
      ],
      [
        'node_modules/node-forge/lib/rsa.js',
        'c7b72e7ef41f4fc0e5228dce3e37851e9ca064c789365d5e392c25d1c5f6e710',
      ],
    ];
    for (const [file, expected] of checksums) {
      assert.equal(
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(mobileRoot, file)))
          .digest('hex'),
        expected,
        file,
      );
    }
  });
  const lock = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package-lock.json'), 'utf8'));
  for (const [name, version] of [
    ['braces', '3.0.3'],
    ['node-forge', '1.4.0'],
  ]) {
    check(`${name} exact version, patch and all lockfile instances`, () => {
      const patch = path.join(mobileRoot, 'patches', `${name}+${version}.patch`);
      assert.ok(fs.statSync(patch).size > 0, `${patch} must exist`);
      const entries = Object.entries(lock.packages).filter(
        ([entry]) => entry === `node_modules/${name}` || entry.endsWith(`/node_modules/${name}`),
      );
      assert.ok(entries.length > 0, `${name} missing from lockfile`);
      const canonical = fs.realpathSync(path.join(mobileRoot, 'node_modules', name));
      for (const [entry, metadata] of entries) {
        assert.equal(
          metadata.version,
          version,
          `${entry}: re-review patch after any version change`,
        );
        const installed = path.join(mobileRoot, entry);
        assert.equal(
          JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version,
          version,
        );
        assert.equal(
          fs.realpathSync(installed),
          canonical,
          `${entry}: nested copy is not covered by the root patch; add and test its patch explicitly`,
        );
      }
    });
  }
}

function checkBraces() {
  const braces = require('braces');
  const reject = (run) =>
    assert.throws(
      run,
      (error) => error instanceof SyntaxError && /safe depth|acyclic/.test(error.message),
    );
  const nested = (left, right, depth) => left.repeat(depth) + 'x' + right.repeat(depth);
  for (const operation of ['parse', 'compile', 'expand', 'stringify']) {
    for (const [left, right] of [
      ['{', '}'],
      ['(', ')'],
    ]) {
      check(`${operation} rejects nested ${left} within the old length limit`, () => {
        reject(() => braces[operation](nested(left, right, 4000)));
        reject(() => braces[operation](left.repeat(4000) + 'x'));
        reject(() =>
          braces[operation](nested(left, right, 4000), { maxLength: Infinity, maxDepth: Infinity }),
        );
      });
    }
  }
  for (const operation of ['compile', 'expand', 'stringify']) {
    check(`${operation} rejects supplied deep/cyclic nodes and parent chains`, () => {
      let deep = { type: 'text', value: 'x' };
      for (let i = 0; i < 12000; i++) deep = { type: 'root', nodes: [deep] };
      reject(() => braces[operation](deep));
      const cyclic = { type: 'root', nodes: [] };
      cyclic.nodes.push(cyclic);
      reject(() => braces[operation](cyclic));
      for (const length of [1, 2, 200]) {
        const paren = { type: 'paren', nodes: [{ type: 'text', value: 'x' }] };
        let end = paren;
        for (let i = 1; i < length; i++) end = end.parent = { type: 'paren' };
        end.parent = length < 200 ? paren : { type: 'root' };
        reject(() => braces[operation]({ type: 'root', nodes: [paren] }));
      }
    });
    check(`${operation} accepts bounded ordinary nesting and rejects depth 129`, () => {
      assert.doesNotThrow(() => braces[operation](nested('{', '}', 64)));
      assert.doesNotThrow(() => braces[operation](nested('{', '}', 127)));
      // PR 88 bounds AST-node depth at 128: the innermost leaf is one deeper
      // than its group, so 128 groups parse but cannot enter recursive walkers.
      reject(() => braces[operation](nested('{', '}', 128)));
      reject(() => braces[operation](nested('{', '}', 129)));
    });
  }
  check('parser hard boundary and escaped/quoted syntax', () => {
    assert.doesNotThrow(() => braces.parse(nested('{', '}', 128)));
    reject(() => braces.parse(nested('{', '}', 129)));
    assert.deepEqual(braces.expand('a/{1..3}/{x,y}'), [
      'a/1/x',
      'a/1/y',
      'a/2/x',
      'a/2/y',
      'a/3/x',
      'a/3/y',
    ]);
    assert.equal(braces.compile('src/{app,lib}/file.{js,ts}'), 'src/(app|lib)/file.(js|ts)');
    assert.deepEqual(braces.expand('file{03..01}'), ['file03', 'file02', 'file01']);
    assert.deepEqual(braces.expand('\\{a,b\\}'), ['{a,b}']);
    assert.deepEqual(braces.expand('"{a,b}"'), ['{a,b}']);
    assert.deepEqual(braces.expand('[{a,b}]'), ['[{a,b}]']);
    assert.deepEqual(braces.expand('{a,b'), ['{a,b']);
    assert.throws(() => braces.expand('{1..1001}'), /range limit/);
    assert.throws(() => braces.parse('x'.repeat(10001)), /max characters/);
  });
  check('shared acyclic leaves and normal parent back-references remain valid', () => {
    const leaf = { type: 'text', value: 'x' };
    assert.equal(braces.stringify({ type: 'root', nodes: [leaf, leaf] }), 'xx');
    for (const operation of ['compile', 'expand', 'stringify']) {
      assert.doesNotThrow(() => braces[operation](braces.parse('a/(b/{c,d})')));
    }
  });
}

function checkForge() {
  const forge = require('node-forge');
  const message = Buffer.from('AOS local security regression; no production key or network');
  const tlv = (tag, bytes, long = false) => {
    assert.ok(bytes.length < 128, 'test TLV only uses short values');
    return Buffer.concat([
      Buffer.from(long ? [tag, 0x81, bytes.length] : [tag, bytes.length]),
      bytes,
    ]);
  };
  const digestInfo = (algorithm, digest, shape = 'valid') => {
    const oid = Buffer.from(forge.asn1.oidToDer(forge.oids[algorithm]).getBytes(), 'binary');
    let params = tlv(
      5,
      shape === 'nullPayload' ? Buffer.from('garbage') : Buffer.alloc(0),
      shape === 'longNull',
    );
    if (shape === 'omitNull') params = Buffer.alloc(0);
    if (shape === 'nonNull') params = tlv(2, Buffer.from('garbage'));
    const inner = Buffer.concat([
      tlv(6, oid, shape === 'longOid'),
      params,
      shape === 'extraInner' ? tlv(2, Buffer.from('garbage')) : Buffer.alloc(0),
    ]);
    const content = Buffer.concat([
      tlv(0x30, inner, shape === 'longInner'),
      tlv(4, digest, shape === 'longDigest'),
      shape === 'extraOuter' ? tlv(2, Buffer.from('garbage')) : Buffer.alloc(0),
    ]);
    if (shape === 'indefinite')
      return Buffer.concat([Buffer.from([0x30, 0x80]), content, Buffer.from([0, 0])]);
    const encoded = tlv(0x30, content, shape === 'longOuter');
    return shape === 'trailing' ? Buffer.concat([encoded, Buffer.from('garbage')]) : encoded;
  };
  const rejected = (run) => {
    let result;
    try {
      result = run();
    } catch (error) {
      assert.ok(error instanceof Error);
      return;
    }
    assert.equal(result, false, 'malformed signature must throw or return false');
  };

  for (const exponent of [3, 65537]) {
    const keys = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicExponent: exponent,
    });
    const publicKey = forge.pki.publicKeyFromPem(
      keys.publicKey.export({ type: 'spki', format: 'pem' }),
    );
    const privateKey = forge.pki.privateKeyFromPem(
      keys.privateKey.export({ type: 'pkcs1', format: 'pem' }),
    );
    const rawSign = (bytes) =>
      crypto.privateEncrypt(
        { key: keys.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
        bytes,
      );
    const verify = (digest, signature) =>
      publicKey.verify(digest.toString('binary'), signature.toString('binary'));
    for (const algorithm of [
      'md2',
      'md5',
      'sha1',
      'sha224',
      'sha256',
      'sha384',
      'sha512',
      'sha512-224',
      'sha512-256',
    ]) {
      // Node has no MD2: test its existing OID/NULL contract with a synthetic
      // 16-byte digest, not a claim that MD2 is a secure or supported Node hash.
      const digest =
        algorithm === 'md2'
          ? Buffer.alloc(16, 0x5a)
          : crypto.createHash(algorithm).update(message).digest();
      check(`forge e=${exponent} ${algorithm} canonical and optional-NULL compatibility`, () => {
        const valid = rawSign(digestInfo(algorithm, digest));
        assert.equal(verify(digest, valid), true);
        const withoutNull = rawSign(digestInfo(algorithm, digest, 'omitNull'));
        if (algorithm === 'md2' || algorithm === 'md5') rejected(() => verify(digest, withoutNull));
        else assert.equal(verify(digest, withoutNull), true);
        assert.equal(verify(Buffer.alloc(digest.length, 0), valid), false);
        if (algorithm !== 'md2') {
          assert.equal(crypto.verify(algorithm, message, keys.publicKey, valid), true);
          assert.equal(verify(digest, crypto.sign(algorithm, message, keys.privateKey)), true);
        }
      });
      for (const shape of [
        'extraInner',
        'nonNull',
        'nullPayload',
        'longOuter',
        'longInner',
        'longOid',
        'longNull',
        'longDigest',
        'extraOuter',
        'trailing',
        'indefinite',
      ]) {
        check(`forge e=${exponent} ${algorithm} rejects ${shape}`, () => {
          const bad = rawSign(digestInfo(algorithm, digest, shape));
          rejected(() => verify(digest, bad));
          if (algorithm !== 'md2')
            assert.equal(crypto.verify(algorithm, message, keys.publicKey, bad), false);
        });
      }
    }
    check(`forge e=${exponent} unchanged PSS/NONE and tampered signature`, () => {
      const digest = crypto.createHash('sha256').update(message).digest();
      const pss = forge.pss.create({
        md: forge.md.sha256.create(),
        mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
        saltLength: 32,
      });
      const signature = crypto.sign('sha256', message, {
        key: keys.privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      });
      assert.equal(
        publicKey.verify(digest.toString('binary'), signature.toString('binary'), pss),
        true,
      );
      assert.equal(
        publicKey.verify(
          digest.toString('binary'),
          privateKey.sign(digest.toString('binary'), 'NONE'),
          'NONE',
        ),
        true,
      );
      const tampered = rawSign(digestInfo('sha256', digest));
      tampered[10] ^= 1;
      rejected(() => verify(digest, tampered));
    });
    check(`Expo e=${exponent} local certificate/manifest/CSR workflow`, () => {
      const signing = require('@expo/code-signing-certificates');
      const keyPair = { publicKey, privateKey };
      const now = Date.now();
      const cert = signing.generateSelfSignedCodeSigningCertificate({
        keyPair,
        validityNotBefore: new Date(now - 86400000),
        validityNotAfter: new Date(now + 86400000),
        commonName: 'AOS regression only',
      });
      const parsed = signing.convertCertificatePEMToCertificate(
        signing.convertCertificateToCertificatePEM(cert),
      );
      signing.validateSelfSignedCertificate(parsed, keyPair);
      const signed = signing.signBufferRSASHA256AndVerify(privateKey, parsed, message);
      assert.equal(
        crypto.verify('sha256', message, keys.publicKey, Buffer.from(signed, 'base64')),
        true,
      );
      const csr = signing.convertCSRPEMToCSR(
        signing.convertCSRToCSRPEM(signing.generateCSR(keyPair, 'AOS regression only')),
      );
      assert.equal(csr.verify(), true);
      const development = signing.generateDevelopmentCertificateFromCSR(
        privateKey,
        parsed,
        csr,
        '00000000-0000-4000-8000-000000000000',
        '@local/regression',
      );
      assert.equal(
        publicKey.verify(
          forge.md.sha256
            .create()
            .update(forge.asn1.toDer(development.tbsCertificate).getBytes())
            .digest()
            .getBytes(),
          development.signature,
        ),
        true,
      );
    });
  }
}

if (process.argv[2] === '--braces-worker') {
  checkBraces();
  process.stdout.write(`braces security: ${passed} grouped checks passed (512 KiB stack)\n`);
} else if (process.argv[2] === '--forge-worker') {
  checkForge();
  process.stdout.write(
    `node-forge security: ${passed} grouped checks passed (e=3/e=65537, disposable keys)\n`,
  );
} else {
  verifyInstallation();
  const failures = [];
  for (const worker of ['braces', 'forge']) {
    const result = spawnSync(
      process.execPath,
      [
        ...(worker === 'braces' ? ['--stack_size=512'] : []),
        '--max-old-space-size=128',
        __filename,
        `--${worker}-worker`,
      ],
      { cwd: mobileRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    process.stdout.write(result.stdout || '');
    if (result.status !== 0 || result.error)
      failures.push(`${worker}: ${result.error || result.stderr || result.signal}`);
  }
  assert.equal(failures.length, 0, failures.join('\n'));
  process.stdout.write(
    `parser/crypto installation: ${passed} checksum/exact-version/patch/instance checks passed\n`,
  );
}
