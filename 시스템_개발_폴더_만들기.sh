#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
mkdir -p "$script_dir/시스템 개발"
printf '폴더 생성 완료: %s\n' "$script_dir/시스템 개발"
