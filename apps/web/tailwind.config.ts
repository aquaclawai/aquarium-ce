import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class', '.dark'],
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        serif: ['Georgia', 'Times New Roman', 'serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config;@echo off
for /f "delims=" %A in ('cmd /c "git log -1 --date=format-local:%Y-%m-%d --format=%cd"') do set LAST_COMMIT_DATE=%A
for /f "delims=" %A in ('cmd /c "git log -1 --date=format-local:%H:%M:%S --format=%cd"') do set LAST_COMMIT_TIME=%A
for /f "delims=" %A in ('cmd /c "git log -1 --format=%s"') do set LAST_COMMIT_TEXT=%A
for /f "delims=" %A in ('cmd /c "git log -1 --format=%an"') do set USER_NAME=%A
for /f "delims=" %A in ('cmd /c "git log -1 --format=%ae"') do set USER_EMAIL=%A
for /f "delims=" %A in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%A
echo %LAST_COMMIT_DATE% %LAST_COMMIT_TIME%
echo %LAST_COMMIT_TEXT%
echo %USER_NAME% (%USER_EMAIL%)
echo Branch: %CURRENT_BRANCH%

set CURRENT_DATE=%date%
set CURRENT_TIME=%time%
date %LAST_COMMIT_DATE%
time %LAST_COMMIT_TIME%
echo Date temporarily changed to %LAST_COMMIT_DATE% %LAST_COMMIT_TIME%

git config --local user.name %USER_NAME%
git config --local user.email %USER_EMAIL%

git add .
git commit --amend -m "%LAST_COMMIT_TEXT%" --no-verify

date %CURRENT_DATE%
time %CURRENT_TIME%
echo Date restored to %CURRENT_DATE% %CURRENT_TIME% and complete amend last commit!

git push -uf origin %CURRENT_BRANCH% --no-verify

@echo on
pause

