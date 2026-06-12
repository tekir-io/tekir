<p align="center">
  <img src="https://tekir.io/logo.svg" width="80" alt="tekir" />
</p>

<h1 align="center">@tekir/cli</h1>

<p align="center">tekir command-line tool: serve, build, and any provider-registered command</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tekir/cli"><img src="https://img.shields.io/npm/v/@tekir/cli.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@tekir/cli"><img src="https://img.shields.io/npm/dm/@tekir/cli.svg" alt="npm downloads" /></a>
  <a href="https://github.com/tekir-io/tekir/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@tekir/cli.svg" alt="license" /></a>
</p>

<p align="center">
  <a href="https://tekir.io">Website</a> · <a href="https://docs.tekir.io">Documentation</a> · <a href="https://github.com/tekir-io/tekir">GitHub</a>
</p>

---

## Installation

```bash
# Globally
bun add -g @tekir/cli

# Or as a dev dependency in your project
bun add -d @tekir/cli
```

## Usage

```bash
tekir serve                          # Start the server (in-process)
tekir serve --dev                    # Start with watch mode (NODE_ENV=development)
tekir build --outdir ./dist          # Plain bundle
tekir build --compile --outfile server   # Single self-contained executable
tekir <command>                      # Any built-in / provider / user command
```

For full usage and configuration, see the [documentation](https://docs.tekir.io/installation).

## License

MIT
