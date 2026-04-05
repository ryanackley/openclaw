/**
 * Safety guardrails — PreToolUse hooks modeled after OpenClaw's layered defenses.
 *
 * Covers:
 *   1. Blocked filesystem paths (read + write)
 *   2. Dangerous shell commands
 *   3. Dangerous environment variable injection
 */

import { homedir } from "node:os";
import { resolve, normalize } from "node:path";

// ---------------------------------------------------------------------------
// Blocked paths — based on OpenClaw's BLOCKED_HOST_PATHS + blocked home subdirs
// ---------------------------------------------------------------------------

const BLOCKED_ABSOLUTE_PREFIXES = [
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/boot",
  "/root",
  "/run",
  "/var/run",
  "/private/etc",
  "/private/var/run",
];

const BLOCKED_HOME_SUBDIRS = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".docker",
  ".config/gcloud",
  ".netrc",
  ".npm",
  ".cargo",
];

function isBlockedPath(filePath: string): string | null {
  const resolved = resolve(normalize(filePath));
  const home = homedir();

  for (const prefix of BLOCKED_ABSOLUTE_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(prefix + "/")) {
      return `Blocked: ${prefix} is a restricted system path`;
    }
  }

  for (const subdir of BLOCKED_HOME_SUBDIRS) {
    const blocked = resolve(home, subdir);
    if (resolved === blocked || resolved.startsWith(blocked + "/")) {
      return `Blocked: ~/${subdir} contains sensitive credentials`;
    }
  }

  // Block docker socket
  if (resolved.includes("docker.sock")) {
    return "Blocked: Docker socket access is restricted";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Dangerous shell commands
// ---------------------------------------------------------------------------

const DANGEROUS_COMMAND_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/, "rm on root filesystem"],
  [/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/\s/, "recursive rm on root"],
  [/\bmkfs\b/, "filesystem formatting"],
  [/\bdd\s+.*if=\/dev\/(zero|random|urandom).*of=\/dev\//, "raw disk write"],
  [/:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/, "fork bomb"],
  [/\bsudo\s+rm\s+-rf\s+\//, "sudo rm -rf /"],
  [/\bchmod\s+-R\s+777\s+\//, "chmod 777 on root"],
  [/\bchown\s+-R\s+.*\s+\/\s*$/, "chown on root"],
  [/>\s*\/dev\/sd[a-z]/, "overwriting block device"],
  [/\bcurl\b.*\|\s*(sudo\s+)?bash/, "piping curl to bash"],
  [/\bwget\b.*\|\s*(sudo\s+)?bash/, "piping wget to bash"],
];

function isDangerousCommand(command: string): string | null {
  for (const [pattern, label] of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return `Blocked: dangerous command detected (${label})`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dangerous environment variables (from OpenClaw's host-env-security-policy)
// ---------------------------------------------------------------------------

const DANGEROUS_ENV_PREFIXES = [
  "DYLD_",
  "LD_",
  "BASH_FUNC_",
  "GIT_CONFIG_",
  "NPM_CONFIG_",
];

const DANGEROUS_ENV_KEYS = new Set([
  "BASH_ENV",
  "ENV",
  "PYTHONSTARTUP",
  "PYTHONPATH",
  "PYTHONHOME",
  "PERL5LIB",
  "PERL5DB",
  "RUBYLIB",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "SSL_CERT_FILE",
  "GIT_SSL_NO_VERIFY",
  "CC",
  "CXX",
  "GCONV_PATH",
  "GLIBC_TUNABLES",
]);

function isDangerousEnvVar(key: string): boolean {
  if (DANGEROUS_ENV_KEYS.has(key)) return true;
  return DANGEROUS_ENV_PREFIXES.some((p) => key.startsWith(p));
}

// ---------------------------------------------------------------------------
// Hook: check tool calls before execution
// ---------------------------------------------------------------------------

export interface SafetyResult {
  allowed: boolean;
  reason?: string;
}

export function checkToolSafety(
  toolName: string,
  toolInput: Record<string, unknown>,
): SafetyResult {
  // --- File operations: Read, Write, Edit ---
  if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
    const filePath = (toolInput.file_path as string) ?? "";
    if (filePath) {
      const blocked = isBlockedPath(filePath);
      if (blocked) return { allowed: false, reason: blocked };
    }
  }

  // --- Bash / shell execution ---
  if (toolName === "Bash") {
    const command = (toolInput.command as string) ?? "";

    // Check command itself
    const blocked = isDangerousCommand(command);
    if (blocked) return { allowed: false, reason: blocked };

    // Check for file operations targeting blocked paths within commands
    const pathMatches = command.match(
      /(?:cat|head|tail|less|more|nano|vim?|tee|cp|mv|rm|chmod|chown|touch|mkdir)\s+([^\s|;&]+)/g,
    );
    if (pathMatches) {
      for (const match of pathMatches) {
        const parts = match.split(/\s+/);
        const target = parts[parts.length - 1];
        if (target) {
          const blocked = isBlockedPath(target);
          if (blocked) return { allowed: false, reason: blocked };
        }
      }
    }

    // Check for dangerous env var exports
    const envMatches = command.match(/\bexport\s+(\w+)=/g);
    if (envMatches) {
      for (const match of envMatches) {
        const key = match.replace(/^export\s+/, "").replace(/=$/, "");
        if (isDangerousEnvVar(key)) {
          return {
            allowed: false,
            reason: `Blocked: setting dangerous environment variable ${key}`,
          };
        }
      }
    }
  }

  // --- Glob/Grep targeting blocked dirs ---
  if (toolName === "Glob" || toolName === "Grep") {
    const path = (toolInput.path as string) ?? "";
    if (path) {
      const blocked = isBlockedPath(path);
      if (blocked) return { allowed: false, reason: blocked };
    }
  }

  return { allowed: true };
}
