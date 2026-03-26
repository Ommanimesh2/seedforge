# Contributing to seedforge

Thanks for your interest in contributing to seedforge! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/your-username/seedforge.git
cd seedforge
npm install
npm run build
npm test
```

## Running Tests

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run lint          # lint check
```

## Making Changes

1. Fork the repo and create a feature branch from `main`.
2. Write tests for any new functionality.
3. Ensure all tests pass (`npm test`) and linting is clean (`npm run lint`).
4. Keep commits focused -- one logical change per commit.
5. Open a pull request with a clear description of the change.

## Code Style

- TypeScript strict mode is enabled.
- Follow the existing patterns in the codebase.
- Run `npm run lint` before submitting.

## Reporting Bugs

Open an issue using the bug report template. Include your Node.js version, PostgreSQL version, and a minimal reproduction case.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
