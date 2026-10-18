# Validation status — v0.1

Completed in the creation environment:
- JavaScript syntax checks for every source JS module: **passed**.
- Node native unit tests for Luhn recognition, regex suggestions, box normalization, pixel coordinate mapping, and PDF text-box suggestion mapping: **5/5 passed**.
- Synthetic, clearly labeled fake two-page statement generated and validated by a PDF renderer.

**Not completed here:** `npm install`, full Vite production build, real-browser PDF import/export/verification and Safari/iPad acceptance testing. The artifact-creation environment could not reach the npm registry, so project dependencies could not be installed for a browser run. The GitHub Actions workflow runs `npm test` and `npm run build` on a machine with internet access, but this does not replace end-to-end acceptance testing.

Before using real financial statements, deploy to a trusted HTTPS origin and test the complete import-mask-export-download-open workflow on the included synthetic PDF, including all pages and masking coordinates. Visually inspect the exported PDF and run the structural verification. Treat v0.1 as an initial MVP requiring device validation, not a certified security tool.
