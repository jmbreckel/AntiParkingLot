# Contributing to AntiParkingLot

Thanks for your interest in contributing to **AntiParkingLot** (*Prompt Parking Lot*)!

## Local Setup

1. Fork and clone the repository:
   ```powershell
   git clone https://github.com/jmbreckel/AntiParkingLot.git
   cd AntiParkingLot
   npm run install:global
   ```
2. Make your changes in `server/`, `ui/`, `scripts/`, or `documentation/`.
3. Rebuild the single-file MCP App UI bundle whenever you change files under `ui/`:
   ```powershell
   npm run build
   ```
4. If you edit any `.mmd` files in `documentation/diagrams/`, re-render the 4x PNGs:
   ```powershell
   npm run build:diagrams
   ```
5. Run the end-to-end verification suite:
   ```powershell
   npm test
   ```

## Submitting Changes

- **Bug reports & feature requests:** Open an issue at <https://github.com/jmbreckel/AntiParkingLot/issues> with your OS, Node.js version, and steps to reproduce.
- **Pull requests:** Keep PRs focused, ensure `npm test` passes, and include any updated `dist/app.html` or diagram PNGs if relevant.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
