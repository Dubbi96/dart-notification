#!/usr/bin/env node
/**
 * W17 보안 게이트 — npm audit 결과를 allowlist(.audit-allowlist.json)와 비교한다.
 *
 * 목적: 수정 불가능한 전이 의존성(Expo/RN·NestJS 메이저 대기 등) 때문에 전 PR이
 * 상시 레드가 되는 것을 막으면서도, "새로 유입되는" high/critical 취약점은
 * 하드 게이트로 차단한다.
 *
 * 동작:
 *   1. 대상 워크스페이스(backend|mobile|operator-web)에서 `npm audit --omit=dev --json` 실행
 *   2. 보고서의 advisory(via 객체) 중 severity가 high/critical인 것만 수집(중복 제거)
 *   3. .audit-allowlist.json 의 항목(advisory ID 배열 + 사유)과 대조
 *   4. allowlist 밖의 high/critical advisory가 1건이라도 있으면 exit 1 (CI 실패)
 *
 * 사용:
 *   node scripts/audit-gate.mjs backend
 *   node scripts/audit-gate.mjs mobile
 *   node scripts/audit-gate.mjs operator-web
 *   node scripts/audit-gate.mjs backend --json-file <저장된 audit JSON 경로>
 *   node scripts/audit-gate.mjs --self-test
 *
 * exit code: 0=통과 · 1=미허용 high/critical 존재 · 2=실행/파싱 오류
 *
 * 주의: npm audit fix / --force 는 절대 실행하지 않는다(Expo peer-deps 파손 위험).
 * 이 스크립트는 조회·판정만 한다. 취약점 해소는 별도 의존성 업그레이드 PR로 처리하고,
 * 해소되면 해당 allowlist 항목을 제거한다(스크립트가 stale 항목을 경고로 알려준다).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = join(REPO_ROOT, '.audit-allowlist.json');
const GATED_SEVERITIES = new Set(['high', 'critical']);
const WORKSPACES = new Set(['backend', 'mobile', 'operator-web']);

/** advisory url(https://github.com/advisories/GHSA-....)에서 GHSA ID를 추출한다. */
export function ghsaFromUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * npm audit(v2 report)에서 게이트 대상(high/critical) advisory를 중복 없이 수집한다.
 * via 가 문자열(다른 패키지로의 체인)인 항목은 루트 advisory 가 이미 별도 항목으로
 * 잡히므로 건너뛴다.
 */
export function extractGatedAdvisories(report) {
  const bySource = new Map();
  for (const vuln of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vuln?.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const severity = String(via.severity ?? '').toLowerCase();
      if (!GATED_SEVERITIES.has(severity)) continue;
      if (bySource.has(via.source)) continue;
      bySource.set(via.source, {
        id: via.source,
        ghsa: ghsaFromUrl(via.url),
        package: via.dependency ?? via.name ?? '(unknown)',
        severity,
        title: via.title ?? '',
        url: via.url ?? '',
      });
    }
  }
  return [...bySource.values()];
}

/** allowlist 항목이 이 워크스페이스·advisory 에 적용되는지 판정한다. */
function entryMatches(entry, advisory, workspace) {
  if (Array.isArray(entry.workspaces) && !entry.workspaces.includes(workspace)) {
    return false;
  }
  const ids = Array.isArray(entry.advisoryIds) ? entry.advisoryIds : [];
  const ghsas = (Array.isArray(entry.ghsa) ? entry.ghsa : []).map((g) => String(g).toUpperCase());
  return ids.includes(advisory.id) || (advisory.ghsa !== null && ghsas.includes(advisory.ghsa));
}

/**
 * 게이트 판정. advisory 배열을 allowlist 와 대조해
 * { blocked, allowed, staleEntries } 를 돌려준다.
 */
export function evaluate(advisories, allowlistEntries, workspace) {
  const blocked = [];
  const allowed = [];
  const usedEntries = new Set();

  for (const advisory of advisories) {
    const entry = allowlistEntries.find((e) => entryMatches(e, advisory, workspace));
    if (entry) {
      usedEntries.add(entry);
      allowed.push({ advisory, entry });
    } else {
      blocked.push(advisory);
    }
  }

  // 이 워크스페이스에 적용 가능한데 아무 advisory 와도 매칭되지 않은 항목 → 해소된 취약점(제거 대상)
  const staleEntries = allowlistEntries.filter(
    (e) =>
      !usedEntries.has(e) &&
      (!Array.isArray(e.workspaces) || e.workspaces.includes(workspace)),
  );

  return { blocked, allowed, staleEntries };
}

function loadAllowlist() {
  let raw;
  try {
    raw = readFileSync(ALLOWLIST_PATH, 'utf8');
  } catch {
    // allowlist 파일이 없으면 빈 목록으로 동작(전 high/critical 차단)
    return [];
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.allowlist)) {
    throw new Error(`.audit-allowlist.json 형식 오류: 최상위 "allowlist" 배열이 필요합니다.`);
  }
  return parsed.allowlist;
}

function runNpmAudit(workspace) {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--audit-level=high', '--json'], {
    cwd: join(REPO_ROOT, workspace),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`npm audit 실행 실패: ${result.error.message}`);
  }
  // npm audit 은 취약점이 있으면 non-zero 로 끝난다 — exit code 는 무시하고 JSON 을 판정 기준으로 쓴다.
  return result.stdout;
}

function parseReport(jsonText) {
  let report;
  try {
    report = JSON.parse(jsonText);
  } catch {
    throw new Error(`npm audit 출력 JSON 파싱 실패:\n${String(jsonText).slice(0, 500)}`);
  }
  if (report.error) {
    throw new Error(`npm audit 오류: ${JSON.stringify(report.error).slice(0, 500)}`);
  }
  return report;
}

function formatAdvisory(a) {
  return `  - [${a.severity.toUpperCase()}] ${a.package} · advisory ${a.id} (${a.ghsa ?? 'GHSA 미상'})\n    ${a.title}\n    ${a.url}`;
}

function runGate(workspace, jsonFile) {
  const jsonText = jsonFile ? readFileSync(jsonFile, 'utf8') : runNpmAudit(workspace);
  const report = parseReport(jsonText);
  const advisories = extractGatedAdvisories(report);
  const allowlist = loadAllowlist();
  const { blocked, allowed, staleEntries } = evaluate(advisories, allowlist, workspace);

  const meta = report.metadata?.vulnerabilities;
  console.log(`[audit-gate] 워크스페이스: ${workspace}`);
  if (meta) {
    console.log(
      `[audit-gate] npm audit(--omit=dev) 요약: critical=${meta.critical} high=${meta.high} moderate=${meta.moderate} low=${meta.low}`,
    );
  }
  console.log(
    `[audit-gate] 게이트 대상(high/critical) advisory ${advisories.length}건 — 허용 ${allowed.length} · 차단 ${blocked.length}`,
  );

  if (allowed.length > 0) {
    console.log(`\n[audit-gate] allowlist 로 수용된 advisory (${allowed.length}건):`);
    for (const { advisory, entry } of allowed) {
      console.log(`  - [${advisory.severity.toUpperCase()}] ${advisory.package} · advisory ${advisory.id} — 사유: ${entry.reason}`);
    }
  }

  if (staleEntries.length > 0) {
    console.log(
      `\n[audit-gate] (경고) 매칭되지 않은 allowlist 항목 ${staleEntries.length}건 — 취약점이 해소됐다면 .audit-allowlist.json 에서 제거하세요:`,
    );
    for (const e of staleEntries) {
      console.log(`  - ${e.package ?? '(패키지 미상)'}: advisoryIds=${JSON.stringify(e.advisoryIds ?? [])}`);
    }
  }

  if (blocked.length > 0) {
    console.error(`\n[audit-gate] 실패 — allowlist 에 없는 high/critical advisory ${blocked.length}건:`);
    for (const a of blocked) {
      console.error(formatAdvisory(a));
    }
    console.error(
      `\n[audit-gate] 조치: (권장) 의존성 업그레이드로 해소하거나, 수정 불가 전이 의존성이면 ` +
        `.audit-allowlist.json 에 advisory ID + 사유를 추가하고 docs/security/ 트리아지 문서에 기록하세요. ` +
        `npm audit fix --force 는 금지(Expo peer-deps 파손 위험).`,
    );
    process.exit(1);
  }

  console.log(`\n[audit-gate] 통과 — 미허용 high/critical 0건.`);
}

/* ------------------------------------------------------------------ */
/* self-test: 외부 네트워크 없이 판정 로직을 검증한다.                    */
/* ------------------------------------------------------------------ */
function selfTest() {
  // 합성 npm audit 보고서: high 2건(그중 1건은 두 패키지에 중복 등장), critical 1건, moderate 1건
  const report = {
    vulnerabilities: {
      alpha: {
        name: 'alpha',
        severity: 'high',
        via: [
          {
            source: 1001,
            dependency: 'alpha',
            severity: 'high',
            title: 'alpha high vuln',
            url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
          },
        ],
      },
      bravo: {
        name: 'bravo',
        severity: 'critical',
        via: [
          {
            source: 1002,
            dependency: 'bravo',
            severity: 'critical',
            title: 'bravo critical vuln',
            url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff',
          },
          // 중복: alpha 의 advisory 가 bravo 경유로도 잡히는 경우 → 1건으로 dedupe 되어야 함
          {
            source: 1001,
            dependency: 'alpha',
            severity: 'high',
            title: 'alpha high vuln',
            url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
          },
        ],
      },
      charlie: {
        name: 'charlie',
        severity: 'moderate',
        via: [
          {
            source: 1003,
            dependency: 'charlie',
            severity: 'moderate',
            title: 'charlie moderate vuln',
            url: 'https://github.com/advisories/GHSA-1111-2222-3333',
          },
        ],
      },
      // 체인 항목(via 가 문자열) — advisory 수집에서 제외되어야 함
      delta: { name: 'delta', severity: 'high', via: ['alpha'] },
    },
  };

  const advisories = extractGatedAdvisories(report);
  assert.equal(advisories.length, 2, 'high/critical 만 수집 + 중복 제거되어야 함');
  assert.deepEqual(advisories.map((a) => a.id).sort(), [1001, 1002]);
  assert.equal(advisories.find((a) => a.id === 1001).ghsa, 'GHSA-AAAA-BBBB-CCCC');

  // 케이스 1: allowlist 비어있음 → 전부 차단
  {
    const { blocked, allowed } = evaluate(advisories, [], 'backend');
    assert.equal(blocked.length, 2);
    assert.equal(allowed.length, 0);
  }

  // 케이스 2: advisory ID 로 허용
  {
    const allowlist = [
      { package: 'alpha', advisoryIds: [1001], workspaces: ['backend'], reason: '테스트' },
    ];
    const { blocked, allowed } = evaluate(advisories, allowlist, 'backend');
    assert.equal(allowed.length, 1);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].id, 1002);
  }

  // 케이스 3: GHSA ID(대소문자 무관)로 허용
  {
    const allowlist = [
      { package: 'bravo', ghsa: ['ghsa-dddd-eeee-ffff'], reason: '테스트' },
    ];
    const { allowed } = evaluate(advisories, allowlist, 'mobile');
    assert.equal(allowed.length, 1);
    assert.equal(allowed[0].advisory.id, 1002);
  }

  // 케이스 4: 워크스페이스 불일치 → 차단 유지
  {
    const allowlist = [
      { package: 'alpha', advisoryIds: [1001], workspaces: ['mobile'], reason: '테스트' },
    ];
    const { blocked } = evaluate(advisories, allowlist, 'backend');
    assert.equal(blocked.length, 2, 'mobile 전용 항목은 backend 에 적용되면 안 됨');
  }

  // 케이스 5: stale 항목 감지 (이 워크스페이스에 적용 가능하나 매칭 0건)
  {
    const allowlist = [
      { package: 'gone', advisoryIds: [9999], workspaces: ['backend'], reason: '이미 해소됨' },
      { package: 'other-ws', advisoryIds: [8888], workspaces: ['mobile'], reason: '다른 워크스페이스' },
    ];
    const { staleEntries } = evaluate(advisories, allowlist, 'backend');
    assert.equal(staleEntries.length, 1);
    assert.equal(staleEntries[0].package, 'gone');
  }

  // 케이스 6: 실제 allowlist 파일이 존재하면 형식이 유효해야 함
  {
    const entries = loadAllowlist();
    assert.ok(Array.isArray(entries));
    for (const e of entries) {
      assert.ok(typeof e.reason === 'string' && e.reason.length > 0, 'allowlist 항목엔 사유가 필수');
      assert.ok(Array.isArray(e.advisoryIds) && e.advisoryIds.length > 0, 'allowlist 항목엔 advisory ID 배열이 필수');
    }
  }

  console.log('[audit-gate] self-test 통과 (6 케이스)');
}

/* ------------------------------------------------------------------ */
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest();
    return;
  }

  const workspace = args[0];
  if (!WORKSPACES.has(workspace)) {
    console.error(`사용법: node scripts/audit-gate.mjs <backend|mobile|operator-web> [--json-file <path>] | --self-test`);
    process.exit(2);
  }
  const jsonFileIdx = args.indexOf('--json-file');
  const jsonFile = jsonFileIdx >= 0 ? args[jsonFileIdx + 1] : null;

  try {
    runGate(workspace, jsonFile);
  } catch (err) {
    console.error(`[audit-gate] 오류: ${err.message}`);
    process.exit(2);
  }
}

main();
