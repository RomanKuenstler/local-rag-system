# WebUI Fonts

The WebUI uses **Inter** and bundles it at build time via `@fontsource-variable/inter`.

## Compliance and hosting

- Font files are downloaded during the Node build stage from npm package dependencies.
- Vite emits the Inter font assets into `dist/assets/` so nginx serves them locally from the container.
- A license file (`OFL*` or `LICENSE*`) from the Inter package is copied into `dist/licenses/INTER-LICENSE.txt` during image build (with a fallback notice file if none is present).

This keeps runtime fully offline-capable while preserving the Inter typography.
