# Stack Proc developer CLI

Build and upload typed workspace tools from a developer machine. Node 22.13+ is required. This package is built from the Stack Proc source repository; it is not yet published to npm.

Run `stackproc --help` after installing the provided tarball. Start with `stackproc auth login --server https://your-stackproc-origin.example`, then `stackproc tools init sum-values`. Interactive credentials use macOS Keychain; CI and other platforms supply a short-lived `STACKPROC_TOKEN` through their credential manager.

Source packages contain `tool.json`, JavaScript/TypeScript, JSON schemas and fixtures. Upload creates a draft. Successful server tests are required for publication. Enabling a release is a separate administrator action. The pure-code runtime has no network, filesystem, process, shell or credential access.

See `docs/specs/tool-builder-implementation.md` in the source repository for the complete command walkthrough and current limitations.
