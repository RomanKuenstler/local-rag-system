# WebUI Fonts

The WebUI expects local Inter font files under:

- `apps/webui/fonts/inter/Inter-VariableFont_opsz,wght.ttf`
- `apps/webui/fonts/inter/Inter-Italic-VariableFont_opsz,wght.ttf`

`styles.css` registers these with `@font-face`, and Vite bundles them into `dist/` so nginx serves them locally from the container.

## Quick setup

1. Copy your downloaded Inter variable files into `apps/webui/fonts/inter/`.
2. Ensure the two files use the exact names listed above.
3. Rebuild the image: `docker compose build webui --no-cache`.
