@AGENTS.md

## Только для Claude Code

Общие правила — в `AGENTS.md` выше, они одинаковы для Codex и Claude Code; менять их нужно там.
Здесь только то, что относится к самому Claude Code. Как Codex и Claude Code делят работу — `docs/AI_AGENTS.md`.

- Задачу выполняй через `/lfs LFS-XXX`, проверку чужой работы делай через `/lfs-review LFS-XXX`.
- План до правок удобно показывать в plan mode.
- Картинки-референсы (например `docs/reference/ui/*.png`) открывай инструментом Read, ты их видишь.
- Правила Next.js 16 для `apps/web` лежат в `apps/web/AGENTS.md` и подключаются через `apps/web/CLAUDE.md`.
- Авто-память Claude Code (`~/.claude/projects/…`) Codex не видит. Указание владельца, которое касается обоих агентов,
  записывай в `AGENTS.md` или в нужный документ `docs/`, а не в память.
