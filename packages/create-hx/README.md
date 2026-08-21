# create-hx

Create a production-oriented Hx NestJS project from the latest Hx `main` branch.

## Usage

```bash
pnpm create hx my-app
pnpm create hx .
npm create hx@latest my-app
```

`create-hx` requires Node.js 24.19.0 and pnpm 11.21.0. The destination must not exist or must be completely empty.

The CLI creates project files only. It prints the commands for dependency installation, Git initialization, environment setup, and Docker startup without running them.
