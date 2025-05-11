#!/usr/bin/env bash
# Скрипт: setup-git.sh
# Назначение: автоматизировать инициализацию git-репозитория, добавление .gitignore,
# первый commit, создание удалённого репо на GitHub через gh CLI и пуш.
# Требования: установленный git и GitHub CLI (`gh auth login` уже выполнен).

set -euo pipefail

# ----------- Параметры ----------
REPO_NAME="${1:-}"       # имя репозитория на GitHub (если не передано, берём имя текущей папки)
PRIVATE_FLAG="${2:-public}"  # public | private  (по умолч. public)
DESCRIPTION="${3:-"Auto-created repository"}"  # описание репо

if [[ -z "$REPO_NAME" ]]; then
  REPO_NAME="$(basename "$(pwd)")"
fi

# Проверка CLI
command -v git >/dev/null 2>&1 || { echo "git не найден, установи его"; exit 1; }
command -v gh >/dev/null 2>&1 || { echo "gh CLI не найден, см. https://cli.github.com"; exit 1; }

# ----------- Логика ------------

# Если репо ещё не инициализировано
if [ ! -d .git ]; then
  echo "[INFO] Инициализируем локальный git-репозиторий"
  git init -b main
fi

# Добавляем типовой .gitignore для Node если его нет
if [ ! -f .gitignore ]; then
  echo "[INFO] Добавляю .gitignore (Node)"
  cat > .gitignore <<'EOF'
node_modules/
.env
uploads/
.DS_Store
*.log
EOF
  git add .gitignore
fi

# Добавляем все изменения и делаем первый коммит, если нет коммитов
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "[INFO] Первый commit"
  git add .
  git commit -m "Initial commit"
fi

# Проверяем, настроен ли origin
if ! git remote | grep -q '^origin$'; then
  echo "[INFO] Создаём репозиторий на GitHub: $REPO_NAME ($PRIVATE_FLAG)"
  gh repo create "$REPO_NAME" --$PRIVATE_FLAG --description "$DESCRIPTION" --source . --remote origin --push
else
  echo "[INFO] origin уже настроен, пушим изменения"
  git push -u origin main
fi

echo "[DONE] Репозиторий $REPO_NAME синхронизирован с GitHub" 