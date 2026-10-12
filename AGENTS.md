# Personal Nuvio VIDAA project rules

- Maintain the personal Android account backend, QR/email sign-in and VIDAA playback safeguards when integrating upstream releases.
- Keep the confirmed performance improvements: bounded catalog loading, artwork sizing, card windowing and navigation geometry reuse.
- Every published behavior or UI change must update `CHANGELOG.fr.md` with clear French notes for the user. Put the newest entry first and use the actual application version and publication date.
- The current French changelog entry must appear on every fresh VIDAA application launch, with an OK button to continue. Do not suppress it through the dismissed-upstream-version setting.
- Validate the changelog, focused behavior tests, VIDAA build and authenticated browser before publishing through the existing Git/Vercel integration.
- Keep passwords, private addon URLs and API keys out of logs, screenshots, release notes and public build configuration.
