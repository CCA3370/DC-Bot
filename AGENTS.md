# Repository Guidelines

- Always answer me in Chinese.
- Each time a task is executed, a Commit message should be written and commited once a small stage is completed (without pushing).
- After each small stage is completed, please inform me in detail which tests I need to perform manually.
- There's no need to pursue minimal changes; always ensure the current implementation is the optimal solution, stop treating compatibility as a constraint, and focus on ensuring overall optimality.

## Project Structure & Module Organization

This repository is intended for a Discord-to-QQ bridge bot using NapCat. Keep runtime code under `src/` and split modules by responsibility: `src/discord/` for Discord gateway listeners and message parsing, `src/napcat/` for QQ group delivery and merged-forward payloads, `src/media/` for image download, validation, conversion, and watermarking, and `src/admin/` for the web management backend and UI. Place shared types and utilities in `src/shared/`. Put automated tests in `tests/`, static admin assets in `assets/`, and configuration examples in `.env.example` or `config/`.

## Build, Test, and Development Commands

The repository does not yet define a package manager or scripts. Once the runtime is selected, standardize these commands in the project manifest:

- `npm run dev` or `pnpm dev`: start the bot and admin server locally.
- `npm test` or `pnpm test`: run unit and integration tests.
- `npm run build` or `pnpm build`: compile production assets and server code.
- `npm run lint`: run formatting and static checks before commits.

## Coding Style & Naming Conventions

Keep modules small and named after behavior, for example `discordChannelRouter`, `napcatForwarder`, `markdownToPlainText`, and `watermarkImage`. Use clear async boundaries for Discord ingestion, routing, image processing, and QQ delivery. Prefer typed configuration objects over loose environment access throughout the code. Never commit tokens, cookies, local session files, generated images, or runtime logs.

## Testing Guidelines

Cover Discord message parsing, channel-to-group routing, Markdown-to-plain-text conversion, multi-image grouping, image watermark placement, and NapCat merged-forward payload formatting. Add integration tests for messages that contain both text and images, multiple images in one Discord message, and unmapped channels. Name tests after the behavior under test, such as `routesDiscordChannelToConfiguredGroups`.

## Commit & Pull Request Guidelines

There is no existing Git history, so use Conventional Commits from the start, such as `feat: add channel routing config` or `fix: preserve multi-image qq forwards`. Pull requests should include a behavior summary, test evidence, configuration changes, and screenshots or recordings for admin UI changes.

## Security & Configuration Tips

Document required settings in `.env.example`, including the Discord token, allowed guild ID `1331633353648111697`, NapCat endpoint, QQ group mappings, media cache path, and admin authentication secret. Do not log secrets or signed media URLs. Validate uploaded or downloaded media before processing and keep generated artifacts in ignored project-local directories.
