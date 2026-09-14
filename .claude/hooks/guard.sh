#!/usr/bin/env bash
input=$(cat)              # 훅 입력은 stdin으로 들어옵니다

# stdin JSON에는 명령어 말고도 transcript_path(~/.claude/projects/...) 같은 메타데이터가 함께 들어온다.
# 전체를 검사하면 경로에 들어 있는 "claude" 때문에 모든 Bash 호출이 차단되므로
# 실제로 실행될 명령어(tool_input.command)만 떼어내서 검사한다.
if command -v jq >/dev/null 2>&1; then
  toolCommand=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
elif command -v node >/dev/null 2>&1; then
  toolCommand=$(printf '%s' "$input" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      try {
        process.stdout.write(JSON.parse(raw).tool_input?.command ?? "");
      } catch {}
    });
  ')
else
  echo "guard.sh: jq나 node가 없어 명령을 검사할 수 없으므로 차단합니다." >&2
  exit 2
fi

if printf '%s' "$toolCommand" | grep -qE 'git (reset --hard|push --force)'; then
  echo "이 명령은 하네스에서 차단됩니다." >&2
  exit 2                  # 2번이면 차단
fi
if printf '%s' "$toolCommand" | grep -qiE 'claude'; then
  echo "\"claude\"가 포함된 명령은 차단됩니다." >&2
  exit 2                  # 2번이면 차단
fi
exit 0                     # 그 외는 통과
