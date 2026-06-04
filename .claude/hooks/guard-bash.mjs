#!/usr/bin/env node
/**
 * PreToolUse 가드 (Bash) — 되돌리기 어렵거나 파괴적인 명령을 차단한다.
 *
 * settings.json 의 단순 prefix 매칭이 못 잡는 "명령어 본문 정규식 검사"를 담당.
 * 차단 시 exit 2 + stderr 메시지 → Claude 에게 사유가 전달되고 도구 호출이 중단됨.
 * best-effort: 입력 파싱 실패 시엔 통과시킨다(가드가 작업을 막는 부작용 최소화).
 */
import { readFileSync } from 'node:fs';

let cmd = '';
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  cmd = input?.tool_input?.command ?? '';
} catch {
  process.exit(0);
}

/** [정규식, 차단 사유] */
const RULES = [
  // 1. Prisma 파괴적 마이그레이션 (DB 초기화 위험)
  [/prisma\s+migrate\s+(reset|deploy)\b/i, 'prisma migrate reset/deploy 차단 — DB 파괴·운영반영 위험. 수동 실행하세요.'],
  [/prisma\s+db\s+push[^\n|;&]*--force-reset/i, 'prisma db push --force-reset 차단 — DB 초기화.'],

  // 2. Git 위험 작업
  [/git\s+push[^\n|;&]*(--force\b|\s-f(\s|$))/i, 'force push 차단 — 원격 히스토리 손상 위험.'],
  [/git\s+push[^\n|;&]*\borigin\b[^\n|;&]*\bmain\b/i, 'main 브랜치 직접 push 차단 — 브랜치+PR 흐름을 사용하세요.'],
  [/git\s+reset\s+--hard\b/i, 'git reset --hard 차단 — 미커밋 작업 손실 위험. 수동 확인하세요.'],
  [/git\s+clean\s+-[a-z]*f/i, 'git clean -f 차단 — 미추적 파일 영구 삭제 위험.'],

  // 3. 파일시스템 파괴
  [/\brm\s+-[a-z]*r[a-z]*f/i, 'rm -rf 차단 — 디렉터리 영구 삭제 위험.'],
  [/\brm\s+-[a-z]*f[a-z]*r/i, 'rm -fr 차단 — 디렉터리 영구 삭제 위험.'],
  [/\brm\s+-[rf]\s+-[rf]\b/i, 'rm -r -f 차단 — 디렉터리 영구 삭제 위험.'],
  [/\bchmod\s+-?R?\s*777\b/i, 'chmod 777 차단 — 보안 취약.'],

  // 4. 파괴적 SQL
  [/\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i, '파괴적 SQL(DROP/TRUNCATE) 차단.'],

  // 5. 시크릿 유출
  [/\b(cat|less|more|cp|scp|curl|head|tail)\s+[^\n|;&]*\.env(\b|$|\.local|\.example)/i, '.env 시크릿 파일 접근/전송 차단.'],

  // 6. 권한 상승
  [/^\s*sudo\b/i, 'sudo 차단 — 권한 상승 명령은 수동 실행하세요.'],
];

// WHERE 절 없는 DELETE (전체 삭제 위험)
if (/\bDELETE\s+FROM\b/i.test(cmd) && !/\bWHERE\b/i.test(cmd)) {
  block('WHERE 절 없는 DELETE 차단 — 테이블 전체 삭제 위험.');
}

for (const [re, msg] of RULES) {
  if (re.test(cmd)) block(msg);
}

process.exit(0);

function block(msg) {
  process.stderr.write(`⛔ 하네스 권한 가드: ${msg}\n   차단된 명령: ${cmd}\n`);
  process.exit(2);
}
