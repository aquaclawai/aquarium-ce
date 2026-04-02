#!/bin/sh
set -e

SKILLS_SRC="/opt/clawra-skills"
SKILLS_DST="${HOME}/.openclaw/skills"

if [ -d "${SKILLS_SRC}" ]; then
  mkdir -p "${SKILLS_DST}"
  cp -r "${SKILLS_SRC}/." "${SKILLS_DST}/"
fi

exec docker-entrypoint.sh "$@"
