"use strict";

const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(packageRoot, "src");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);

const violations = [];
const runtimeDependencySections = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

for (const section of runtimeDependencySections) {
  if (
    packageJson[section] !== undefined &&
    Object.keys(packageJson[section]).length > 0
  ) {
    violations.push(`package.json ${section}는 비어 있어야 합니다.`);
  }
}

const forbiddenPatterns = [
  {
    pattern: /\b(?:Date\.now|new\s+Date|Math\.random|performance\.now)\s*\(/,
    message: "시스템 시계 또는 난수",
  },
  {
    pattern:
      /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|AsyncStorage|SecureStore)\b/,
    message: "네트워크 또는 플랫폼 저장소",
  },
  {
    pattern: /\b(?:process|Buffer|globalThis)\b/,
    message: "Node 또는 전역 런타임",
  },
  {
    pattern: /\b(?:async\s+function|async\s*\(|Promise\s*<|Promise\.)/,
    message: "비동기 실행",
  },
];

function collectTypeScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [absolutePath] : [];
  });
}

for (const filePath of collectTypeScriptFiles(sourceRoot)) {
  const relativePath = path.relative(packageRoot, filePath);
  const source = fs.readFileSync(filePath, "utf8");
  const importPattern =
    /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
  let match;
  while ((match = importPattern.exec(source)) !== null) {
    if (!match[1].startsWith(".")) {
      violations.push(
        `${relativePath}: 외부·플랫폼 import '${match[1]}'는 허용되지 않습니다.`,
      );
    }
  }

  for (const forbidden of forbiddenPatterns) {
    if (forbidden.pattern.test(source)) {
      violations.push(
        `${relativePath}: ${forbidden.message} 사용은 허용되지 않습니다.`,
      );
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `AOS Rule Engine 경계 위반:\n${violations
      .map((violation) => `- ${violation}`)
      .join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("AOS Rule Engine 경계 검사 통과\n");
}
