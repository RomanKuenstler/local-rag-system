# WebUI Fonts

The WebUI uses **Inter** and bundles it at build time via `@fontsource-variable/inter`.

## Compliance and hosting

- Font files are downloaded during the Node build stage from npm package dependencies.
- Vite emits the Inter font assets into `dist/assets/` so nginx serves them locally from the container.
- The SIL Open Font License text is copied into `dist/licenses/INTER-OFL.txt` during image build.

This keeps runtime fully offline-capable while preserving the Inter typography.
