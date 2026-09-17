# x4build

Small esbuild-based builder for Node/TypeScript backend projects.

## Commands

```text
x4build build [--config <file>] [--debug]
x4build dev [--config <file>] [--no-restart|--no-run]
```

`build` performs a production build. `build --debug` keeps the output readable and writes linked source maps.

`dev` uses esbuild watch mode. After each successful build it launches the generated Node entry point. Further successful builds restart the process.

- `--no-restart`: launch Node once, continue building without restarting it.
- `--no-run`: build/watch only; never launch Node.
- `--config <file>`: use another config file. Relative paths are resolved from the current project directory. `$VAR` and `${VAR}` are expanded by x4build.

## Configuration

Default file: `x4.config.json`.

```json
{
  "entryPoints": ["src/main.ts"],
  "outdir": "dist",
  "external": [],
  "define": {},
  "copy": [],
  "dev": {
    "nodeArgs": ["--enable-source-maps"],
    "args": [],
    "watchDelay": 100
  },
  "esbuild": {
    "target": "node22"
  }
}
```

The project `package.json` is still read for Node module metadata such as `"type": "module"`, but build configuration no longer lives there.

The generated executable is determined from esbuild's metafile when there is a single entry point. For multiple entry points, configure it explicitly:

```json
{
  "dev": {
    "run": "dist/server.js"
  }
}
```

The `esbuild` object is applied last and is the escape hatch for native esbuild options.
