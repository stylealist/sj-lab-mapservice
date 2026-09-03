#!/usr/bin/env bash
input=$(cat)              # 훅 입력은 stdin으로 들어옵니다
if echo "$input" | grep -qE 'git (reset --hard|push --force)'; then
  echo "이 명령은 하네스에서 차단됩니다." >&2
  exit 2                  # 2번이면 차단
fi
if echo "$input" | grep -qiE 'claude'; then
  echo "\"claude\"가 포함된 명령은 차단됩니다." >&2
  exit 2                  # 2번이면 차단
fi
exit 0                     # 그 외는 통과
