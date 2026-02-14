# skill-implementation

Creates a `.implementation` scaffold for project development tracking.

## Installation

```bash
bun add -g skill-implementation
```

## Usage

```bash
# Create scaffold in current directory
skill-implementation

# With options
skill-implementation --force      # Overwrite existing
skill-implementation --output /path/to/project
```

## What's Created

```
.implementation/
├── data/
│   ├── indexes/
│   │   ├── TODOS.md
│   │   ├── MEMENTOS.md
│   │   ├── PLANS.md
│   │   └── AUDITS.md
│   ├── plans/
│   ├── todos/
│   ├── audits/
│   └── architecture/
├── docs/
├── logs/
└── README.md
```

## Structure Purpose

- **data/indexes/** - Quick reference index files
- **data/plans/** - Detailed implementation plans
- **data/todos/** - Task lists and checklists
- **data/audits/** - Code audits, security reviews
- **data/architecture/** - Architecture decisions and diagrams
- **docs/** - Project documentation
- **logs/** - Development logs and session notes

## License

MIT
